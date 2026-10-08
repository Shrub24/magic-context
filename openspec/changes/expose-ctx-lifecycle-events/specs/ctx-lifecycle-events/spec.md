# Spec Delta

## Purpose

Lets other Pi extensions trigger Magic Context's flush and wrapup for a session and observe the outcome, without slash commands or chat parsing.

## ADDED Requirements

### Requirement: Flush request event
Magic Context SHALL perform the same action as `/ctx-flush` for the target session when `magic-context:flush` is emitted on the Pi event bus.

#### Scenario: Flush for the active session
- **WHEN** an extension emits `magic-context:flush` with no session id
- **THEN** pending drops for the active session are queued for the next provider call, history and system-prompt refresh are signalled, and a `magic-context:flush-result` event reports the pending-op count

#### Scenario: Compaction disabled
- **WHEN** compaction is disabled and `magic-context:flush` is emitted
- **THEN** nothing is flushed and the result event reports `status: "skipped"` with reason `compaction-off`

### Requirement: Wrapup request event
Magic Context SHALL perform the same action as `/ctx-wrapup` for the target session when `magic-context:wrapup` is emitted, honouring an optional `messagesToKeep` positive integer.

#### Scenario: Wrapup compacts older history
- **WHEN** an extension emits `magic-context:wrapup` for a primary session with more raw messages than `messagesToKeep`
- **THEN** older history is compacted into compartments and a `magic-context:wrapup-result` event reports success and the number of compartments written

#### Scenario: Refused wrapup is reported
- **WHEN** wrapup cannot run (subagent session, historian model not configured, compaction off, wrapup already in progress, or no live context for the session)
- **THEN** no history is changed and the result event reports `status: "skipped"` or `"failed"` with a reason

### Requirement: Invalid requests are rejected
Magic Context SHALL ignore request payloads that are malformed and report them via the result event instead of throwing into the emitter.

#### Scenario: Bad messagesToKeep
- **WHEN** `magic-context:wrapup` is emitted with `messagesToKeep` that is not a positive integer
- **THEN** the result event reports `status: "failed"` with reason `invalid-request` and nothing runs

### Requirement: Events add no automatic behaviour
Magic Context SHALL NOT run flush or wrapup in response to anything except an explicit request event or the existing slash commands.

#### Scenario: No listener side effects
- **WHEN** no extension emits a request event
- **THEN** Magic Context behaves exactly as before this capability existed
