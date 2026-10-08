# Tasks

## 1. Config surface

- [ ] 1.1 Add `memory.read_only` to the config schema with a default of `false` and a doc comment; verify the schema tests pass (`bun run --cwd packages/plugin test`)
- [ ] 1.2 Widen the profile overlay schema to accept a `memory` block while keeping `.strict()`; verify an invalid `profiles` block is still rejected
- [ ] 1.3 Derive `memoryWritesEnabled = memory.enabled && !memory.read_only` in one place and expose it alongside the resolved config; verify with a unit test covering all four combinations of `enabled`/`read_only`

## 2. Launcher profile selection

- [ ] 2.1 Read `MAGIC_CONTEXT_PROFILE` in the Pi config loader and apply the named profile's overlay after the project tier; verify with a test that a project-tier `memory.read_only: false` cannot override a launcher-selected `true`
- [ ] 2.2 Warn and fall back to normal resolution when the named profile does not exist; verify the session still loads and the warning names the missing profile
- [ ] 2.3 Verify an unset variable leaves resolution byte-identical to today (`bun run --cwd packages/pi-plugin test`)

## 3. Read-only memory on Pi

- [ ] 3.1 Gate `ctx_memory` registration, the per-session active set, its guidance removal and its call-time gate on the derived write flag; verify a read-only session has no `ctx_memory` and a direct call is refused
- [ ] 3.2 Gate `ctx_note` on the same flag with a gate finer than `sessionScopedToolsDisabled`; verify a read-only session keeps `ctx_search`, `ctx_expand` and `ctx_reduce`
- [ ] 3.3 Gate historian fact promotion on the derived write flag; verify compartments are still written and no facts are promoted in a read-only session
- [ ] 3.4 Verify a read-only session still renders the `<project-memory>` block and can read memories through `ctx_search`

## 4. Docs

- [ ] 4.1 Document `memory.read_only` and `MAGIC_CONTEXT_PROFILE` in the config reference, and record in `packages/pi-plugin/PARITY.md` that OpenCode does not honour the key (upstream's subagent policy covers it) ; verify `bun run lint` passes
- [ ] 4.2 Add the fork seam to `docs/architecture/pi.md` next to the lifecycle-events section
