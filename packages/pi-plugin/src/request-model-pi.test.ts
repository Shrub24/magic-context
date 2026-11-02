import { describe, expect, it } from "bun:test";
import {
	getHistorianFailureState,
	getOrCreateSessionMeta,
	incrementHistorianFailure,
	updateSessionMeta,
} from "@magic-context/core/features/magic-context/storage";
import { closeQuietly } from "@magic-context/core/shared/sqlite-helpers";
import { clearContextHandlerSession, registerPiContextHandler, resolvePiSignedBindingModel } from "./context-handler";
import { persistPiMessageEndModelMeta, persistPiPressureFromMessageEnd } from "./index";
import { getPiRequestModel, resolvePiRequestContext } from "./request-model-pi";
import { createFakePi, createTestDb, fakeContext, userMessage } from "./test-utils.test";

const physical = (id: string, contextWindow = 200_000) => ({
	provider: "anthropic",
	id,
	api: "anthropic-messages",
	contextWindow,
});

function fixture(sessionId: string) {
	const db = createTestDb();
	const fake = createFakePi();
	registerPiContextHandler(fake.pi as never, {
		db,
		protectedTags: 0,
		injection: { injectDocs: false, injectionBudgetTokens: 8000 },
		cacheTtlConfig: { "route/*": "1m", "anthropic/*": "never" },
	});
	const handler = fake.handlers.get("context")!;
	return {
		db,
		async pass(requestModel?: ReturnType<typeof physical>, route = "coder") {
			const messages = [userMessage("Continue working", 1)];
			const ctx = {
				...fakeContext(sessionId, process.cwd(), ["u1"], messages as never),
				model: {
					provider: "route",
					id: route,
					api: "pi-virtual",
					contextWindow: 1_000_000,
				},
				getContextUsage: () => ({ tokens: 1000, percent: 0.1, contextWindow: 1_000_000 }),
			};
			const result = await handler(
				{ messages, ...(requestModel ? { requestModel } : {}) } as never,
				ctx as never,
			);
			expect(result).toBeDefined();
			expect(ctx.model.provider).toBe("route");
			return result;
		},
		close() {
			clearContextHandlerSession(sessionId);
			closeQuietly(db);
		},
	};
}

