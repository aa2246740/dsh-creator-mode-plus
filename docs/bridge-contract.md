# Creator Bridge v2

Creator Mode+ is a user preset plus one DSH plugin. It brings nine fixed DSHX
operations into an ordinary DSH session without giving that session control of
its Host process. Stable DSHX `>=0.7.5 <0.8.0` supplies atomic single-Home Host
discovery/attachment, temporary-Home cold-boot verification, workspace-aware
scaffolding, source-preserving watched-plugin removal, external safe profile-bundle
removal, proactive integrity quarantine, the external Guardian, durable recovery state, the seven-surface
activation contract, and the transactional Harness Update Assistant.

## Roles

| Role | Authority |
|---|---|
| Creator Mode+ session | Claim one plugin, create files, check contracts, plan activation, perform bounded new-client activation/removal or server hot replacement, read status |
| External DSHX Guardian | Monitor the Host, journal activation, quarantine a culprit or missing claimed link, recover Host/official Loader failures, open a crash-loop fuse, persist incidents |
| User | Approve normal impactful activation and decide what to do after a fused or ambiguous incident |

The supervisor is outside DSH. It is not the model session and does not require
the user to watch every command. No model-facing tool accepts a shell string,
arbitrary argv/path/profile/port, or Host start/stop/restart operation.

The preset still inherits Standard's coding shell, but that shell is not the
external supervisor. RC8 and RC2 inject `DSH_SHELL=1` into every model shell
call; DSHX v0.7 rejects raw mutation/process commands at its CLI boundary. This
keeps an old or mistaken Creator session from bypassing the nine fixed tools with
`dshx start`, `restart`, `activate-new-client`, or profile shipping commands.
The only Harness-update exception is read-only `dshx update plan`; the mutating
update stages remain outside the Host.

## Fixed argv contract

The nine model-facing tools map to exactly these child CLI shapes:

| Tool | Allowed child argv |
|---|---|
| `dshx_status` | `status` |
| `dshx_browser_open` | `browser open --json` |
| `dshx_claim_plugin` | `creator claim <plugin-id>` |
| `dshx_scaffold` | `creator scaffold <plugin-id> <declared-kind>` |
| `dshx_check` | `check <plugin-id>` |
| `dshx_activation_plan` | `activation-plan <plugin-id> --change <declared-branch>` |
| `dshx_activate_new_client` | `activate-new-client <plugin-id> --profile web --port <Host-derived-port>` |
| `dshx_remove_plugin` | `creator remove <plugin-id>` |
| `dshx_hot_reload` | `hot-reload <plugin-id> --profile web --port <Host-derived-port> --json` |

The approved eighth operation performs bounded official module HMR, not Host restart. The bridge supplies JSON output and trusted session/Host context, refreshes the claim first, and accepts no model-controlled path, profile, port, argv or shell. A successful module receipt remains pending functional verification; a failed attempt cannot reuse an earlier successful replacement receipt. The fixed tool accepts only root-scope receipts. Explicit preset-private replacement stays external and requires its own runtime acceptance, never a self-replacement tool or managed-shell bypass.

Multi-file server implementations declare exact package-relative `hotReload.artifacts` in `dshx.yml`. The receipt binds before/after hashes for that complete set and its exact watch roots. This matters because an entry-only reload can leave an imported helper cached. Creator+ declares its five server files, excluding its browser client; a self-upgrade must replace those files together and prove that the existing session uses the new tools.

The bridge appends a fixed `--json` output flag to activation-plan (not model input). Its session-local delivery journal stores plan/check metadata and validated hot-replacement receipts under the selected Harness `.dshx/creator-plus/deliveries`; credentials and conversation content are excluded. Status and session recovery expose pending delivery across normal launcher restarts. A new Host does not mark the feature accepted, and old module proof is labeled historical when its PID no longer matches. Status uses Connection authentication for same-origin manifest and bundle proof; actual behavior remains a separate required check.

Session lifecycle may additionally call fixed internal watch, release, recovery
pull, and recovery acknowledgement argv. Tests must execute every row and every
internal lifecycle shape through the allowlist; registering a tool name does not
prove its child argv is reachable.

