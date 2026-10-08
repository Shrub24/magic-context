# Proposal

## Why

Other Pi extensions (notably pi-herdsman) route work through virtual models that fan out to different physical models. When the physical model changes, the provider cache is already dead, which is the cheapest moment to flush pending drops and compact history. Magic Context only offers that action as the slash commands `/ctx-flush` and `/ctx-wrapup`, which an extension cannot invoke. The fork needs the same existing behaviour reachable programmatically.

## What Changes

- Magic Context (Pi and OMP) listens on the shared Pi event bus (`pi.events`) for two request events, `magic-context:flush` and `magic-context:wrapup`, and runs exactly the logic behind `/ctx-flush` and `/ctx-wrapup` for the targeted session.
- Each request is answered with a result event (`magic-context:flush-result`, `magic-context:wrapup-result`) so the caller can see what happened without parsing chat output.
- The flush and wrapup bodies are extracted from the command handlers into functions shared by the command and the event listener. Command behaviour is unchanged.
- No new automatic behaviour: nothing runs unless an extension emits a request.

## Capabilities

### New Capabilities
- `ctx-lifecycle-events`: external extensions can request a flush or a wrapup of a Magic Context session over the Pi event bus and receive a structured result.

### Modified Capabilities

## Impact

- `packages/pi-plugin/src/commands/ctx-flush.ts`, `ctx-wrapup.ts`, `index.ts`; one new file for the event bridge.
- Upstream-conflict risk: low-to-moderate. The two command files are touched by upstream occasionally; the extraction keeps the diff to moving the handler bodies.
- Harness coverage: Pi and OMP covered (shared `pi-plugin`). OpenCode 1, OpenCode 2 and the Rust module are not applicable: they have no `pi.events` bus and no in-process extension peers.
- No schema, migration or cache-stability changes. The events invoke the existing flush and wrapup paths, so the m[0]/m[1] rules in ARCHITECTURE.md are untouched.
