import { afterEach, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	appendCompartments,
	getCompartments,
	getLastCompartmentEndMessage,
} from "@magic-context/core/features/magic-context/compartment-storage";
import { runMigrations } from "@magic-context/core/features/magic-context/migrations";
import {
	acquireWrapupInProgress,
	insertTag,
	updateSessionMeta,
} from "@magic-context/core/features/magic-context/storage";
import { initializeDatabase } from "@magic-context/core/features/magic-context/storage-db";
import { queuePendingOp } from "@magic-context/core/features/magic-context/storage-ops";
import { Database } from "@magic-context/core/shared/sqlite";
import { closeQuietly } from "@magic-context/core/shared/sqlite-helpers";
import type { RegisterCtxWrapupDeps } from "./commands/ctx-wrapup";
import {
	clearContextHandlerSession,
	__test as contextHandlerInternals,
	recordPiLiveContext,
} from "./context-handler";
import {
	FLUSH_REQUEST_EVENT,
	FLUSH_RESULT_EVENT,
	registerCtxLifecycleEvents,
	WRAPUP_REQUEST_EVENT,
	WRAPUP_RESULT_EVENT,
} from "./ctx-lifecycle-events";

/** Session ids whose module-scoped signal state must be dropped after each test. */
const TRACKED_SESSION_IDS: string[] = [];

afterEach(() => {
	for (const sessionId of TRACKED_SESSION_IDS.splice(0)) {
		clearContextHandlerSession(sessionId);
	}
});

function session(sessionId: string): string {
	TRACKED_SESSION_IDS.push(sessionId);
	return sessionId;
}

function createDb(): Database {
	const db = new Database(":memory:");
	initializeDatabase(db);
	runMigrations(db);
	return db;
}