DSHX v0.7.2 adds `dshx_remove_plugin` as the seventh Creator tool. `update prepare`, `verify`,
`apply`, and `rollback` remain outside the bridge because they can replace or restore the process that owns the session,
so the fixed bridge cannot expose them. Read-only `update plan` is available only
through DSHX's managed-shell gate and remains inventory rather than activation.
DSHX v0.7.3 adds the external `dshx plugin remove` transaction for boot-captured
profile bundles. It also stays outside the fixed bridge: it requires current
profile/port authority and may own a tombstone across App boots, so Creator
sessions may hand off to it but never execute it as a bridge tool or raw shell.

DSHX v0.7.4 makes App, direct CLI, and dshx launchers for one long-lived Web
Host per real `DSH_HOME`. `start` attaches to one existing Host, while duplicate
or unknown Host/Home evidence fails closed. `verify-boot` uses a temporary Home,
always tears it down, and rejects `--keep`. These remain external-supervisor
rules and do not grant process control to Creator.

DSHX v0.7.5 serializes same-Home start, restart, apply, and rollback across
Harness checkouts; binds PID, OS start time, Home, profile, and root; and
re-runs discovery after spawn. An affected or identity-unknown live Host blocks
installation-directory mutation.

`refusing an operation outside bridge v2` from one of these fixed tools means the
bridge contract itself is broken. The session reports the exact tool and error,
preserves the claim and source location, and stops. It must not reinterpret the
error as a supervisor decision, switch to raw shell or manual profile edits, move
the project, or report a later lifecycle stage as successful.

The scaffold command stamps the immutable session workspace from
`exec.agent.session.header.cwd`. If Harness `my-plugins/<id>` is outside that
writable workspace, DSHX creates the source below the workspace and creates the
Harness link atomically. The model supplies neither path, and the user is never
asked to add the link manually. For a fresh `new-client`, implementation, build,
and `dshx_check` follow scaffold before activation planning because the plan
validates the built lazy-CJS handoff. Other build-ready targets may plan as soon
as the target exists.

## Trusted identity and concurrent ownership

The bridge creates `DSHX_CREATOR_CONTEXT` from the tool execution object, never
from model input:

```text
exec.agent.id + callId + rootCallId
  + Host pid + Host parent pid + current Web port + bridge version
```

At `agent/session-start`, the bridge arms Guardian and pulls recovery incidents
for that exact persisted session. Once a plugin id is known, the session calls
`dshx_claim_plugin`; every other named-plugin operation refreshes the claim.

- One session owns at most one plugin at a time.
- Different sessions can own different plugins concurrently without a fixed cap.
- One plugin cannot have two session owners.
- Build/check work remains concurrent. Only the watched live-activation section
  uses a global inter-process lock.
- Claim and incident registries use atomic locks and rename; `agent/disposed`
  releases the lease, with a 24-hour expiry as the abnormal-exit fallback.

## Complete DSHX v0.7 preflight

The standalone package does not accept `0.7.x` by string alone. Before any fixed
operation or installer mutation it requires:

- package identity `dsh-external-plugin-devkit` and stable version
  `>=0.7.5 <0.8.0`;
- same-Home Web Host discovery/attach, three-state PID/port probes, and
  temporary-Home verification teardown;
- Creator claim/scaffold commands and Bridge v2 context validation;
- source-preserving watched-plugin removal, external safe profile-bundle
  removal, and proactive claimed-link integrity quarantine;
- external Guardian and official Loader-failure recovery implementation;
- check, activation-plan, and bounded new-client command surfaces;
- the managed-shell gate and the transactional Harness Update Assistant;
- Creator+, Guardian, live-activation, and Harness-update knowledge contracts.

Missing or prerelease surfaces fail closed. Release verification also probes the
actual DSHX CLI version and contract markers through `npm run verify:dshx`;
fabricated fixture tests are not the live-checkout gate.

## New-client transaction

### RC1 authenticated Host proof

