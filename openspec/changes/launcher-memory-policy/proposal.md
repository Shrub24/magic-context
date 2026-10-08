# Proposal

## Why

pi-herdsman runs subagents in their own Pi processes. Those subagents should get the full context machinery — compaction, the transform, `ctx_search`, `ctx_expand`, `ctx_reduce` — but must not write into the project's shared knowledge. Today the only lever is `memory.enabled: false`, which also removes the memory block from the prompt and the memory reads that a subagent legitimately needs.

The two subagent seams the fork wants are: a launcher-selectable profile, and a memory policy that separates reads from writes. The first is the selection channel; the second is the content it selects.

## What Changes

- New config key `memory.read_only` (default `false`). When true, the session reads project knowledge but does not write it: `ctx_memory` and `ctx_note` are absent from the tool set and refused if called, and historian fact promotion is off. The `<project-memory>` block, memory search and embeddings are unaffected.
- New environment variable `MAGIC_CONTEXT_PROFILE` selects a config profile by name at process start, applied after the project tier so a project config cannot weaken a launcher-selected policy.
- The config profile overlay accepts a `memory` block. It currently accepts only `historian` and `dreamer`.
- Pi and OMP only. OpenCode 1 and 2 keep upstream's subagent policy (which hides `ctx_memory`/`ctx_note` from subagents by session metadata); the Rust module is unaffected.

## Capabilities

### New Capabilities
- `launcher-profile-selection`: a process can select a config profile by environment variable instead of editing config files.
- `read-only-memory`: a session can be configured to read project knowledge without writing it.

### Modified Capabilities

## Impact

- `packages/plugin/src/config/schema/magic-context.ts` (new key, widened profile overlay), `packages/plugin/src/config/profiles.ts`, and both config loaders (`packages/plugin/src/config/index.ts`, `packages/pi-plugin/src/config/index.ts`).
- `packages/pi-plugin/src/index.ts` and `packages/pi-plugin/src/tools/index.ts` (write-side gating), `packages/pi-plugin/src/pi-historian-runner.ts` (promotion).
- Upstream-conflict risk: moderate. `config/schema/magic-context.ts`, `config/profiles.ts` and `tools/index.ts` are all touched by upstream regularly. The change is additive in each: one key, one schema field, one parameter, one env read.
- Harness coverage: Pi and OMP covered. OpenCode 1 and 2 are explicitly out of scope for `memory.read_only` — upstream's subagent tool policy already covers their case — and the key is documented as not honoured there. The Rust module does not read config profiles.
- No schema migration and no cache-stability change. The m[0]/m[1] contract is untouched: a read-only session keeps the memory block, so its cached prefix bytes match a normal session's.
