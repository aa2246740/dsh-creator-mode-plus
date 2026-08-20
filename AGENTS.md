# Creator Mode+ repository orders

This repository contains only the DSH-side fixed bridge and its user preset. DSHX outside the Host is the supervisor. Official DeepSeek Harness runtime source outranks this repository when contracts disagree.

Read [docs/bridge-contract.md](docs/bridge-contract.md) before changing tool arguments, lifecycle behavior, compatibility ranges, installation, or migration.

## Change gates

- Keep the model-facing surface to the six named tools. Every argument must remain schema-bounded and independently allowlisted in `src/runner.js`.
- Preserve bridge-v2 provenance: session id comes from `exec.agent.id`, not model input. Claim one plugin per session before any named operation; different plugins may run concurrently, while the same plugin fails closed for a second owner.
- Preserve automatic session-start Guardian arm, agent-dispose claim release, adopted-launcher lifetime tracking, exact-session recovery steering, and incident acknowledgement. Never register or wrap Host signal handlers.
- Keep Host start, stop, restart, arbitrary shell, arbitrary argv, paths, profile selection, and ports outside model input.
- Preserve the ordered `activate-new-client` DSHX operation; profile linking and resolution happen before watched-patch mutation.
- Keep Host recovery outside DSH and bounded to one restart plus a crash-loop fuse. Official client-Loader recovery must remain same-origin, Host-stamped, uniquely attributed, quarantined before reload, and separate from arbitrary render/visual/function failures. Never expose internal `creator watch/release/disarm/client-failure/recovery` argv as model inputs.
- Version incompatibility, ambiguous Harness discovery, an unknown managed preset row, or a nonzero DSHX result stops the branch.
- Edit only this package and user-owned presets. Never patch Harness core or shipped presets.
- Report source, Host, client-manifest, page-load, and visual evidence as separate layers.

## Release gate

Run `npm run check` and `npm pack --dry-run`. Inspect the exact staged paths before committing. A release is ready only when allowlist, provenance, same-origin Loader recovery, recovery steering, version-gate, fresh-install, managed-upgrade, and legacy-migration tests pass.
