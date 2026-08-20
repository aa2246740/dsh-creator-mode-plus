# dsh-creator-mode-plus

**Creator Mode+** is a standalone, fail-closed DeepSeek Harness plugin that lets a normal DSH WebUI session create and activate file-backed plugins through [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit).

It does not replace the official Creator Mode and does not modify Harness core. The DSH session receives five fixed tools; the external DSHX CLI remains the supervisor for process restart, rollback, and evidence.

This project is unofficial and is not affiliated with DeepSeek.

## Compatibility

| Component | Initial supported range |
|---|---|
| DeepSeek Harness | `dsh-v0.1.0-rc.8` |
| DSHX | `>=0.5.1 <0.6.0` |
| Creator Bridge | `v1` |
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

DSHX v0.5.1 can remain installed. Add the standalone package first, then migrate the managed preset row:

```sh
cd /path/to/deepseek-harness
git clone https://github.com/aa2246740/dsh-creator-mode-plus.git tools/dsh-creator-mode-plus
pnpm dsh plugin --profile web add link:./tools/dsh-creator-mode-plus
node tools/dsh-creator-mode-plus/scripts/install.mjs --harness "$PWD" --migrate-legacy
```

Migration preserves the existing user composition and preset directory. It replaces only the recognized bundled plugin row, managed skill, and preset metadata. Ambiguous or modified managed rows fail closed.

Because the profile gained a new dependency, restart the Web Host once from outside the session and verify a new Creator Mode+ session. Remove the old profile dependency only after that verification; migration does not remove it automatically.

## Update

```sh
git -C tools/dsh-creator-mode-plus pull --ff-only
node tools/dsh-creator-mode-plus/scripts/install.mjs --harness "$PWD" --upgrade
```

- Skill or preset metadata only: use a new or blank session; no Host restart.
- `src/*.js` bridge code: classify as `server`; restart the Host externally unless exact server HMR was separately proved.
- Compatible DSHX update inside the table above: no Creator Mode+ update is required.
- DSHX outside the supported range: Creator Mode+ stops until a compatible release explicitly expands the range.

## Fixed tool surface

| Tool | Effect | Live mutation |
|---|---|---|
| `dshx_status` | Read external supervisor and Host status | No |
| `dshx_scaffold` | Create `my-plugins/<id>` without overwrite | Files only |
| `dshx_check` | Static and built-client contract checks | No |
| `dshx_activation_plan` | Classify one lifecycle branch | No |
| `dshx_activate_new_client` | Ordered link, resolution, watched patch, current-Host manifest proof | Bounded new-client registration |

The bridge accepts no arbitrary shell string, argv vector, path, profile, port, or process-control operation from the model. `dshx_activate_new_client` derives the active Web port from the Host process and never reloads the browser or restarts DSH.

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
