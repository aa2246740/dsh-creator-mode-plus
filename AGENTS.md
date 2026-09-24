# Creator Mode+ repository orders

This repository contains only the DSH-side fixed bridge and its user preset. DSHX outside the Host is the supervisor. Official DeepSeek Harness runtime source outranks this repository when contracts disagree.

Read [docs/bridge-contract.md](docs/bridge-contract.md) and [docs/dshx-v0.7-alignment.md](docs/dshx-v0.7-alignment.md) before changing tool arguments, lifecycle behavior, compatibility ranges, installation, migration, or Harness-update guidance.

## Change gates

- Keep the model-facing surface to the ten named tools, including `dshx_hot_reload` and the session-bound `dshx_browser_open`. Every argument must remain schema-bounded and independently allowlisted in `src/runner.js`. Test the exact argv behind all ten tools; a registration-only test is insufficient.
- `dshx_hot_reload` accepts only a claimed plugin id. Derive Host/profile/port and session provenance inside the bridge. Require checked same-PID replacement and disposal evidence; it grants no shell, arbitrary path, or process-control authority. Module replacement never proves feature behavior.
- Require the complete stable DSHX `>=0.9.1 <0.10.0` contract, not only a matching version string. The desk pin is official `dsh-v0.1.7-rc.2` at `477b4f420553e8a52c2fbccc464d7561b239c443`. DSHX 0.9.0 and 0.7.9 stay outside this gate. Atomic same-Home Host discovery/attach, identity-bound start/restart/update gates, isolated verification Home, Creator, watched-plugin removal, external safe profile-bundle removal, proactive Guardian integrity quarantine, RC2 boot-manifest activation, managed-shell, Harness Update Assistant, and their knowledge contracts must be present before the bridge or installer mutates anything.
- Preserve bridge-v2 provenance: session id comes from `exec.agent.id`, not model input. Claim one plugin per session before any named operation; different plugins may run concurrently, while the same plugin fails closed for a second owner.
- Preserve workspace provenance: scaffold destination comes from `exec.agent.session.header.cwd`, never model input. If the Harness plugin path is outside that workspace, DSHX owns the atomic source-plus-symlink transaction.
- Preserve automatic `agent/created` Guardian arm (the replacement for the removed `agent/session-start`), agent-dispose claim release, adopted-launcher lifetime tracking, exact-session recovery steering, and incident acknowledgement. Recovery stays fire-and-forget so a failure cannot reject session creation. Never register or wrap Host signal handlers.
- Keep Host start, stop, restart, arbitrary shell, arbitrary argv, paths, profile selection, and ports outside model input.
- Treat App, direct CLI, and dshx as launchers for one long-lived Web Host per `DSH_HOME`. Duplicate/unknown Host visibility fails closed; isolated verification must never be retained.
- Keep Harness `update prepare`, `verify`, `apply`, and `rollback` outside the Creator session. DSHX v0.7 permits only read-only `update plan` from a managed shell; this does not become a bridge update tool.
- Preserve the ordered `activate-new-client` DSHX operation; profile linking and resolution happen before watched-patch mutation.
- Preserve the `dshx_remove_plugin` order: quarantine/remove the watched Host row, prove same-PID absence, use the official profile remover while the dependency exists, prove dependency/link absence, and detach only target-verified plugin-owned symlinks. Partial attempts resume from durable quarantine without rerunning package removal for an already-absent dependency. Preserve source and never expose recursive source deletion.
- Keep boot-captured bundle removal outside the ten-tool bridge. Creator Mode+ may hand it to external `dshx plugin remove`, but must never expose that command through the managed shell or reinterpret it as `dshx_remove_plugin` watched-row success.
- Keep the preset-scoped bash guard narrow: block claimed plugin-root, Harness-link, and active-profile teardown while allowing ordinary file/component cleanup inside a plugin. Guardian must independently quarantine a claimed watched row when its profile link disappears.
- Keep Host recovery outside DSH and bounded to one restart plus a crash-loop fuse. Official client-Loader recovery must remain same-origin, Host-stamped, uniquely attributed, quarantined before reload, and separate from arbitrary render/visual/function failures. Never expose internal `creator watch/release/disarm/client-failure/recovery` argv as model inputs.
- Treat preset generations as concurrent. Any process-global route or resource must use a Host-scoped lease shared across independently loaded module generations, and must have a regression test that mounts two generations before either is disposed.
- A managed upgrade that does not change `agent.cordis.yml` bytes must preserve that file's exact filesystem stamp. Do not retrigger preset generation for skill, metadata, or bundled-asset-only changes.
- Route structured outcomes by scope. A checked server with only module-HMR evidence pending returns HOT_RELOAD_READY and its next fixed action. Browser-adapter failures block browser verification, not independent activation. Real source, ownership, authentication and Host-identity failures block their dependent operation.
- Edit only this package and user-owned presets. Never patch Harness core or shipped presets.
- Retain source, Host, client-manifest, page-load, and visual evidence internally. User-facing updates state plugin completion, verified features and remaining work; expose operational details only for a user question or required user action.

## Release gate

Run `npm run check`, `DSHX_HARNESS=<absolute-checkout> npm run test:native`, `npm run verify:dshx -- --harness <absolute-checkout>`, `npm run verify:harness-install -- --harness <absolute-checkout>`, DSHX `check <absolute-package-path> --harness <absolute-checkout>`, and `npm pack --dry-run`. Inspect the exact staged paths before committing. A release is ready only when every fixed-tool argv and internal lifecycle hook traverses the allowlist, and provenance, cross-generation route leasing, same-origin Loader recovery, recovery steering, full v0.7 capability attestation, real shipped-Standard install, fresh-install, stamp-stable managed-upgrade, legacy-migration, and package-contract tests pass. Report RC2 static/package acceptance separately from live Host, page-load, and visual acceptance.

## User-confirmed takeover

`dshx_request_takeover({name})` is the only model-facing handoff entry. It uses
the public `userQuestions` service; an approval/request auto-allow or model
boolean is not confirmation. A Host-lifetime, durable ownership fence blocks
all tools in revoked old sessions except status and a new takeover request;
this is separate from the narrow destructive-shell guard. It persists across
preset generations, and never deletes session locks or restarts the Host.
