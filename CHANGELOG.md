# Changelog

## 0.3.3 - 2026-09-01

- Require the complete DSHX `>=0.7.4 <0.8.0` surface, including same-Home Web Host discovery/attach, three-state PID/port probes, and temporary-Home `verify-boot` teardown.
- Teach the managed skill that App, direct `dsh web`, and dshx are launchers for one long-lived Host; collision or unknown visibility is a stop condition and `--keep` is unsafe.
- Keep the seven-tool bridge unchanged. Managed skill/metadata refresh remains stamp-stable when the user's preset composition is unchanged, so no immediate Host restart is required.

## 0.3.2 - 2026-08-31

- Require the complete DSHX `>=0.7.3 <0.8.0` surface, including the external `dshx plugin remove` profile-bundle transaction and its same-PID/tombstone guards.
- Teach Creator Mode+ to distinguish its fixed watched-row `dshx_remove_plugin` tool from boot-captured bundle removal, which is handed to the external supervisor without adding an eighth model tool.
- Keep managed preset composition stamp-stable; a running Host may load the stricter bridge preflight on its next normal App reopen instead of restarting only for this metadata/skill refresh.

## 0.3.1 - 2026-08-26

- Add `dshx_remove_plugin`, the seventh fixed tool. It deactivates the watched Host row, proves same-PID absence, runs official profile cleanup, detaches only target-verified symlinks, and preserves source. RC8 partial removals resume from durable quarantine and safely handle a package-manager orphan link without rerunning removal for an already-absent dependency.
- Add a preset-scoped monotonic bash guard for claimed plugin-root, Harness-link, and active-profile teardown while leaving ordinary component/file cleanup available.
- Require DSHX `>=0.7.2 <0.8.0`, including proactive Guardian quarantine when a claimed watched client loses its profile link while the Host is still healthy.
- Add regression coverage for the exact failure chain that previously left stale patch/profile registration and broke the next DSH cold boot.

## 0.3.0 - 2026-08-26

- Align the standalone bridge with the complete stable DSHX `>=0.7.1 <0.8.0` contract while keeping Creator Bridge v2 at six bounded model-facing tools.
- Require the RC2-compatible boot-manifest surface that recognizes both `window.__DSH_BOOT__` and `globalThis["__DSH_BOOT__"]` before any bridge or installer mutation.
- Unblock fresh client creation by enforcing scaffold → implement/build → `dshx_check` → `dshx_activation_plan` → same-PID activation; an unbuilt client scaffold is no longer asked to pass the plan gate.
- Replace version-only acceptance with a fail-closed capability preflight covering Creator claims/scaffold, Guardian, seven-surface activation, managed-shell policy, Harness Update Assistant, and their knowledge contracts.
- Make fresh install, managed upgrade, and legacy migration refuse an old or incomplete DSHX before writing user preset state; report the accepted DSHX version, bridge version, and contract id.
- Add a real-checkout verifier that probes DSHX's CLI version and contract markers, plus a portable `dshx.yml` so DSHX v0.7 can check this package directly on the current RC2 line.
- Teach the managed preset skill the Harness update state machine: only read-only `update plan` may run inside the session; `prepare`, `verify`, `apply`, `rollback`, and process control remain externally supervised.
- Expand evidence language with preset roster/session layers and keep candidate verification, local apply, live runtime acceptance, and production activation separate.
- Document the RC8-to-RC2 compatibility line and the one controlled server-branch restart required when a running Host upgrades from 0.2.x to 0.3.0.
- Test Node 22.19 and Node 24 in CI and package the compatibility verifier and DSHX manifest.

## 0.2.2 - 2026-08-21

- Fix the Bridge v2 allowlist so the registered `dshx_scaffold` and `dshx_activation_plan` tools can reach their exact four-argument CLI forms.
- Execute every fixed tool argv and internal session lifecycle hook through the allowlist in release tests.
- Treat a fixed-tool `outside bridge v2` rejection as a bridge integrity defect that stops the workflow without manual mounting or inferred downstream success.
- Require DSHX 0.6.2 and scaffold new source in the trusted writable session workspace, with an automatic fail-closed `my-plugins` link when Harness lives elsewhere.
- Scaffold before planning a new target, consult the DSHX knowledge bundle before broad source exploration, and stop speculative mutation when live behavior is already confirmed.

## 0.2.1 - 2026-08-21

- Share the fixed client-failure route across concurrent preset generations instead of registering one exact Host route per generation.
- Keep the newest live generation behind the shared route and unregister it only after the last generation is disposed.
- Preserve the exact `agent.cordis.yml` filesystem stamp when a managed upgrade changes only bundled assets or metadata, avoiding an unnecessary preset generation.
- Document the one-time external Host restart required when upgrading an already-mounted 0.2.0 or older generation, whose route predates the shared broker.

## 0.2.0 - 2026-08-20

- Upgrade to Creator Bridge v2 and require DSHX `>=0.6.0 <0.7.0`.
- Add trusted session/call/Host provenance and one-plugin-per-session claims.
- Allow concurrent Creator+ sessions on different plugins while serializing only live activation.
- Arm the external Guardian on session start and release claims on disposal without registering or wrapping Host signal handlers.
- Preserve the adopted App launcher's lifetime across Guardian replacements; launcher exit ends recovery and its replacement.
- Rely on DSHX's managed-shell boundary so stale Creator conversations cannot invoke raw Host mutation or process control.
- Deliver quarantined recovery incidents back to the exact persisted session with plugin-source steering and acknowledgement.
- Add a same-origin browser sentry and Host-stamped fixed route for official Loader failures; reload only after unique attribution, quarantine, and live-manifest absence.
- Keep all Host recovery external and bounded; no model-facing process control was added.

## 0.1.0 - 2026-08-20

- Publish Creator Mode+ as an independent DSH plugin and user preset.
- Expose five fixed DSHX bridge operations with no Host process control.
- Add fail-closed Harness discovery and DSHX `>=0.5.1 <0.6.0` compatibility gating.
- Preserve safe new-client ordering and layered activation evidence.
- Add transactional fresh install, managed upgrade, and bundled-DSHX migration.