describe("Pi request-model authority", () => {
	it("uses the current target's window for response pressure and clears authority on session teardown", async () => {
		const sid = "ses-request-model-window";
		const f = fixture(sid);
		try {
			await f.pass(physical("claude-sonnet", 100_000));
			await persistPiPressureFromMessageEnd({
				db: f.db,
				sessionId: sid,
				piContextWindow: 1_000_000,
				piModel: { provider: "route", id: "coder", contextWindow: 1_000_000 },
				message: {
					role: "assistant",
					provider: "anthropic",
					model: "claude-sonnet",
					stopReason: "stop",
					usage: {
						input: 50_000,
						output: 100,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 50_100,
					},
				},
			});
			const meta = getOrCreateSessionMeta(f.db, sid);
			expect(meta.lastContextPercentage).toBeGreaterThan(40);
			expect(meta.lastContextPercentage).toBeLessThan(95);
			clearContextHandlerSession(sid);
			expect(getPiRequestModel(sid)).toBeUndefined();
		} finally {
			f.close();
		}
	});

	it("keeps live host getters while rejecting invalid request metadata", () => {
		let selected = { provider: "route", id: "coder", api: "pi-virtual", contextWindow: 1_000_000 };
		const original = {
			...fakeContext("ses-request-model-view"),
			get model() {
				return selected;
			},
		};
		const current = physical("current");
		expect(resolvePiRequestContext({ requestModel: selected }, original as never)).toBe(original as never);
		const pass = resolvePiRequestContext({ requestModel: current }, original as never);
		expect(pass.model).toBe(current as never);
		expect(resolvePiSignedBindingModel(pass.model, [
			{ role: "assistant", provider: "openai", model: "older-target", stopReason: "stop" },
		])).toEqual({ provider: "anthropic", id: "current" });
		selected = physical("changed-selection");
		expect(original.model).toBe(selected);
		expect(pass.model).toBe(current as never);
		expect(resolvePiRequestContext({}, original as never)).toBe(original as never);
		expect(() =>
			resolvePiRequestContext(
				{ requestModel: { ...current, contextWindow: NaN } },
				original as never,
			),
		).toThrow("Invalid Pi requestModel metadata");
	});

	it("uses the current target for the first fold and message-end TTL, not the selection or a late response", async () => {
		const f = fixture("ses-request-model-first");
		try {
			await f.pass(physical("claude-sonnet"));
			expect(getOrCreateSessionMeta(f.db, "ses-request-model-first").cachedM0ModelKey).toBe(
				"anthropic/claude-sonnet",
			);
			persistPiMessageEndModelMeta({
				db: f.db,
				sessionId: "ses-request-model-first",
				selectedModelKey: "route/coder",
				message: {
					role: "assistant",
					provider: "openai",
					model: "older-reply",
					timestamp: 1,
				},
				cacheTtlConfig: { "route/*": "1m", "anthropic/*": "never", "openai/*": "5m" },
			});
			expect(getOrCreateSessionMeta(f.db, "ses-request-model-first").cacheTtl).toBe("never");
		} finally {
			f.close();
		}
	});

	it("applies the native reset on physical changes but not on route-only changes", async () => {
		const sid = "ses-request-model-switch";
		const f = fixture(sid);
		try {
			const first = await f.pass(physical("claude-sonnet"));
			incrementHistorianFailure(f.db, sid, "preserve until real switch");
			updateSessionMeta(f.db, sid, { clearedReasoningThroughTag: 20 });
			const replay = await f.pass(physical("claude-sonnet"), "reviewer");
			expect(JSON.stringify(replay)).toBe(JSON.stringify(first));
			expect(getHistorianFailureState(f.db, sid).failureCount).toBe(1);
			expect(getOrCreateSessionMeta(f.db, sid).clearedReasoningThroughTag).toBe(20);
			await f.pass(physical("claude-haiku"), "reviewer");
			expect(getHistorianFailureState(f.db, sid).failureCount).toBe(0);
			expect(getOrCreateSessionMeta(f.db, sid).clearedReasoningThroughTag).toBe(0);
			expect(getOrCreateSessionMeta(f.db, sid).cachedM0ModelKey).toBe(
				"anthropic/claude-haiku",
			);
		} finally {
			f.close();
		}
	});

	it("adopts request authority without treating a prior virtual selection as a physical switch", async () => {
		const sid = "ses-request-model-adoption";
		const f = fixture(sid);
		try {
			await f.pass();
			incrementHistorianFailure(f.db, sid, "preserve on first adoption");
			updateSessionMeta(f.db, sid, { clearedReasoningThroughTag: 20 });
			await f.pass(physical("claude-sonnet"));
			expect(getHistorianFailureState(f.db, sid).failureCount).toBe(1);
			expect(getOrCreateSessionMeta(f.db, sid).clearedReasoningThroughTag).toBe(20);
			expect(getOrCreateSessionMeta(f.db, sid).cachedM0ModelKey).toBe("anthropic/claude-sonnet");
		} finally { f.close(); }
	});

	it("preserves legacy selection policy when the field is absent", async () => {
		const f = fixture("ses-request-model-legacy");
		try {
			await f.pass();
			expect(getOrCreateSessionMeta(f.db, "ses-request-model-legacy").cachedM0ModelKey).toBe(
				"route/coder",
			);
			expect(getOrCreateSessionMeta(f.db, "ses-request-model-legacy").cacheTtl).toBe("1m");
		} finally {
			f.close();
		}
	});

	it("seeds a routed restart from physical evidence rather than selection history", async () => {
		const sid = "ses-request-model-restart";
		const f = fixture(sid);
		try {
			await f.pass(physical("claude-sonnet"));
			updateSessionMeta(f.db, sid, {
				lastObservedModelKey: "anthropic/claude-sonnet",
				clearedReasoningThroughTag: 20,
			});
			incrementHistorianFailure(f.db, sid, "preserve across same-model restart");
			clearContextHandlerSession(sid);
			await f.pass(physical("claude-sonnet"));
			expect(getHistorianFailureState(f.db, sid).failureCount).toBe(1);
			expect(getOrCreateSessionMeta(f.db, sid).clearedReasoningThroughTag).toBe(20);
			clearContextHandlerSession(sid);
			await f.pass(physical("claude-haiku"));
			expect(getHistorianFailureState(f.db, sid).failureCount).toBe(0);
		} finally {
			f.close();
		}
	});
});
