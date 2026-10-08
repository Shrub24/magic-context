/**
 * The write half of the memory policy.
 *
 * `memory.read_only` withholds every write a session could make into project
 * knowledge — the `ctx_memory`/`ctx_note` tool surface, the call-time refusals,
 * and historian fact promotion — while the read side (`<project-memory>`,
 * `ctx_search` memory results, memory embeddings) keeps using `memory.enabled`.
 *
 * `memory.enabled` keeps its existing scope: it is the memory feature switch, so
 * it withholds `ctx_memory` and promotion but never `ctx_note`. That keeps Pi's
 * `ctx_note` behaviour identical to OpenCode's, which leaves the tool registered
 * when memory is off.
 *
 * Honoured on Pi and OMP, where the resolved config feeds the tool surface and
 * the historian options. OpenCode keeps upstream's primary-only subagent tool
 * policy, so these helpers are not consulted there (see `packages/pi-plugin/PARITY.md` §24).
 */

export interface MemoryPolicyConfig {
    enabled?: boolean;
    read_only?: boolean;
    auto_promote?: boolean;
}

/** True when the session may write memories (`memory.enabled` and `memory.read_only`). */
export function memoryWritesEnabled(memory: MemoryPolicyConfig): boolean {
    return memory.enabled !== false && memory.read_only !== true;
}

/** True when the session may write notes: only `memory.read_only` withholds them. */
export function notesWritesEnabled(memory: MemoryPolicyConfig): boolean {
    return memory.read_only !== true;
}

/** Automatic fact promotion needs write access on top of `memory.auto_promote`. */
export function memoryPromotionEnabled(memory: MemoryPolicyConfig): boolean {
    return memoryWritesEnabled(memory) && memory.auto_promote !== false;
}
