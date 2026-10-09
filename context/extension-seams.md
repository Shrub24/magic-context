# Extension seams

## Expose flush and wrapup over pi.events

**Id:** bfa319e2-6463-4f91-b09a-18ae3e664180
**Type:** decision
**Status:** active
**Evidence:** confirmed
**Source:** owner directive 2026-10-08; design in openspec/changes/expose-ctx-lifecycle-events/; implemented as jj change qtnqmylx
**Revisit when:** upstream changes the /ctx-flush or /ctx-wrapup bodies, or Pi changes the events bus contract

Another extension (pi-herdsman) routes work through virtual models that fan out to different physical models. When the physical model changes the provider cache is already dead, which is the cheapest moment to flush pending drops and compact history, but the fork offered those actions only as slash commands, which an extension cannot invoke.

Magic Context listens on pi.events for magic-context:flush and magic-context:wrapup and runs the same code as /ctx-flush and /ctx-wrapup, answering on the matching -result topic with status, reason and counts. The wrapup runs on the last live context recorded for the session and refuses a mismatched session id (no-live-context) rather than acting on a stale context.

**Reason:** extraction keeps the slash commands and the event bridge on one code path, and the request/result pair keeps the emitter decoupled from load order and module identity.

**Rejected alternative:** export an importable function from the package for the peer extension to call. Rejected because it couples extension load order and package identity, and breaks when two copies of the module load.

**Rejected alternative:** require the emitting extension to pass its own context. Rejected because contexts are not interchangeable across sessions and may be stale.

## Launcher-selectable memory policy

**Id:** 22885ede-1d45-4d07-aed7-4c8fc4708173
**Type:** decision
**Status:** active
**Evidence:** confirmed
**Source:** owner directive 2026-10-08 (MAGIC_CONTEXT_PROFILE chosen over a config-file argument); design in openspec/changes/launcher-memory-policy/; implemented as jj change yztkzkno
**Revisit when:** Pi gains per-session tool registration, or upstream adds a Pi session-metadata policy of its own

A spawned worker needs full compaction and search but must not write into the project's shared knowledge. Magic Context already had config profiles, but nothing outside the config file could select one, and no key expressed "read project knowledge, write none": memory.enabled removes the reads the goal needs, and memory.auto_promote leaves explicit ctx_memory writes working.

MAGIC_CONTEXT_PROFILE names a profile at process start, and its overlay is applied after the project tier. memory.read_only carries the policy: it withholds ctx_memory and ctx_note and turns historian fact promotion off, while the read side keeps using memory.enabled.

**Reason:** separating reads from writes is the smallest change that meets the goal, and a process-scoped variable fits a launcher that spawns one child per task. Applying the overlay last is what makes the policy trustworthy — profiles live in the user tier, so project config would otherwise win and a repository could re-enable what the launcher withheld.

**Rejected alternative:** reuse memory.enabled for the policy. Rejected because it removes the <project-memory> block and memory search, so it cannot express "read but do not write".

**Rejected alternative:** a separate memory bank via MAGIC_CONTEXT_STORAGE_DIR. Rejected because it splits the project's knowledge, breaks cross-session search, and adds a second database to keep in step.

**Rejected alternative:** a second subagent entry with compaction added. Rejected because it duplicates the entry, and the lean entry exists precisely because the full entry's event wiring is wrong for children.

**Rejected alternative:** apply the launcher overlay in its normal position. Rejected because a project config could then silently re-enable writes for a subagent.

## ctx_note is gated on read_only alone

**Id:** 061ea48e-8621-4f27-8b0e-db09f5c9c245
**Type:** decision
**Status:** active
**Evidence:** confirmed
**Source:** owner confirmation 2026-10-09, answering the implementation's contract question; implemented as jj change yztkzkno
**Revisit when:** upstream changes plugin/src/plugin/subagent-tool-policy.ts, or OpenCode starts honouring memory.read_only

memory.read_only withholds both tools that write project knowledge. memory.enabled keeps the scope it already had: it withholds ctx_memory and promotion, and never ctx_note.

**Reason:** notes are not all session-scoped — the notes table sweeps only type = 'session', so a smart note is project-owned and outlives the session, which is why read_only has to cover ctx_note at all. But memory.enabled is a feature switch that today leaves ctx_note working on both harnesses, so gating notes on it would change what a primary session may write, which this change does not set out to do, and would add a Pi-to-OpenCode divergence for PARITY.md to carry.

**Rejected alternative:** one combined write flag for both tools. Rejected because it silently changes memory-off behaviour on primary sessions and forks the harnesses.
