# Design

## Context

Recon findings that shape this design (all verified, cited by file):

- `memory.enabled` gates reads as well as writes: it removes the memory guidance text, the m[0]/m[1] memory block (`inject-compartments-pi.ts:418-421`) and memory search (`search.ts:911-923`). It cannot express "read but do not write".
- `memory.auto_promote: false` disables historian fact promotion but leaves explicit `ctx_memory` writes working. Neither existing key alone satisfies the goal.
- Promotion is gated identically on both harnesses: `embeddingActive && memoryEnabled !== false && autoPromote !== false` (`pi-plugin/src/pi-historian-runner.ts:1364`, `plugin/src/hooks/magic-context/compartment-runner-incremental.ts:945`).
- Config profile resolution (`config/profiles.ts:41`) takes `{userRaw, projectRaw}` and reads `profiles` from the **user tier only** (`:65-77`). Merge order at both choke points (`plugin/src/config/index.ts:799-815`, `pi-plugin/src/config/index.ts:629-645`) is `userBase → overlay → projectBase`, so **project config wins over a profile overlay**.
- The profile overlay schema is `.strict()` over `{historian, dreamer}` (`schema/magic-context.ts:456-465`), and an invalid `profiles` block is dropped wholesale, silently discarding the model overlay too (`profiles.ts:69-76`).
- No environment variable or flag can select a profile today; `MAGIC_CONTEXT_PROFILE` appears nowhere in source.
- Pi's write-side gating already exists for `memory.enabled`: `ctx_memory` is registered once and the *active set* is flipped per session by `syncCtxMemoryToolEnabled` (`pi-plugin/src/tools/index.ts:41`, called from `index.ts:1890`), guidance removal rides the same switch (PARITY.md §24), and a call-time gate exists (`tools/ctx-memory.ts:529`).
- `notes` rows are session-scoped only when `type = 'session'`; smart notes are project-owned and survive session deletion (`storage-session-tables.ts`, the comment on the `notes` row). A child's smart note is therefore searchable by the primary session.
- pi-herdsman forwards an `env` list to `herdr agent start` as `--env` (`pi-extensions/pi-herdsman/extension/herdr.ts:1028-1030`), so a process-scoped environment variable needs no new plumbing on the consumer side.

## Goals / Non-Goals

**Goals:** a launcher can start a Pi subagent that has full compaction and search but writes nothing into project knowledge; primary sessions are unaffected.

**Non-Goals:** a separate memory bank or storage directory; a second Pi subagent entry; hiding `ctx_search`, `ctx_expand` or `ctx_reduce`; wiring OpenCode; changing what a *primary* session may write.

## Decisions

1. **One new key, `memory.read_only`, with a derived write flag.** The implementation derives `memoryWritesEnabled = memory.enabled && !memory.read_only` and routes the write-side sites through it: Pi's `ctx_memory` registration/active set, its guidance removal, its call-time gate, and historian promotion. Read-side sites keep using `memory.enabled`, so the memory block, memory search and memory embeddings stay on. This is the smallest change that separates reads from writes, and it reuses machinery that already exists for `memory.enabled` rather than adding a parallel path.
   - Rejected: reusing `memory.enabled` — it removes the reads the goal requires.
   - Rejected: a separate memory bank via `MAGIC_CONTEXT_STORAGE_DIR` — it splits the project's knowledge, breaks cross-session search, and needs a second database to keep in step.
   - Rejected: a second subagent entry like `subagent-entry.ts` but with compaction — it duplicates the entry, and the lean entry exists precisely because the full entry's event wiring is wrong for children.
2. **`ctx_note` is included in the policy.** Notes are not all session-scoped: a smart note is project-owned, outlives the session and is searchable by the primary session, so a read-only session must not create one. This also matches the set upstream already treats as primary-only (`plugin/src/plugin/subagent-tool-policy.ts:5`). `memory.read_only` is what withholds `ctx_note`; `memory.enabled` keeps its current scope — `ctx_memory` and promotion only — because it is the memory feature switch and a memory-off session still writes notes on both harnesses. Gating notes on `memory.enabled` too would change what an existing primary session may write and add a Pi↔OpenCode divergence for nothing.
3. **`MAGIC_CONTEXT_PROFILE` selects a profile by name and is applied last.** The named profile's overlay is applied after the project tier, so a project config cannot weaken a launcher-selected policy. An unknown name logs a warning and falls back to normal resolution: a wrong profile name must not refuse a session.
   - Rejected: applying the env overlay in the normal position — a project config could then silently re-enable writes for a subagent.
   - Rejected: reading the variable inside `resolveConfigProfile` without changing precedence — same problem.
4. **Widen the profile overlay to accept `memory`, keeping `.strict()`.** A typo in a profile stays an error. This change does not alter the existing behaviour where an invalid `profiles` block is dropped wholesale; that is a separate defect worth its own change.
5. **Pi and OMP only.** OpenCode's subagent case is already solved upstream by session metadata (`isSubagent`), and there is no launcher need there. Wiring OpenCode would add a second, differently-shaped mechanism for the same outcome. `memory.read_only` is documented as not honoured on OpenCode rather than silently ignored.

## Risks / Trade-offs

- [A project config re-enables writes for a subagent] → the env-selected overlay is applied after the project tier (decision 3); covered by a test.
- [The memory guidance sentence is withheld while the `<project-memory>` block still renders] → the block is self-describing (`#id: fact` lines), and this is exactly what `memory.enabled: false` does today. Accepted for now; a read-only guidance variant is a possible follow-up.
- [Cache-prefix effect] → none for primary sessions, which never set `memory.read_only`. A child process starts with no prior prefix, so the withheld guidance sentence costs nothing there.
- [A wrong `MAGIC_CONTEXT_PROFILE` silently does nothing] → warn log naming the missing profile and the available ones.
- [Pi's coarse `sessionScopedToolsDisabled` already withholds `ctx_note` for the lean subagent entry] → the new gate must be finer, so that a read-only session keeps `ctx_expand` and `ctx_reduce`.