The bridge obtains the current Host's startup URL from the public
`connection.authenticatedUrl()` API. It passes it only in the child process's
private `DSHX_WEB_STARTUP_URL` environment, never in model arguments, tool output,
session provenance or transaction journals. DSHX exchanges it for a cookie in
memory and binds every proof request to the selected loopback origin. Authenticated
activation and absence proofs use the same transport. HTTP 401/403 fails promptly
as `WEB_AUTH_REQUIRED`, rather than being overwritten by a polling timeout.

An authentication failure is an infrastructure blocker: preserve source and the
claim and repair the bridge. Keep Host authentication enabled. Do not ask the user
to paste credentials into chat. External launchers may supply the same private
environment input; DSHX does not discover credentials by scanning App logs.

Changing this already-loaded server bridge requires the server activation branch;
it does not imply that ordinary plugin creation requires Host restarts.

`dshx_activate_new_client({ name })` is the only bridge operation that mutates
live registration. Its sole model-controlled value is a lower-case kebab-case
plugin id.

```text
scaffold -> implement/build -> dshx check / SOURCE_BUILT
  -> activation-plan new-client exits 0
  -> add or confirm the official Web profile link
  -> prove package and lib/client.js resolution from that profile
  -> journal session/call/Host identity and the exact patch preimage
  -> insert or semantically retrigger one watched-patch row
  -> poll the current Host manifest and served client.js
  -> HOST_TREE_ACTIVE + CLIENT_MANIFEST_PRESENT
  -> browser reload remains separate
```

The order is invariant. A failed new row is rolled back by DSHX. A nonzero
result stops the branch; the session does not compensate with package
installation, manual profile edits, or a Host restart.

## Safe removal transaction

`dshx_remove_plugin({ name })` is the only whole-plugin teardown operation. Its
sole model-controlled value is the claimed lower-case kebab-case id.

```text
claim refresh
  -> remove a standalone watched insert row, or append one unique disabled override
  -> poll the same Host PID until its manifest no longer contains the id
  -> run official dsh plugin --profile web remove while the dependency exists
  -> prove profile dependency and node_modules entry are absent
  -> if RC8 left an orphan profile link, detach it only after target verification
  -> detach only a Harness my-plugins symlink
  -> preserve the source directory
  -> HOST_TREE_INACTIVE + PROFILE_DEPENDENCY_REMOVED (+ SOURCE_PRESERVED when observed)
```

If same-Host absence cannot be proved, the operation stops with its live row
quarantined and leaves the profile dependency, Harness link, and source intact.
If the official remover deleted the dependency but left `node_modules/<id>`, a
retry resumes from the durable quarantine without asking pnpm to remove an
already-absent dependency. It may report `detached-orphan-symlink` only when the
entry is a symlink whose resolved target is the claimed Harness/source path;
directories and outside targets fail closed without recursive cleanup.
Creator infrastructure ids cannot self-remove. The preset-scoped bash guard
blocks direct teardown of a claimed plugin root, its Harness link, and the active
DSH profile while permitting ordinary component/file cleanup inside the source.

## External profile-bundle removal handoff

`dshx_remove_plugin` stops when a package is a boot-captured bundle without a
bounded watched row. The Creator session reports that boundary and hands the
operation to the external supervisor:

```text
dshx plugin remove <package> --profile web --port <current-port>
  -> prove the same-name Loader row in current __DSH_BOOT__
  -> write or resume one exact disabled tombstone
  -> prove same-PID HOST_TREE_INACTIVE
  -> run the official profile remover
  -> prove dependency, bundle, and link absence
  -> retain the tombstone while the old boot is alive
  -> after a later normal App boot, rerun and remove it only with start-time proof
```

The command also resumes the dependency-gone/bundle-leftover failure seam. It
does not restart the Host, delete source, or grant process control to Creator.

## Guardian recovery

Guardian runs as a detached Node process outside the DSH Host. It evaluates Host
pid and loopback HTTP health and uses the same-port transaction journal for
attribution:

| Confidence | Evidence |
|---|---|
| `high` | An activation transaction is active when the Host fails |
| `probable` | The most recent unrecovered transaction finished within 15 seconds |
| `ambiguous` | No single short-window transaction can be named |

