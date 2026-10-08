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
