# Spec Delta

## Purpose

Lets a session read the project's knowledge without writing to it, so a subagent can run with full compaction and search while leaving the project's memories and notes untouched.

## ADDED Requirements

### Requirement: Read-only memory key
Magic Context SHALL accept `memory.read_only` (default `false`), and SHALL treat a session with `memory.read_only: true` as able to read project knowledge but not write it.

#### Scenario: Writes are withheld
- **WHEN** a session resolves `memory.read_only: true`
- **THEN** `ctx_memory` and `ctx_note` are absent from the session's tool set

#### Scenario: A withheld tool is refused
- **WHEN** `ctx_memory` or `ctx_note` is called in a read-only session
- **THEN** the call is refused with a message naming the tool and the read-only policy, and nothing is written

#### Scenario: Reads are unaffected
- **WHEN** a session resolves `memory.read_only: true`
- **THEN** the `<project-memory>` block still renders, `ctx_search` still returns memories, and `ctx_search`, `ctx_expand` and `ctx_reduce` stay available

#### Scenario: Promotion is off
- **WHEN** a read-only session compacts history
- **THEN** compartments are written and no facts are promoted into memories

#### Scenario: Primary sessions are unchanged
- **WHEN** a session resolves `memory.read_only: false`
- **THEN** its tools, guidance, prompt bytes and promotion behaviour are unchanged from before this capability existed

#### Scenario: Interaction with `memory.enabled`
- **WHEN** `memory.enabled` is `false`
- **THEN** writes are withheld regardless of `memory.read_only`, and the existing no-memory behaviour (no memory block, no memory reads) is preserved
