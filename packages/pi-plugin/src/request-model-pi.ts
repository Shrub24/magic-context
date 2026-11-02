import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type PiModel = NonNullable<ExtensionContext["model"]>;
const requestModels = new Map<string, PiModel>();

export function resolvePiRequestContext(event: unknown, ctx: ExtensionContext): ExtensionContext {
	const model = (event as { requestModel?: PiModel }).requestModel;
	if (model === undefined) return ctx;
	if (
		!model ||
		typeof model.provider !== "string" ||
		!model.provider ||
		typeof model.id !== "string" ||
		!model.id ||
		typeof model.api !== "string" ||
		!model.api ||
		!Number.isFinite(model.contextWindow) ||
		model.contextWindow <= 0
	)
		throw new Error("Invalid Pi requestModel metadata");
	if (model.api === "pi-virtual") return ctx;
	// Keep the host context live; only this pass sees the request's model.
	return new Proxy(ctx, {
		get: (target, key) => (key === "model" ? model : Reflect.get(target, key, target)),
	});
}

export function recordPiRequestModel(sessionId: string, model: PiModel | undefined): void {
	if (model) requestModels.set(sessionId, model);
	else requestModels.delete(sessionId);
}

export function getPiRequestModel(sessionId: string): PiModel | undefined {
	return requestModels.get(sessionId);
}
