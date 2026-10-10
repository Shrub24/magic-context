# Fork working notes

Personal fork of cortexkit/magic-context (`origin` = Shrub24, `upstream` = cortexkit). The fork exists to give my Pi extensions (../pi-extensions, notably pi-herdsman) two seams: lifecycle surfaces/triggers other extensions can use, and a launcher-selectable config profile (e.g. a subagent with full compaction and search but no memory ingestion). Architecture: ARCHITECTURE.md, STRUCTURE.md. Contribution rules for upstream: CONTRIBUTING.md.

## Principles

- **Stay rebase-friendly.** Prefer small additive changes at existing seams (config profiles, hooks) over rewrites. Do not reformat or move upstream code. Fork-only code goes in clearly named new files where possible.
- **Cover every harness** a change touches (OpenCode 1/2, Pi, OMP, Rust module) or mark it explicitly not applicable; see CONTRIBUTING.md.
- **Never edit the `mc:protected` region of ARCHITECTURE.md.** Cache-stability invariants there are load-bearing.
- Magic Context has its own config (`~/.config/cortexkit/magic-context.jsonc`, `.cortexkit/magic-context.jsonc`) and shared DB (`MAGIC_CONTEXT_STORAGE_DIR` relocates it). It does not use Pi settings.

## Workflow

- VCS is jj (colocated git); use the `jj` skill. Sync upstream with `jj git fetch --remote upstream`.
- Behaviour changes go through OpenSpec (`openspec/`): propose, then apply. Specs describe fork capabilities only. `openspec/` is local-only — it is excluded through `.git/info/exclude`, so the change and spec records stay on disk but out of the repository.
- Rationale that code cannot explain goes in `context/` via the `keep-the-why` skill.
- Nix packaging (`flake.nix`, `nix/`) is fork-only for now, shaped for upstream: `nix build` gives the Pi/OMP extension (`passthru.extensionPath`). `nix/bun.nix` is generated from `bun.lock`; after an upstream sync run `bun run update:nix` (no Nix needed; CI's `check:nix` fails while it is stale).
- Verify with `bun run typecheck`, `bun run lint`, and package tests (`bun run --cwd packages/<pkg> test`); Rust with `cargo test --workspace`. Rebuild dists with `bun run build:dists` after schema/migration changes.
