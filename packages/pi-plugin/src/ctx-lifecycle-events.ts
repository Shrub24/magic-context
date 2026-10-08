/**
 * `magic-context:flush` / `magic-context:wrapup` — the Pi event-bus surface that
 * lets another extension run the `/ctx-flush` and `/ctx-wrapup` actions and read
 * the outcome, without a command context of its own.
 *
 * Each request is answered on `magic-context:flush-result` /
 * `magic-context:wrapup-result`. Handlers never throw into the emitter: an
 * invalid payload, a refusal or a failure all become a result event. Nothing runs
 * unless a request arrives.
 *
 * Registered from `index.ts` only. Subagents load `subagent-entry.ts`, which
 * never wires event handlers.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sessionLog } from "@magic-context/core/shared/logger";
import { executeCtxFlush } from "./commands/ctx-flush";
import {
	normalizeMessagesToKeep,
	type RegisterCtxWrapupDeps,
	runPiWrapupOutcome,
} from "./commands/ctx-wrapup";
import { resolvePiLiveContext } from "./context-handler";

export const FLUSH_REQUEST_EVENT = "magic-context:flush";
export const FLUSH_RESULT_EVENT = "magic-context:flush-result";
export const WRAPUP_REQUEST_EVENT = "magic-context:wrapup";
export const WRAPUP_RESULT_EVENT = "magic-context:wrapup-result";

export type CtxLifecycleStatus = "success" | "skipped" | "failed";

export interface CtxFlushResultEvent {
	/** Absent when the request named no session and none was live. */
	sessionId?: string;
	status: CtxLifecycleStatus;
	/**
	 * `invalid-request`, `no-live-context`, `compaction-off` or `flush-failed`.
	 */
	reason?: string;
	pendingOps?: number;
}

export interface CtxWrapupResultEvent {
	sessionId?: string;
	status: CtxLifecycleStatus;
	/**
	 * `invalid-request`, `no-live-context`, `compaction-off` or
	 * `historian-model-missing`, then `PiWrapupReason` from the wrapup body.
	 */
	reason?: string;
	messagesWrapped?: number;
	compartmentsWritten?: number;
}

interface CtxLifecycleRequest {
	/** Absent means "the active session". */
	sessionId?: string;
	messagesToKeep: number;
}

function parseRequest(
	payload: unknown,
): { ok: true; request: CtxLifecycleRequest } | { ok: false } {
	if (payload !== undefined && payload !== null && typeof payload !== "object")
		return { ok: false };
	const fields = (payload ?? {}) as {
		sessionId?: unknown;
		messagesToKeep?: unknown;
	};
	let sessionId: string | undefined;
	if (fields.sessionId !== undefined && fields.sessionId !== null) {
		if (typeof fields.sessionId !== "string" || fields.sessionId.length === 0)
			return { ok: false };
		sessionId = fields.sessionId;
	}
	const messagesToKeep = normalizeMessagesToKeep(fields.messagesToKeep);
	if (messagesToKeep === undefined) return { ok: false };
	return { ok: true, request: { sessionId, messagesToKeep } };
}

export function registerCtxLifecycleEvents(
	pi: ExtensionAPI,
	deps: RegisterCtxWrapupDeps,
): void {
	const emit = (event: string, payload: unknown): void => {
		try {
			pi.events.emit(event, payload);
		} catch (err) {
			// A broken peer bus consumer must not break the request that triggered it.
			sessionLog(
				"pi",
				`${event} emit failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const runFlushRequest = async (payload: unknown): Promise<void> => {
		const parsed = parseRequest(payload);
		if (!parsed.ok) {
			emit(FLUSH_RESULT_EVENT, {
				status: "failed",
				reason: "invalid-request",
			});
			return;
		}
		const live = resolvePiLiveContext(parsed.request.sessionId);
		if (!live) {
			emit(FLUSH_RESULT_EVENT, {
				sessionId: parsed.request.sessionId,
				status: "skipped",
				reason: "no-live-context",
			});
			return;
		}
		if (deps.compactionOff) {
			emit(FLUSH_RESULT_EVENT, {
				sessionId: live.sessionId,
				status: "skipped",
				reason: "compaction-off",
			});
			return;
		}
		const { pendingOps, result } = executeCtxFlush(deps.db, live.sessionId);
		const failed = result.startsWith("Error:");
		emit(FLUSH_RESULT_EVENT, {
			sessionId: live.sessionId,
			status: failed ? "failed" : "success",
			...(failed ? { reason: "flush-failed" } : {}),
			pendingOps,
		});
	};

	const runWrapupRequest = async (payload: unknown): Promise<void> => {
		const parsed = parseRequest(payload);
		if (!parsed.ok) {
			emit(WRAPUP_RESULT_EVENT, {
				status: "failed",
				reason: "invalid-request",
			});
			return;
		}
		const live = resolvePiLiveContext(parsed.request.sessionId);
		if (!live) {
			emit(WRAPUP_RESULT_EVENT, {
				sessionId: parsed.request.sessionId,
				status: "skipped",
				reason: "no-live-context",
			});
			return;
		}
		const { sessionId, ctx } = live;
		// Same runtime deps the command resolves, from the session's own context.
		const currentDeps = {
			...(deps.resolveRuntimeDeps?.(ctx) ?? deps),
			shutdownSignal: deps.shutdownSignal,
		};
		// `runPiWrapupOutcome` refuses a subagent session itself; these two are
		// refused here because the command's own guards do not reach it.
		if (currentDeps.compactionOff) {
			emit(WRAPUP_RESULT_EVENT, {
				sessionId,
				status: "skipped",
				reason: "compaction-off",
			});
			return;
		}
		if (!currentDeps.historianModel) {
			emit(WRAPUP_RESULT_EVENT, {
				sessionId,
				status: "skipped",
				reason: "historian-model-missing",
			});
			return;
		}
		const outcome = await runPiWrapupOutcome(
			pi,
			currentDeps,
			ctx,
			sessionId,
			parsed.request.messagesToKeep,
		);
		emit(WRAPUP_RESULT_EVENT, {
			sessionId,
			status: outcome.status,
			...(outcome.reason ? { reason: outcome.reason } : {}),
			...(outcome.messagesWrapped !== undefined
				? { messagesWrapped: outcome.messagesWrapped }
				: {}),
			...(outcome.compartmentsWritten !== undefined
				? { compartmentsWritten: outcome.compartmentsWritten }
				: {}),
		});
	};

	const handle = (
		event: string,
		resultEvent: string,
		run: (payload: unknown) => Promise<void>,
	): void => {
		pi.events.on(event, (payload) => {
			void run(payload).catch((err) => {
				sessionLog(
					"pi",
					`${event} handler failed: ${err instanceof Error ? err.message : String(err)}`,
				);
				emit(resultEvent, { status: "failed", reason: "internal-error" });
			});
		});
	};

	handle(FLUSH_REQUEST_EVENT, FLUSH_RESULT_EVENT, runFlushRequest);
	handle(WRAPUP_REQUEST_EVENT, WRAPUP_RESULT_EVENT, runWrapupRequest);
}
