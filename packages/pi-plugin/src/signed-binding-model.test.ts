import { describe, expect, it } from "bun:test";
import { resolvePiSignedBindingModel } from "./context-handler";

const route = { provider: "route", id: "smart", api: "pi-virtual" };
const reply = (provider: string, model: string, stopReason = "stop") => ({
	role: "assistant",
	provider,
	model,
	stopReason,
});

describe("resolvePiSignedBindingModel", () => {
	it("keeps a directly selected model", () => {
		const direct = { provider: "anthropic", id: "claude-opus-5-5", api: "x" };
		expect(
			resolvePiSignedBindingModel(direct, [reply("openai", "gpt-6")]),
		).toEqual({ provider: "anthropic", id: "claude-opus-5-5" });
	});

	it("takes the latest successful physical response behind a route", () => {
		expect(
			resolvePiSignedBindingModel(route, [
				reply("anthropic", "claude-opus-5-5"),
				reply("openai", "gpt-6"),
				reply("anthropic", "claude-sonnet-5-5", "error"),
				reply("route", "smart"),
			]),
		).toEqual({ provider: "openai", id: "gpt-6" });
	});

	it("falls back to the route before any physical response", () => {
		expect(resolvePiSignedBindingModel(route, [])).toEqual({
			provider: "route",
			id: "smart",
		});
	});
});
