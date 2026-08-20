# Changelog

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
