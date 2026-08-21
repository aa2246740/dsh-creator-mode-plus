# dsh-creator-mode-plus

**Creator Mode+** is a standalone, fail-closed DeepSeek Harness plugin that lets a normal DSH WebUI session create and activate file-backed plugins through [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit).

It does not replace the official Creator Mode and does not modify Harness core. The DSH session receives six fixed tools. Bridge v2 identifies the exact session and plugin while the external DSHX Guardian owns deterministic quarantine, one bounded Host recovery, official client-Loader boot recovery, and incident delivery.

This project is unofficial and is not affiliated with DeepSeek.

## Compatibility

| Component | Initial supported range |
|---|---|
| DeepSeek Harness | `dsh-v0.1.0-rc.8` |
| DSHX | `>=0.6.2 <0.7.0` |
| Creator Bridge | `v2` |
| UI boundary | Official browser WebUI and public Cordis/client extension points |

Creator Mode+ checks the installed DSHX version before every operation. An incompatible version stops with an explicit error before it mutates plugin or Host state.

DSHX and Creator Mode+ have independent releases. A compatible DSHX bug fix or internal refactor does not require a Creator Mode+ release. Update Creator Mode+ only when the bridge contract, a DSH plugin contract, or Creator Mode+ itself changes.

## Install

Run installation outside a DSH agent session:

```sh
cd /path/to/deepseek-harness
git clone https://github.com/aa2246740/dsh-creator-mode-plus.git tools/dsh-creator-mode-plus

# A profile dependency is a manifest change and applies on the next Host boot.
pnpm dsh plugin --profile web add link:./tools/dsh-creator-mode-plus

# Creates a user preset; never edits the shipped Standard or Creator preset.
node tools/dsh-creator-mode-plus/scripts/install.mjs --harness "$PWD"
```

Restart the Web Host once from outside the DSH session because the first command changed the profile manifest. Then open or refresh the official WebUI, select **Creator Mode+**, and start a new or still-blank session. Preset discovery itself does not require another Host restart.

## Migrate from the bundled DSHX version

Upgrade DSHX to v0.6.x first. Add the standalone package, then migrate the managed preset row:

```sh
cd /path/to/deepseek-harness
git clone https://github.com/aa2246740/dsh-creator-mode-plus.git tools/dsh-creator-mode-plus
pnpm dsh plugin --profile web add link:./tools/dsh-creator-mode-plus
node tools/dsh-creator-mode-plus/scripts/install.mjs --harness "$PWD" --migrate-legacy
```

Migration preserves the existing user composition and preset directory. It replaces only the recognized bundled plugin row (the historical `/creator-plus` form or DSHX 0.6 package-root form), managed skill, and preset metadata. Ambiguous or modified managed rows fail closed.

Because the profile gained a new dependency, restart the Web Host once from outside the session and verify a new Creator Mode+ session. Remove the old profile dependency only after that verification; migration does not remove it automatically.

## Update

```sh
git -C tools/dsh-creator-mode-plus pull --ff-only
node tools/dsh-creator-mode-plus/scripts/install.mjs --harness "$PWD" --upgrade
```

- The installer preserves the exact `agent.cordis.yml` stamp when its contents are unchanged, so a managed skill or metadata-only upgrade does not create another preset generation. Use a new or blank session; no Host restart.
- A real preset-composition change may leave old and new session generations alive together. Since 0.2.1, the fixed Host route is leased once per Web Host and is safe across those generations.
- One legacy exception: if 0.2.0 or older is already mounted when it is upgraded, restart that Web Host once from outside DSH. The old generation registered an unshared route that new code cannot safely take over. Future upgrades do not need this compatibility restart.
- `src/*.js` bridge code: classify as `server`; restart the Host externally unless exact server HMR was separately proved.
- Compatible DSHX update inside the table above: no Creator Mode+ update is required.
- DSHX outside the supported range: Creator Mode+ stops until a compatible release explicitly expands the range.

## Fixed tool surface

