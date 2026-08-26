# Creator Bridge v2

Creator Mode+ is a user preset plus one DSH plugin. It brings six fixed DSHX
operations into an ordinary DSH session without giving that session control of
its Host process. Stable DSHX `>=0.7.1 <0.8.0` supplies workspace-aware
scaffolding, the external Guardian, durable recovery state, the seven-surface
activation contract, and the transactional Harness Update Assistant.

## Roles

| Role | Authority |
|---|---|
| Creator Mode+ session | Claim one plugin, create files, check contracts, plan activation, perform bounded new-client activation, read status |
| External DSHX Guardian | Monitor the Host, journal activation, quarantine a culprit, recover Host/official Loader failures, open a crash-loop fuse, persist incidents |
| User | Approve normal impactful activation and decide what to do after a fused or ambiguous incident |

The supervisor is outside DSH. It is not the model session and does not require
the user to watch every command. No model-facing tool accepts a shell string,
arbitrary argv/path/profile/port, or Host start/stop/restart operation.

The preset still inherits Standard's coding shell, but that shell is not the
external supervisor. RC8 and RC2 inject `DSH_SHELL=1` into every model shell
call; DSHX v0.7 rejects raw mutation/process commands at its CLI boundary. This
keeps an old or mistaken Creator session from bypassing the six fixed tools with
`dshx start`, `restart`, `activate-new-client`, or profile shipping commands.
The only Harness-update exception is read-only `dshx update plan`; the mutating
update stages remain outside the Host.

## Fixed argv contract

The six model-facing tools map to exactly these child CLI shapes:

| Tool | Allowed child argv |
|---|---|
| `dshx_status` | `status` |
| `dshx_claim_plugin` | `creator claim <plugin-id>` |
| `dshx_scaffold` | `creator scaffold <plugin-id> <declared-kind>` |
| `dshx_check` | `check <plugin-id>` |
| `dshx_activation_plan` | `activation-plan <plugin-id> --change <declared-branch>` |
| `dshx_activate_new_client` | `activate-new-client <plugin-id> --profile web --port <Host-derived-port>` |

Session lifecycle may additionally call fixed internal watch, release, recovery
pull, and recovery acknowledgement argv. Tests must execute every row and every
internal lifecycle shape through the allowlist; registering a tool name does not
prove its child argv is reachable.

DSHX v0.7 does not add a seventh Creator tool. `update prepare`, `verify`,
`apply`, and `rollback` can replace or restore the process that owns the session,
so the fixed bridge cannot expose them. Read-only `update plan` is available only
through DSHX's managed-shell gate and remains inventory rather than activation.

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
  `>=0.7.1 <0.8.0`;
- Creator claim/scaffold commands and Bridge v2 context validation;
- external Guardian and official Loader-failure recovery implementation;
- check, activation-plan, and bounded new-client command surfaces;
- the managed-shell gate and the transactional Harness Update Assistant;
- Creator+, Guardian, live-activation, and Harness-update knowledge contracts.

Missing or prerelease surfaces fail closed. Release verification also probes the
actual DSHX CLI version and contract markers through `npm run verify:dshx`;
fabricated fixture tests are not the live-checkout gate.

## New-client transaction

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
the current RC2 package/update line.

Outside acceptance: native menus, window chrome, App IPC, desktop bridges, and
shell-specific refresh behavior. A wrapper may work when it embeds the same
WebUI unchanged, but browser-WebUI reproduction is the defect gate.

Guardian proves Host process/HTTP recovery and the narrow official Loader-failure
recovery above. A component render exception, loaded package id, visual
correctness, and functional behavior remain separate evidence. These layers are
independent: `SOURCE_BUILT`, `ARTIFACT_SYNCED`, `NEXT_BOOT_REGISTERED`,
`PRESET_ROSTER_VISIBLE`, `PRESET_SESSION_ACTIVE`, `HOST_TREE_ACTIVE`,
`CLIENT_MANIFEST_PRESENT`, `CLIENT_LOADED`, and `VISUAL_BEHAVIOR_VERIFIED`.

Upgrading an already-loaded 0.2.x package to 0.3.0 changes the server bridge
module, so the external supervisor performs one controlled `server`-branch
restart. That is different from preset discovery: managed skill/metadata refresh
continues to preserve an unchanged `agent.cordis.yml` stamp and does not create a
new generation by itself.