For high/probable attribution, Guardian restores an inserted row's exact
preimage or disables an existing row while retaining that preimage for a checked
retry. If another session has already changed the same patch, Guardian appends a
transaction-unique disabled override instead of overwriting the whole file with
an old snapshot; a retry removes only that marker. It never deletes plugin source.

```text
Host failed
  -> select active/recent same-port transaction
  -> quarantine the causal live row when attribution exists
  -> if another supervisor restored the port: do not open a duplicate listener
  -> otherwise restart the same Web target once
  -> a second failure inside 30 seconds opens the fuse
  -> persist incident
  -> steer incident to the owning session when it starts/resumes
  -> acknowledge delivery
```

An incident steering message interrupts normal work. The Agent inspects its
confidence, plugin, rollback and log excerpt, repairs preserved source, runs
`dshx_check`, and only then retries the original lifecycle branch.

Creator+ does not register or wrap Host SIGINT/SIGTERM handlers. Explicit DSHX
stop/restart disarms before signaling a DSHX-owned Host. An adopted Host records
its launcher pid; when that launcher exits, Guardian neither resurrects the child
nor leaves behind a Guardian replacement tied to that App lifetime. Manual DSHX
stop or restart refuses adopted official/App Hosts.

On every healthy cycle, Guardian also checks only claimed clients that are still
active in the watched patch. If such an id has lost its resolvable profile
package, Guardian removes the byte-identifiable standalone row or appends a
unique disabled override, waits for same-Host manifest absence, and records a
`plugin-integrity-failed` incident for the owning session. It does not delete
source, clean the profile dependency, stop, or restart the Host. This is an
independent fail-safe for an older Agent or script that bypassed the bridge and
prevents a later cold boot from consuming stale active configuration.

## Official client-Loader recovery

The package also contributes an immediate, self-contained browser client. It
listens to RC8 Loader status and the framework-free `Failed to load plugins` boot
page. It sends only bounded failed entry ids and error text to one same-origin
POST route. That Host route—not the browser or model—stamps Host pid, parent pid,
and port and invokes fixed `dshx creator client-failure` argv.

DSHX may quarantine only one exact candidate:

- an active same-port transaction whose plugin appears in the failed ids;
- one exact recent unrecovered transaction for a failed id; or
- one uniquely claimed failed id already present in the watched patch.

A stale Host identity, unknown id, or multiple candidates is ambiguous and
changes no plugin row. After quarantine, the bridge waits for the current Host
manifest to prove the id absent. Only then does the browser reload once. The
incident remains durable and is steered to its owning session. A failed report
gets one delayed retry to cover session-start/Guardian arm races; the browser
fuse prevents an unbounded reload loop.

The POST route is a Host-scoped leased resource, not a generation-scoped side
effect. RC8 may keep an older session generation alive while mounting a newer
one after the preset composition stamp changes. Independently loaded bridge
generations therefore share one route broker keyed by the WebServer instance;
the newest live generation handles requests, disposal falls back to another live
generation, and only the last lease unregisters the route. The installer also
preserves the exact composition-file stamp when its bytes are unchanged so
metadata-only upgrades do not manufacture a new generation.

## Harness Update Assistant boundary

The v0.7 update state machine is `plan → prepare → verify → apply`; `rollback`
requires an existing apply transaction. Creator Mode+ may inspect `plan` from a
managed shell after `dshx_status` proves one checkout. All later stages are
external-supervisor work.

The evidence labels are deliberately non-transitive:

- `plan` inventories tag/SHA, dirty state, and plugins; it proves no build.
- `prepare` proves an isolated candidate installed and built; it does not update
  the current checkout.
- `verify` proves candidate static/cold-boot gates; it does not activate the
  production Host or page.
- `apply` updates local source and artifacts transactionally; it does not restart
  or establish user-visible acceptance.
- `rollback` restores the recorded checkout, dependencies, and artifacts; it
  does not promise reversal of product-data migrations outside this contract.

The update assistant never silently stops or restarts a production Host. Creator
Mode+ must report candidate verified, applied locally, real runtime accepted, and
production activated as separate states.

## Compatibility and evidence boundary

