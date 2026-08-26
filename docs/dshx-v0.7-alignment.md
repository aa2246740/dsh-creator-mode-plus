# DSHX v0.7 alignment

Creator Mode+ 0.3.0 is aligned to stable DSHX `>=0.7.0 <0.8.0`, Creator Bridge
v2, and the official browser WebUI lifecycle. The pinned baseline for this
alignment is DSHX `v0.7.0` (`2676f259fff7492eebd8bc8823c0f5012ae7adf3`).

This is a contract alignment, not a version-number exception. Before the bridge
or installer mutates anything, it verifies the DSHX package identity, stable
version range, CLI and Creator/Guardian implementation, seven-surface activation
contract, managed-shell gate, and transactional Harness Update Assistant.

## Ownership matrix

| DSHX v0.7 surface | Creator Mode+ 0.3 behavior | Evidence boundary |
|---|---|---|
| Session claims | `dshx_claim_plugin`; every named operation refreshes the claim | Claim success is ownership, not build or activation |
| Workspace scaffold | `dshx_scaffold` takes only id/kind; DSHX derives the immutable session workspace and owns any `my-plugins` link | Returned source path is the only edit target |
| Static/client checks | `dshx_check` | Exit 0 proves `SOURCE_BUILT` only |
| Seven activation surfaces | `dshx_activation_plan` selects exactly one of patch, manifest, preset, client, new-client, server, or artifact | Dependency installation is not activation |
| New Web client | `dshx_activate_new_client` owns link → resolution → watched transaction → current manifest | Exit 0 reaches `CLIENT_MANIFEST_PRESENT`; the page still needs reload and observation |
| Guardian | Session start arms external recovery; Host and official Loader failures use exact attribution, quarantine, one recovery, and a fuse | Recovery does not prove render, visual, or functional correctness |
| Harness Update Assistant | A managed shell may inspect read-only `dshx update plan`; `prepare`, `verify`, `apply`, and `rollback` stay outside DSH | Candidate verified, locally applied, live runtime accepted, and production activated are different states |

## Why there are still six tools

DSHX v0.7 adds the transactional Harness Update Assistant, but it does not widen
Creator Bridge v2. Harness replacement and rollback can change the process that
owns the current session, so they remain external-supervisor operations. Adding
an `update` bridge tool would erase that authority boundary. Read-only
`dshx update plan` is permitted by DSHX's managed-shell gate and is documented in
the preset skill as inventory only.

## Harness compatibility

The source line covers the DSH `dsh-v0.1.0-rc.8` Creator/Guardian contracts and
the DSHX v0.7 update path to `dsh-v0.1.1-rc.2`. Release verification against an
RC2 checkout must include:

```sh
npm run check
npm run verify:dshx -- --harness /absolute/path/to/deepseek-harness
npm run verify:harness-install -- --harness /absolute/path/to/deepseek-harness
/absolute/path/to/deepseek-harness/tools/dshx/skill/dshx/scripts/dshx.sh \
  check /absolute/path/to/dsh-creator-mode-plus \
  --harness /absolute/path/to/deepseek-harness
npm pack --dry-run
```

These commands establish source, contract, and packaged-artifact readiness. They
do not establish that a running profile has loaded this release. The release
report must keep these layers separate:

```text
SOURCE_BUILT
ARTIFACT_SYNCED
NEXT_BOOT_REGISTERED
PRESET_ROSTER_VISIBLE
PRESET_SESSION_ACTIVE
HOST_TREE_ACTIVE
CLIENT_MANIFEST_PRESENT
CLIENT_LOADED
VISUAL_BEHAVIOR_VERIFIED
```

## Upgrade activation

Moving from Creator Mode+ 0.2.x to 0.3.0 changes the server bridge runtime, the
browser sentry package bytes, and managed preset assets. Run the installer with
`--upgrade` outside the Agent session. Because the server module itself changed,
an already-running Host needs one controlled external restart to load 0.3.0.
That restart is the `server` activation branch; it is not required for ordinary
preset discovery or future skill-only refreshes whose composition bytes and
filesystem stamp remain unchanged.
