# DSHX v0.7 alignment

Creator Mode+ 0.3.2 is aligned to stable DSHX `>=0.7.3 <0.8.0`, Creator Bridge
v2, and the official browser WebUI lifecycle. DSHX v0.7.3 keeps v0.7.2's RC2
boot-manifest parser, corrected fresh-client order, watched-plugin safe removal,
and proactive integrity quarantine, then adds safe profile bundle removal for
the dependency-deleted/stale-Loader failure seam.

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
| Safe plugin removal | `dshx_remove_plugin` owns live-row quarantine → same-Host absence → official profile remove → target-verified symlink detach; partial RC8 removals resume from durable quarantine | Exit 0 reaches `HOST_TREE_INACTIVE` and `PROFILE_DEPENDENCY_REMOVED`; `detached-orphan-symlink` is bounded to this claim and source remains preserved |
| External bundle removal | Creator stops at boot-captured bundle evidence and hands off to external `dshx plugin remove`; DSHX owns tombstone → same-PID absence → official remove → later-boot cleanup | Not an eighth tool; current Host is not restarted and old pages may still need refresh |
| Guardian | Session start arms external recovery; Host, official Loader, and claimed-link integrity failures use exact attribution and quarantine | Recovery does not prove render, visual, or functional correctness |
| Harness Update Assistant | A managed shell may inspect read-only `dshx update plan`; `prepare`, `verify`, `apply`, and `rollback` stay outside DSH | Candidate verified, locally applied, live runtime accepted, and production activated are different states |

## Why there are seven tools

DSHX v0.7.2 adds one bounded tool because whole-plugin teardown previously let a
Creator Agent delete source/profile links before removing the live watched row.
`dshx_remove_plugin` closes that lifecycle gap without accepting paths, shell, or
process control. The transactional Harness Update Assistant still does not widen
Creator Bridge v2: Harness replacement and rollback can change the process that
owns the current session, so they remain external-supervisor operations. Adding
an `update` bridge tool as an eighth tool would erase that authority boundary. Read-only
`dshx update plan` is permitted by DSHX's managed-shell gate and is documented in
the preset skill as inventory only.
DSHX v0.7.3's external bundle transaction likewise does not widen the bridge:
it requires supervisor-owned profile/port context and may span a later App boot.

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

Moving from Creator Mode+ 0.3.0 to 0.3.1 changed the server bridge runtime by
adding safe removal and the preset-scoped bash guard, so that older jump still
requires one controlled external `server`-branch restart. Moving from 0.3.1 to
0.3.2 tightens the server compatibility preflight to DSHX 0.7.3 and refreshes
the managed skill without changing the seven-tool surface or preset composition.
Run the installer with `--upgrade` outside the Agent session. The current Host
may remain on its boot-loaded bridge until the next normal App reopen; unchanged
composition bytes and filesystem stamp do not justify a restart alone.
