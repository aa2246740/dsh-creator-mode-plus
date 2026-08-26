# Creator Mode+ repository orders

This repository contains only the DSH-side fixed bridge and its user preset. DSHX outside the Host is the supervisor. Official DeepSeek Harness runtime source outranks this repository when contracts disagree.

Read [docs/bridge-contract.md](docs/bridge-contract.md) and [docs/dshx-v0.7-alignment.md](docs/dshx-v0.7-alignment.md) before changing tool arguments, lifecycle behavior, compatibility ranges, installation, migration, or Harness-update guidance.

## Change gates

- Keep the model-facing surface to the seven named tools. Every argument must remain schema-bounded and independently allowlisted in `src/runner.js`. Test the exact argv behind all seven tools; a registration-only test is insufficient.
- Require the complete stable DSHX `>=0.7.2 <0.8.0` contract, not only a matching version string. Creator, safe removal, proactive Guardian integrity quarantine, RC2 boot-manifest activation, managed-shell, Harness Update Assistant, and their knowledge contracts must be present before the bridge or installer mutates anything.
- Preserve bridge-v2 provenance: session id comes from `exec.agent.id`, not model input. Claim one plugin per session before any named operation; different plugins may run concurrently, while the same plugin fails closed for a second owner.
- Preserve workspace provenance: scaffold destination comes from `exec.agent.session.header.cwd`, never model input. If the Harness plugin path is outside that workspace, DSHX owns the atomic source-plus-symlink transaction.
- Preserve automatic session-start Guardian arm, agent-dispose claim release, adopted-launcher lifetime tracking, exact-session recovery steering, and incident acknowledgement. Never register or wrap Host signal handlers.
- Keep Host start, stop, restart, arbitrary shell, arbitrary argv, paths, profile selection, and ports outside model input.
- Keep Harness `update prepare`, `verify`, `apply`, and `rollback` outside the Creator session. DSHX v0.7 permits only read-only `update plan` from a managed shell; this does not become an eighth bridge tool.
- Preserve the ordered `activate-new-client` DSHX operation; profile linking and resolution happen before watched-patch mutation.
- Preserve the `dshx_remove_plugin` order: quarantine/remove the watched Host row, prove same-PID absence, use the official profile remover while the dependency exists, prove dependency/link absence, and detach only target-verified plugin-owned symlinks. Partial attempts resume from durable quarantine without rerunning package removal for an already-absent dependency. Preserve source and never expose recursive source deletion.
- Keep the preset-scoped bash guard narrow: block claimed plugin-root, Harness-link, and active-profile teardown while allowing ordinary file/component cleanup inside a plugin. Guardian must independently quarantine a claimed watched row when its profile link disappears.
- Keep Host recovery outside DSH and bounded to one restart plus a crash-loop fuse. Official client-Loader recovery must remain same-origin, Host-stamped, uniquely attributed, quarantined before reload, and separate from arbitrary render/visual/function failures. Never expose internal `creator watch/release/disarm/client-failure/recovery` argv as model inputs.
- Treat preset generations as concurrent. Any process-global route or resource must use a Host-scoped lease shared across independently loaded module generations, and must have a regression test that mounts two generations before either is disposed.
- A managed upgrade that does not change `agent.cordis.yml` bytes must preserve that file's exact filesystem stamp. Do not retrigger preset generation for skill, metadata, or bundled-asset-only changes.
- Version incompatibility, ambiguous Harness discovery, an unknown managed preset row, or a nonzero DSHX result stops the branch.
- Edit only this package and user-owned presets. Never patch Harness core or shipped presets.
- Report source, Host, client-manifest, page-load, and visual evidence as separate layers.

## Release gate

Run `npm run check`, `npm run verify:dshx -- --harness <absolute-checkout>`, `npm run verify:harness-install -- --harness <absolute-checkout>`, DSHX `check <absolute-package-path> --harness <absolute-checkout>`, and `npm pack --dry-run`. Inspect the exact staged paths before committing. A release is ready only when every fixed-tool argv and internal lifecycle hook traverses the allowlist, and provenance, cross-generation route leasing, same-origin Loader recovery, recovery steering, full v0.7 capability attestation, real shipped-Standard install, fresh-install, stamp-stable managed-upgrade, legacy-migration, and package-contract tests pass. Report RC2 static/package acceptance separately from live Host, page-load, and visual acceptance.