| Tool | Effect | Live mutation |
|---|---|---|
| `dshx_status` | Read external supervisor and Host status | No |
| `dshx_claim_plugin` | Give this exact session exclusive ownership of one plugin and arm Guardian | Claim only |
| `dshx_scaffold` | Create `my-plugins/<id>` without overwrite | Files only |
| `dshx_check` | Static and built-client contract checks | No |
| `dshx_activation_plan` | Classify one lifecycle branch | No |
| `dshx_activate_new_client` | Ordered link, resolution, watched patch, current-Host manifest proof | Bounded new-client registration |

The bridge accepts no arbitrary shell string, argv vector, path, profile, port, or process-control operation from the model. `dshx_activate_new_client` derives the active Web port from the Host process and never reloads the browser or restarts DSH.

All six tool-to-CLI mappings are exercised in release tests. If a fixed tool says
`outside bridge v2`, that is a bridge integrity defect—not a permission or
supervisor decision. Creator+ stops at that tool instead of mounting the plugin
manually or guessing that a later lifecycle stage succeeded.

For a new project, scaffold uses the trusted DSH session workspace rather than a
model-provided path. When that workspace is outside the Harness checkout, DSHX
creates the source there and atomically links it into `my-plugins`; the Agent can
edit within its normal sandbox and the user does not need to run `ln -s`.

Creator+ still inherits Standard's coding shell, but it is not the external
supervisor. DSHX 0.6 detects RC8's managed `DSH_SHELL=1` environment and rejects
raw mutating/process commands from that shell, so a stale agent cannot bypass
the fixed bridge with `dshx start`, `restart`, activation, or profile shipping.

## Concurrent sessions and self-recovery

Every Creator+ session-start arms a detached Guardian outside DSH. Once the plugin
id is known, the session calls `dshx_claim_plugin` before editing; every named tool
also refreshes that claim as a fail-safe.

- Any number of sessions may work on different plugins concurrently.
- The same plugin has one session owner; a second owner fails closed.
- Scaffold, edit, build, and check remain concurrent. Only the short watched-patch
  activation transaction uses a global lock.
- Every activation records the trusted session/call chain, Host pid/port, and exact
  patch preimage.

If the Web Host exits or remains unhealthy, Guardian attributes an active
transaction with high confidence or a same-port transaction from the last 15
seconds as probable. It quarantines that plugin, restores the port once, and
steers the incident to the owning persisted session when it resumes. A second
failure inside 30 seconds opens a fuse. If the App shell already restored the
port, Guardian does not create a duplicate listener.

Creator+ never installs a Host signal handler. Explicit DSHX stop/restart disarms
before signaling an owned Host; an adopted App launcher's exit disarms recovery
and ends any Guardian replacement still tied to that App lifetime. If the Host remains healthy but the official Web boot
page reports **Failed to load plugins**, the package's same-origin browser sentry
sends failed Loader ids to a fixed Host route. The Host stamps its own identity;
DSHX changes no row unless exactly one active/recent transaction or claimed
watched-patch plugin matches. It reloads once only after the current manifest
proves that entry absent.

This does not turn arbitrary browser problems into self-healing: component render
exceptions, visual defects, interaction defects, and wrong functional results
still require page/client diagnosis. See [the Bridge v2 contract](docs/bridge-contract.md).

## Evidence boundary

Creator Mode+ reports only observed layers:

```text
SOURCE_BUILT
ARTIFACT_SYNCED
NEXT_BOOT_REGISTERED
HOST_TREE_ACTIVE
CLIENT_MANIFEST_PRESENT
CLIENT_LOADED
VISUAL_BEHAVIOR_VERIFIED
```

`CLIENT_MANIFEST_PRESENT` means the current Host serves the client bundle. It does not prove that an already-open page loaded it; a new client still needs a page reload and real UI verification.

The complete safety contract is [docs/bridge-contract.md](docs/bridge-contract.md).

## Development

```sh
npm test
npm run check
npm pack --dry-run
```

## License

MIT. DeepSeek Harness and DSHX are separate projects with their own licenses.
