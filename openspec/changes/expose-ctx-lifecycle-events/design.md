# Design

## Context

See proposal.md. `/ctx-flush` (`commands/ctx-flush.ts`) needs only `db` and a session id. `/ctx-wrapup` (`runPiWrapup` in `commands/ctx-wrapup.ts`) additionally reads the live Pi context: `sessionManager` (branch entries), `model`, `cwd`, `getContextUsage()` and `ui` for status. An event-bus listener receives a payload, not a command context.

## Goals / Non-Goals

**Goals:** request flush/wrapup from another extension; structured result; zero behaviour change for the slash commands.

**Non-Goals:** emitting lifecycle notifications (compaction started/finished, model changed) for observers; detecting model switches inside Magic Context; OpenCode/Rust parity; new compaction policy. Observers can come later as a second change.

## Decisions

1. **Pi event bus, two topics, result topics.** `pi.events` is already used by this plugin (subagent child lifecycle) and is the sanctioned cross-extension channel. Request/result pairs keep the emitter decoupled and testable. Alternative: a function exported from the package for the other extension to import. Rejected: couples load order and package identity across extensions, and breaks when two copies of the module load.
2. **Extract, do not reimplement.** The command handlers call shared functions; the listener calls the same functions. Alternative: have the listener synthesise a command invocation. Rejected: Pi gives extensions no supported way to run another extension's command with a context.
3. **Wrapup uses the last live context seen for the session.** Magic Context already receives a Pi context in its `context` hook on every pass. It records the latest one per session (cleared on session shutdown or replacement) and the wrapup listener uses it. `runPiWrapup` is widened from `ExtensionCommandContext` to `ExtensionContext`; it uses no command-only members. Alternative: require the emitter to pass a context. Rejected: extensions' contexts are not interchangeable and may be stale.
4. **Target session defaults to the active one.** Payload may carry `sessionId`; a request naming a session that is not the recorded live one is skipped, never run against a stale context.

## Risks / Trade-offs

- [A captured context goes stale after a session switch or replacement] → clear it on shutdown/replacement; verify the session id matches before use; report `no-live-context` otherwise.
- [Wrapup is long-running and the emitter fires during a turn] → the existing wrapup-in-progress marker and compartment lease already serialise it; the result event carries `skipped` when one is running. Emitters should prefer idle moments; this change does not add queueing.
- [Wrapup while the historian is running] → existing lease handling applies unchanged.
