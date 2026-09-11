# DSHX v0.7 alignment

Creator Mode+ 0.3.5 is aligned to stable DSHX `>=0.7.5 <0.8.0`, Creator Bridge
v2, and the official browser WebUI lifecycle. DSHX v0.7.5 makes same-Home
ownership atomic across checkouts and binds PID, process start time, Home,
profile, and root before lifecycle or update mutation.

This is a contract alignment, not a version-number exception. Before the bridge
or installer mutates anything, it verifies the DSHX package identity, stable
version range, CLI and Creator/Guardian implementation, seven-surface activation
contract, managed-shell gate, and transactional Harness Update Assistant.

## Ownership matrix

| DSHX v0.7 surface | Creator Mode+ 0.3 behavior | Evidence boundary |
|---|---|---|
| Single-Home Host ownership | `dshx_status` must show one identity-bound attached/supervised same-Home Host and no collision/unknown candidate | App, direct CLI, and dshx are launchers; another port is not isolation |
| Isolated cold boot | external `verify-boot` uses a temporary Home and rejects `--keep` | It leaves the user's Host PID unchanged and does not prove live activation there |
| Session claims | `dshx_claim_plugin`; every named operation refreshes the claim | Claim success is ownership, not build or activation |
| Workspace scaffold | `dshx_scaffold` takes only id/kind; DSHX derives the immutable session workspace and owns any `my-plugins` link | Returned source path is the only edit target |
| Static/client checks | `dshx_check` | Exit 0 proves `SOURCE_BUILT` only |
| Seven activation surfaces | `dshx_activation_plan` selects exactly one of patch, manifest, preset, client, new-client, server, or artifact | Dependency installation is not activation |
| New Web client | `dshx_activate_new_client` owns link → resolution → watched transaction → current manifest | Exit 0 reaches `CLIENT_MANIFEST_PRESENT`; the page still needs reload and observation |
| Safe plugin removal | `dshx_remove_plugin` owns live-row quarantine → same-Host absence → official profile remove → target-verified symlink detach; partial RC8 removals resume from durable quarantine | Exit 0 reaches `HOST_TREE_INACTIVE` and `PROFILE_DEPENDENCY_REMOVED`; `detached-orphan-symlink` is bounded to this claim and source remains preserved |
| External bundle removal | Creator stops at boot-captured bundle evidence and hands off to external `dshx plugin remove`; DSHX owns tombstone → same-PID absence → official remove → later-boot cleanup | External-only operation; current Host is not restarted and old pages may still need refresh |
| Guardian | Session start arms external recovery; Host, official Loader, and claimed-link integrity failures use exact attribution and quarantine | Recovery does not prove render, visual, or functional correctness |
| Harness Update Assistant | A managed shell may inspect read-only `dshx update plan`; `prepare`, `verify`, `apply`, and `rollback` stay outside DSH | Candidate verified, locally applied, live runtime accepted, and production activated are different states |

## Why the eighth tool is bounded

The approved eighth tool is `dshx_hot_reload`, not a Harness update or process command. It accepts a single claimed plugin id; the bridge derives Host/profile/port and requires the DSHX bounded-same-pid-server-hot-reload capability. Same-PID module and cleanup evidence advances delivery only to functional verification. Unknown or unsupported targets remain pending without restart authority.

DSHX v0.7.2 adds one bounded tool because whole-plugin teardown previously let a
Creator Agent delete source/profile links before removing the live watched row.
`dshx_remove_plugin` closes that lifecycle gap without accepting paths, shell, or
process control. The transactional Harness Update Assistant still does not widen
Creator Bridge v2: Harness replacement and rollback can change the process that
owns the current session, so they remain external-supervisor operations. Adding
an `update` bridge tool would erase that authority boundary. Read-only
`dshx update plan` is permitted by DSHX's managed-shell gate and is documented in
the preset skill as inventory only.
DSHX v0.7.3's external bundle transaction likewise does not widen the bridge:
it requires supervisor-owned profile/port context and may span a later App boot.
DSHX v0.7.5's Host lock, identity binding, update guard, and verifier teardown stay outside the bridge;
Creator receives status but never gains process or port input.

## Harness compatibility

The source line covers the DSH `dsh-v0.1.0-rc.8` Creator/Guardian contracts and
the DSHX v0.7 update path through `dsh-v0.1.1-rc.2` and `dsh-v0.1.2-rc.1` to `dsh-v0.1.5-rc.2`.
The RC1 line includes relocated Standard discovery and authenticated Host proof.
`0.1.5-rc.2` is the current authenticated Web line; external plugins must pass `dshx check` with no `compat-015-*`.
Release verification against the selected checkout must include:

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

Server changes across these versions need live activation evidence, not a blanket
restart instruction. A server plan with `hostRestart: not-decided` keeps delivery
at `ACTIVATION_DECISION_REQUIRED`. It does not authorize process control.
Run the installer with `--upgrade` outside the Agent session; unchanged preset
composition bytes retain their stamp. Root Loader module HMR and preset-private
bridge replacement are distinct scopes and need separate proof. A module or
manifest receipt still requires exercising the changed feature. Use launcher
handoff only after an evidence-backed and authorized restart decision.

The local browser-access update additionally attests `private-browser-handoff`:
identity-bound private storage, official Connection input, bounded authentication
transport, and explicit browser-adapter execution. A version string alone does
not prove these capabilities. `HTTP_AUTHENTICATED`, `BROWSER_AUTHENTICATED`, and
feature acceptance remain separate evidence.


`session-browser-open` adds the no-argument `dshx_browser_open` as the ninth
standalone bridge tool. It requires DSHX's externally configured, session-bound
adapter snapshot support. Browser authentication runs privately; Host/process
control, arbitrary paths and credentials remain outside model input.