function createMockPi() {
	const handlers = new Map<string, Array<(payload: unknown) => void>>();
	const emitted: Array<{ event: string; payload: unknown }> = [];
	const pi = {
		events: {
			on(event: string, handler: (payload: unknown) => void) {
				const registered = handlers.get(event) ?? [];
				registered.push(handler);
				handlers.set(event, registered);
				return () => {};
			},
			emit(event: string, payload: unknown) {
				emitted.push({ event, payload });
			},
		},
		appendEntry() {},
	};
	return {
		pi: pi as never,
		request(event: string, payload?: unknown) {
			for (const handler of handlers.get(event) ?? []) handler(payload);
		},
		/** A request is answered asynchronously, so the result always follows the emit. */
		async result(event: string): Promise<Record<string, unknown>> {
			for (let attempt = 0; attempt < 400; attempt++) {
				const hit = emitted.find((entry) => entry.event === event);
				if (hit) return hit.payload as Record<string, unknown>;
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			throw new Error(`${event} was never emitted`);
		},
	};
}

function branch(count: number, extra = "") {
	return Array.from({ length: count }, (_, index) => ({
		id: `m-${index + 1}`,
		type: "message",
		timestamp: index + 1,
		message: {
			role: "user",
			content: `message ${index + 1} alpha beta gamma delta ${extra}`,
		},
	}));
}

function liveCtx(sessionId: string, messageCount = 8, bulky = false) {
	return {
		cwd: "/tmp/pi-lifecycle-events",
		hasUI: false,
		ui: { setStatus() {} },
		model: { provider: "anthropic", id: "claude" },
		sessionManager: {
			getSessionId: () => sessionId,
			getBranch: () =>
				branch(
					messageCount,
					bulky ? "alpha beta gamma delta ".repeat(5_000) : "",
				),
		},
		getContextUsage: () => ({ contextWindow: 20, tokens: 1, percent: 1 }),
	} as never;
}

function deps(
	db: Database,
	overrides: Partial<RegisterCtxWrapupDeps> = {},
): RegisterCtxWrapupDeps {
	return {
		db,
		runner: {} as never,
		historianModel: "test/model",
		historianChunkTokens: 10,
		memoryEnabled: false,
		autoPromote: false,
		runPiHistorianForWrapup: mock(async () => {}),
		...overrides,
	};
}

function appendRange(
	db: Database,
	sessionId: string,
	start: number,
	end: number,
): void {
	appendCompartments(db, sessionId, [
		{
			sequence: getCompartments(db, sessionId).length,
			startMessage: start,
			endMessage: end,
			startMessageId: `m-${start}`,
			endMessageId: `m-${end}`,
			title: `Pi ${start}-${end}`,
			content: `Pi ${start}-${end}`,
		},
	]);
}

describe("registration", () => {
	it("wires the request events from index.ts only, never from the subagent entry", () => {
		const subagentEntry = readFileSync(
			join(import.meta.dir, "subagent-entry.ts"),
			"utf8",
		);
		expect(subagentEntry).not.toContain("ctx-lifecycle-events");
		expect(readFileSync(join(import.meta.dir, "index.ts"), "utf8")).toContain(
			"registerCtxLifecycleEvents(pi, wrapupDeps)",
		);
	});
});

describe("magic-context:flush", () => {
	it("flushes the active session and reports the pending-op count", async () => {
		const db = createDb();
		try {
			const sessionId = session("pi-lifecycle-flush");
			const tagId = insertTag(db, sessionId, "message-1", "message", 20, 1);
			queuePendingOp(db, sessionId, tagId, "drop");
			const { pi, request, result } = createMockPi();
			registerCtxLifecycleEvents(pi, deps(db));
			recordPiLiveContext(sessionId, liveCtx(sessionId));

			await request(FLUSH_REQUEST_EVENT);

			expect(await result(FLUSH_RESULT_EVENT)).toEqual({
				sessionId,
				status: "success",
				pendingOps: 1,
			});
			// The same three refresh sets `/ctx-flush` signals.
			expect(
				contextHandlerInternals.variantRefreshStateForTests(sessionId),
			).toEqual({ history: true, systemPrompt: true, materialization: true });
		} finally {
			closeQuietly(db);
		}
	});

	it("flushes a named session before any live context exists, synchronously", async () => {
		const db = createDb();
		try {
			const sessionId = session("pi-lifecycle-flush-fresh");
			const tagId = insertTag(db, sessionId, "message-1", "message", 20, 1);
			queuePendingOp(db, sessionId, tagId, "drop");
			const { pi, request, result } = createMockPi();
			registerCtxLifecycleEvents(pi, deps(db));

			// No recordPiLiveContext: a freshly started or resumed process.
			request(FLUSH_REQUEST_EVENT, { sessionId });

			// Flush-before-dispatch: the signals are set before the emit returns.
			expect(
				contextHandlerInternals.variantRefreshStateForTests(sessionId),
			).toEqual({ history: true, systemPrompt: true, materialization: true });
			expect(await result(FLUSH_RESULT_EVENT)).toEqual({
				sessionId,
				status: "success",
				pendingOps: 1,
			});
		} finally {
			closeQuietly(db);
		}
	});

	it("refuses a flush that names no session when none is live", async () => {
		const db = createDb();
		try {
			const { pi, request, result } = createMockPi();
			registerCtxLifecycleEvents(pi, deps(db));

			request(FLUSH_REQUEST_EVENT);

			expect(await result(FLUSH_RESULT_EVENT)).toEqual({
				status: "skipped",
				reason: "no-live-context",
			});
		} finally {
			closeQuietly(db);
		}
	});

	it("skips a flush when compaction is off and leaves the queue untouched", async () => {
		const db = createDb();
		try {
			const sessionId = session("pi-lifecycle-flush-off");
			const tagId = insertTag(db, sessionId, "message-1", "message", 20, 1);
			queuePendingOp(db, sessionId, tagId, "drop");
			const { pi, request, result } = createMockPi();
			registerCtxLifecycleEvents(pi, deps(db, { compactionOff: true }));
			recordPiLiveContext(sessionId, liveCtx(sessionId));

			await request(FLUSH_REQUEST_EVENT);

			expect(await result(FLUSH_RESULT_EVENT)).toEqual({
				sessionId,
				status: "skipped",
				reason: "compaction-off",
			});
			expect(
				db
					.prepare("SELECT COUNT(*) AS n FROM pending_ops WHERE session_id = ?")
					.get(sessionId),
			).toMatchObject({ n: 1 });
			expect(
				contextHandlerInternals.variantRefreshStateForTests(sessionId),
			).toEqual({
				history: false,
				systemPrompt: false,
				materialization: false,
			});
		} finally {
			closeQuietly(db);
		}
	});
});

describe("magic-context:wrapup", () => {
	it("compacts older history and reports the compartments written", async () => {
		const db = createDb();
		try {
			const sessionId = session("pi-lifecycle-wrapup");
			const { pi, request, result } = createMockPi();
			registerCtxLifecycleEvents(
				pi,
				deps(db, {
					runPiHistorianForWrapup: mock(async (args) => {
						const start = Math.max(
							1,
							getLastCompartmentEndMessage(db, sessionId) + 1,
						);
						appendRange(
							db,
							args.sessionId,
							start,
							args.boundarySnapshot.eligibleEndOrdinal - 1,
						);
						args.onPublished?.();
					}),
				}),
			);
			recordPiLiveContext(sessionId, liveCtx(sessionId, 12, true));

			await request(WRAPUP_REQUEST_EVENT, { messagesToKeep: 3 });

			const payload = await result(WRAPUP_RESULT_EVENT);
			expect(payload).toMatchObject({ sessionId, status: "success" });
			expect(payload.compartmentsWritten).toBe(
				getCompartments(db, sessionId).length,
			);
			expect(payload.compartmentsWritten).toBeGreaterThan(0);
		} finally {
			closeQuietly(db);
		}
	});

	it("refuses a subagent session", async () => {
		const db = createDb();
		try {
			const sessionId = session("pi-lifecycle-wrapup-subagent");
			updateSessionMeta(db, sessionId, { isSubagent: true });
			const runPiHistorianForWrapup = mock(async () => {});
			const { pi, request, result } = createMockPi();
			registerCtxLifecycleEvents(pi, deps(db, { runPiHistorianForWrapup }));
			recordPiLiveContext(sessionId, liveCtx(sessionId));

			await request(WRAPUP_REQUEST_EVENT);

			expect(await result(WRAPUP_RESULT_EVENT)).toEqual({
				sessionId,
				status: "skipped",
				reason: "subagent",
			});
			expect(runPiHistorianForWrapup).not.toHaveBeenCalled();
			expect(getCompartments(db, sessionId)).toHaveLength(0);
		} finally {
			closeQuietly(db);
		}
	});

	it("refuses when no historian model is configured", async () => {
		const db = createDb();
		try {
			const sessionId = session("pi-lifecycle-wrapup-no-model");
			const runPiHistorianForWrapup = mock(async () => {});
			const { pi, request, result } = createMockPi();
			registerCtxLifecycleEvents(
				pi,
				deps(db, { runPiHistorianForWrapup, historianModel: undefined }),
			);
			recordPiLiveContext(sessionId, liveCtx(sessionId));

			await request(WRAPUP_REQUEST_EVENT);

			expect(await result(WRAPUP_RESULT_EVENT)).toEqual({
				sessionId,
				status: "skipped",
				reason: "historian-model-missing",
			});
			expect(runPiHistorianForWrapup).not.toHaveBeenCalled();
		} finally {
			closeQuietly(db);
		}
	});

	it("refuses when compaction is off", async () => {
		const db = createDb();
		try {
			const sessionId = session("pi-lifecycle-wrapup-off");
			const runPiHistorianForWrapup = mock(async () => {});
			const { pi, request, result } = createMockPi();
			registerCtxLifecycleEvents(
				pi,
				deps(db, { runPiHistorianForWrapup, compactionOff: true }),
			);
			recordPiLiveContext(sessionId, liveCtx(sessionId));

			await request(WRAPUP_REQUEST_EVENT);

			expect(await result(WRAPUP_RESULT_EVENT)).toEqual({
				sessionId,
				status: "skipped",
				reason: "compaction-off",
			});
			expect(runPiHistorianForWrapup).not.toHaveBeenCalled();
		} finally {
			closeQuietly(db);
		}
	});

	it("reports an already-running wrapup instead of changing history", async () => {
		const db = createDb();
		try {
			const sessionId = session("pi-lifecycle-wrapup-in-progress");
			const runPiHistorianForWrapup = mock(async () => {});
			const acquired = acquireWrapupInProgress(db, sessionId, {
				holderId: "other-process",
				messagesToKeep: 2,
				anchorRawMessageCount: 8,
				targetEligibleEndOrdinal: 6,
				lastCompartmentEnd: 0,
				chunkIndex: 0,
				expectedChunks: 1,
			});
			expect(acquired.ok).toBe(true);
			const { pi, request, result } = createMockPi();
			registerCtxLifecycleEvents(pi, deps(db, { runPiHistorianForWrapup }));
			recordPiLiveContext(sessionId, liveCtx(sessionId));

			await request(WRAPUP_REQUEST_EVENT, { messagesToKeep: 2 });

			expect(await result(WRAPUP_RESULT_EVENT)).toEqual({
				sessionId,
				status: "skipped",
				reason: "wrapup-in-progress",
			});
			expect(runPiHistorianForWrapup).not.toHaveBeenCalled();
		} finally {
			closeQuietly(db);
		}
	});

	it("rejects a messagesToKeep that is not a positive integer", async () => {
		const db = createDb();
		try {
			const sessionId = session("pi-lifecycle-invalid-request");
			const runPiHistorianForWrapup = mock(async () => {});
			const { pi, request, result } = createMockPi();
			registerCtxLifecycleEvents(pi, deps(db, { runPiHistorianForWrapup }));
			recordPiLiveContext(sessionId, liveCtx(sessionId));

			await request(WRAPUP_REQUEST_EVENT, { messagesToKeep: -1 });

			expect(await result(WRAPUP_RESULT_EVENT)).toEqual({
				status: "failed",
				reason: "invalid-request",
			});
			expect(runPiHistorianForWrapup).not.toHaveBeenCalled();
		} finally {
			closeQuietly(db);
		}
	});

	it("refuses a session with no recorded live context", async () => {
		const db = createDb();
		try {
			const sessionId = session("pi-lifecycle-stale");
			const { pi, request, result } = createMockPi();
			registerCtxLifecycleEvents(pi, deps(db));
			recordPiLiveContext(sessionId, liveCtx(sessionId));

			await request(WRAPUP_REQUEST_EVENT, { sessionId: "pi-lifecycle-other" });

			expect(await result(WRAPUP_RESULT_EVENT)).toEqual({
				sessionId: "pi-lifecycle-other",
				status: "skipped",
				reason: "no-live-context",
			});

			// A torn-down session must not be served from a context held after shutdown.
			clearContextHandlerSession(sessionId);
			const stale = createMockPi();
			registerCtxLifecycleEvents(stale.pi, deps(db));
			await stale.request(WRAPUP_REQUEST_EVENT, { sessionId });

			expect(await stale.result(WRAPUP_RESULT_EVENT)).toEqual({
				sessionId,
				status: "skipped",
				reason: "no-live-context",
			});
		} finally {
			closeQuietly(db);
		}
	});
});