Supported: the official DSH browser WebUI, public Cordis plugin forms, public
client runtime, and public UI slots across the RC8 Creator/Guardian contract and
the RC2 package/update line and the authenticated Web line through 0.1.5-rc.2.

Outside acceptance: native menus, window chrome, App IPC, desktop bridges, and
shell-specific refresh behavior. A wrapper may work when it embeds the same
WebUI unchanged, but browser-WebUI reproduction is the defect gate.

Guardian proves Host process/HTTP recovery and the narrow official Loader-failure
recovery above. A component render exception, loaded package id, visual
correctness, and functional behavior remain separate evidence. These layers are
independent: `SOURCE_BUILT`, `ARTIFACT_SYNCED`, `NEXT_BOOT_REGISTERED`,
`PRESET_ROSTER_VISIBLE`, `PRESET_SESSION_ACTIVE`, `HOST_TREE_ACTIVE`,
`CLIENT_MANIFEST_PRESENT`, `CLIENT_LOADED`, and `VISUAL_BEHAVIOR_VERIFIED`.

Changes to safe removal, the bash guard, Connection authentication or preflight
are server changes and need live activation evidence. They are not automatically
restart-required. An unproved server activation remains
`ACTIVATION_DECISION_REQUIRED`; a launcher handoff supplies identity, not approval.
Official HMR of a root Loader entry does not prove replacement of a preset-private
bridge. Keep that scope distinction explicit and verify the actual fixed-tool
behavior before claiming delivery. Managed upgrade preserves an unchanged
`agent.cordis.yml` stamp: skill/metadata refresh alone neither creates a generation
nor justifies an immediate restart. The approved eighth tool must traverse the
same allowlist and provenance gates as the existing operations before release.

## Private browser access

RC1 local Web authentication is independent of provider/account login. During
watch/claim, the bridge uses the official Connection startup URL to refresh an
owner-only, expiring DSHX handoff bound to Home, checkout, PID, process start and
port. The URL stays in private subprocess input; assembled stdout/stderr is
redacted. An older Connection without authenticatedUrl remains supported and
must still pass the actual unauthenticated Web proof.

Read `dshx kb cat contracts/browser-access` before browser testing. The managed
shell may run read-only `dshx browser status`. Use the no-argument fixed
`dshx_browser_open` to open this session's externally approved browser adapter.
Adapter configuration and raw bind/open commands remain external-supervisor work. A missing credential is `WEB_AUTH_REQUIRED`;
an unavailable permitted browser adapter is `BROWSER_ADAPTER_REQUIRED`. Do not
restart the Host, open a second Host/port, request account login, or switch to
another agent's browser to resolve either status. The external adapter uses its
own permitted browser context and receives private JSON on stdin. Browser
access does not prove the plugin feature works.

This works with official CLI, App, and DSHX launchers. Without Creator or a
DSHX-owned launcher, the user/launcher must privately bind the official startup
URL once per Host lifetime. Never infer credentials from an open port or request
a token in a conversation. Expired or changed-Host handoffs need refresh.


## Installation routing and candidate scope

Creator can install supported Web plugins through the fixed new-client operation;
the managed shell does not need a `dsh` executable. Existing-plugin branch trials
follow the bundled `existing-plugin-trials.md`: candidate preparation is separate
from promotion to the claimed target. No arbitrary source-retargeting operation
is added. Explicitly preserving the installed directory requires a scoped
external handoff, not an inferred Host restart.

Delivery output names the exact `sourcePath` and limits its evidence to that
path. `SOURCE_BUILD_REQUIRED` requests a fixed check of that target; undecided
server plans point to bounded hot reload only when unrelated plan gates passed.
Host mismatches and failed gates cannot receive runtime-verification guidance.


The ninth tool is session-bound browser opening, not process control. It requires
`session-browser-open`: external setup pins a reviewed self-contained executable
snapshot using `dshx browser configure <session-id> <absolute-adapter-path>`.
The no-argument tool selects only that session's snapshot, supplies authentication
privately, and returns whitelisted browser status. Raw managed-shell browser
configure/bind/open remains denied. Setup never opens a browser; only the later
fixed call does. A changed adapter requires external review and reconfiguration.
