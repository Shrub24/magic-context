# Tasks

## 1. Extract shared flush logic

- [ ] 1.1 Move the `/ctx-flush` body into an exported function used by the command; verify the existing ctx-flush signal tests still pass (`bun run --cwd packages/pi-plugin test`)
- [ ] 1.2 Widen `runPiWrapup` to accept `ExtensionContext`; verify `bun run --cwd packages/pi-plugin typecheck` and existing wrapup tests pass

## 2. Event bridge

- [ ] 2.1 Add the event bridge file registering `magic-context:flush` and `magic-context:wrapup` on `pi.events`, with the result topics and payload validation; verify with a unit test per spec scenario (flush, compaction-off, wrapup success, refused, invalid `messagesToKeep`)
- [ ] 2.2 Record the latest live context per session in the context handler and clear it on shutdown/replacement; verify a test that a stale or mismatched session id yields `no-live-context`
- [ ] 2.3 Register the bridge from `index.ts` next to the command registrations, not in `subagent-entry.ts`; verify children do not register it

## 3. Docs

- [ ] 3.1 Document the event topics and payloads in `docs/architecture/pi.md` and note OpenCode/Rust as not applicable in `packages/pi-plugin/PARITY.md`; verify `bun run lint` passes
