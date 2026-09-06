# Creator Mode+

[中文](README.md)

Pick Creator Mode+ in a normal DeepSeek Harness WebUI session. Eight fixed tools scaffold, check, mount, hot-replace supported server modules, and safely remove a file-backed plugin. The new hot-reload tool is an unreleased candidate capability and requires matching DSHX implementation surfaces, not just its version number. Version 0.3.4 aligns with DSHX v0.7.5: DSH.app, direct `dsh web`, and dshx share one identity-bound, atomically selected same-Home Web Host, while claims, safe removal, isolated verification, Guardian recovery, and the Harness Update Assistant remain fail closed.

This does not replace official Creator Mode. It does not patch Harness core. Unofficial.

![Opening Creator Mode+ in the official WebUI](docs/screenshots/mode-picker.gif)

In the official mode list, Creator Mode+ sits under Creator mode. The Chinese line is from the user preset.

![Creator Mode+ in the mode list](docs/screenshots/mode-picker.png)

After you pick it, a new session uses the eight fixed tools.

![Creator Mode+ selected](docs/screenshots/mode-selected.png)

## Install

Do this outside an agent session, from your Harness checkout:

```sh
cd /path/to/deepseek-harness
git clone https://github.com/aa2246740/dsh-creator-mode-plus.git tools/dsh-creator-mode-plus

# A profile dependency provides module resolution, not restart evidence.
pnpm dsh plugin --profile web add link:./tools/dsh-creator-mode-plus

# Writes a user preset. Leaves the shipped Standard and Creator presets alone.
node tools/dsh-creator-mode-plus/scripts/install.mjs --harness "$PWD"
```

Open the official WebUI, check the Creator Mode+ roster, and verify a new or still-blank session. Adding a profile dependency alone does not justify a Host restart; replacing already-loaded server code needs separate runtime evidence. Roster visibility also does not prove that the browser Guardian loaded: verify the current client graph and page separately.

The compatibility line covers the Creator/Guardian contracts from DSH `dsh-v0.1.0-rc.8` through `dsh-v0.1.1-rc.2` and the authenticated Web line `dsh-v0.1.2-rc.1`. It requires [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit) `>=0.7.5 <0.8.0` with every required capability. The installer additionally attests bounded same-PID hot reload, the same-Home operation lock, PID/start-time/Home/profile/root binding, and temporary-Home `verify-boot` teardown; any missing surface stops before preset mutation.

For a fresh browser plugin, the fixed order is scaffold, implement/build, `dshx_check`, `dshx_activation_plan`, then same-PID activation. An unbuilt scaffold is no longer required to pass an activation plan.

Migration and upgrade rules live in the [Bridge v2 contract](docs/bridge-contract.md); the complete release mapping is in [DSHX v0.7 alignment](docs/dshx-v0.7-alignment.md).

![Installer writing the user preset](docs/screenshots/install.png)

## The eight tools

| Tool | What it does |
|---|---|
| `dshx_status` | Read the supervisor and Host. No process change. |
| `dshx_claim_plugin` | Give this session exclusive ownership of one plugin. |
| `dshx_scaffold` | Create the project in the session workspace. Never overwrites. |
| `dshx_check` | Static checks. A pass only proves the source built. |
| `dshx_activation_plan` | Say whether this change needs a reload or a restart. |
| `dshx_activate_new_client` | Mount a new client in a fixed order. No browser reload. No DSH restart. |
| `dshx_remove_plugin` | Deactivate the current Host first, then clean the profile; detach links and preserve source. |
| `dshx_hot_reload` | Replace a supported server plugin on the same PID, proving generation replacement and temporary-resource disposal; behavior still needs verification. |

Whole-plugin teardown uses only `dshx_remove_plugin`. Ordinary files inside a component remain editable. Direct teardown of the claimed root, Harness link, or active profile is denied. If RC8 removes the dependency but leaves this plugin's `node_modules` symlink, the transaction resumes from durable quarantine and detaches it only when the target belongs exactly to this claim; directories and outside targets fail closed. If an older Agent bypasses the bridge, Guardian quarantines a stale watched row as soon as the profile link disappears while the Host is still healthy, before a cold boot can consume it.

That fixed tool handles watched-row plugins only. A boot-captured `dsh.profile.bundles` package is handed to the external supervisor command `dshx plugin remove <package> --profile web --port <current-port>`, which proves same-PID Loader absence before the official remover runs. This is not a model-facing operation and does not require restarting DSH merely to uninstall a plugin.

## Fail closed

A second install does not overwrite. Start, restart, and a garbage port are refused.

![Second install refused](docs/screenshots/already-installed.png)

How Guardian quarantines, restarts once, and hands the incident back to the same session is in the contract. Not here.

## Harness update boundary

DSHX v0.7 adds `update plan → prepare → verify → apply` and exact `rollback`, but the seventh Creator tool is safe removal, not Harness update. A managed shell may read `update plan`; `prepare`, `verify`, `apply`, `rollback`, and Host process control remain external-supervisor operations. Candidate verified, locally applied, real-runtime accepted, and production activated are separate states.

## Upgrade

Run outside an Agent session:

```sh
cd /path/to/deepseek-harness/tools/dsh-creator-mode-plus
git pull --ff-only
node scripts/install.mjs --harness /path/to/deepseek-harness --upgrade
npm run verify:dshx -- --harness /path/to/deepseek-harness
```

Version 0.3.1 added safe removal and the bash guard, 0.3.3 required DSHX 0.7.4, and 0.3.4 requires 0.7.5's atomic operation lock and full Host identity gate. These server changes need activation evidence; a version change alone never proves a restart necessary. Missing hot-replacement evidence remains pending. Root Loader HMR does not prove replacement of the preset-private Creator+ bridge. Skill or metadata refresh alone must preserve the preset generation stamp and does not justify an immediate restart.

## Development

```sh
npm test
npm run check
npm run verify:dshx -- --harness /absolute/path/to/deepseek-harness
npm run verify:harness-install -- --harness /absolute/path/to/deepseek-harness
/absolute/path/to/deepseek-harness/tools/dshx/skill/dshx/scripts/dshx.sh check "$PWD" --harness /absolute/path/to/deepseek-harness
npm pack --dry-run
```

## License

MIT. DeepSeek Harness and DSHX are separate projects with their own licenses.
