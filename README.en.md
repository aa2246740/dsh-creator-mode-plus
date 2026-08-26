# Creator Mode+

[中文](README.md)

Pick Creator Mode+ in a normal DeepSeek Harness WebUI session. Seven fixed tools scaffold, check, mount, and safely remove a file-backed plugin. Version 0.3.1 aligns session claims, workspace scaffolding, safe removal, seven activation surfaces, proactive integrity quarantine, the external Guardian, and the Harness Update Assistant authority boundary with DSHX v0.7.2. Anything outside the fixed contract stops.

This does not replace official Creator Mode. It does not patch Harness core. Unofficial.

![Opening Creator Mode+ in the official WebUI](docs/screenshots/mode-picker.gif)

In the official mode list, Creator Mode+ sits under Creator mode. The Chinese line is from the user preset.

![Creator Mode+ in the mode list](docs/screenshots/mode-picker.png)

After you pick it, a new session uses the seven fixed tools.

![Creator Mode+ selected](docs/screenshots/mode-selected.png)

## Install

Do this outside an agent session, from your Harness checkout:

```sh
cd /path/to/deepseek-harness
git clone https://github.com/aa2246740/dsh-creator-mode-plus.git tools/dsh-creator-mode-plus

# A profile dependency is a manifest change. It applies on the next Host boot.
pnpm dsh plugin --profile web add link:./tools/dsh-creator-mode-plus

# Writes a user preset. Leaves the shipped Standard and Creator presets alone.
node tools/dsh-creator-mode-plus/scripts/install.mjs --harness "$PWD"
```

Restart the Web Host once from outside the session, because the profile changed. Open the official WebUI, pick Creator Mode+, and start a new session or a still-blank one.

The compatibility line covers the Creator/Guardian contracts from DSH `dsh-v0.1.0-rc.8` through the current `dsh-v0.1.1-rc.2`. It requires [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit) `>=0.7.2 <0.8.0`. Version 0.7.2 adds safe removal and proactive Guardian integrity quarantine to 0.7.1's RC8/RC2 boot-manifest compatibility. The installer checks the actual Creator, Guardian, removal, activation, managed-shell, Harness Update Assistant, and knowledge surfaces and stops before preset mutation when any surface is missing.

For a fresh browser plugin, the fixed order is scaffold, implement/build, `dshx_check`, `dshx_activation_plan`, then same-PID activation. An unbuilt scaffold is no longer required to pass an activation plan.

Migration and upgrade rules live in the [Bridge v2 contract](docs/bridge-contract.md); the complete release mapping is in [DSHX v0.7 alignment](docs/dshx-v0.7-alignment.md).

![Installer writing the user preset](docs/screenshots/install.png)

## The seven tools

| Tool | What it does |
|---|---|
| `dshx_status` | Read the supervisor and Host. No process change. |
| `dshx_claim_plugin` | Give this session exclusive ownership of one plugin. |
| `dshx_scaffold` | Create the project in the session workspace. Never overwrites. |
| `dshx_check` | Static checks. A pass only proves the source built. |
| `dshx_activation_plan` | Say whether this change needs a reload or a restart. |
| `dshx_activate_new_client` | Mount a new client in a fixed order. No browser reload. No DSH restart. |
| `dshx_remove_plugin` | Deactivate the current Host first, then clean the profile; detach links and preserve source. |

Whole-plugin teardown uses only `dshx_remove_plugin`. Ordinary files inside a component remain editable. Direct teardown of the claimed root, Harness link, or active profile is denied. If RC8 removes the dependency but leaves this plugin's `node_modules` symlink, the transaction resumes from durable quarantine and detaches it only when the target belongs exactly to this claim; directories and outside targets fail closed. If an older Agent bypasses the bridge, Guardian quarantines a stale watched row as soon as the profile link disappears while the Host is still healthy, before a cold boot can consume it.

## Fail closed

A second install does not overwrite. Start, restart, and a garbage port are refused.

![Second install refused](docs/screenshots/already-installed.png)

How Guardian quarantines, restarts once, and hands the incident back to the same session is in the contract. Not here.

## Harness update boundary

DSHX v0.7 adds `update plan → prepare → verify → apply` and exact `rollback`, but the seventh Creator tool is safe removal, not Harness update. A managed shell may read `update plan`; `prepare`, `verify`, `apply`, `rollback`, and Host process control remain external-supervisor operations. Candidate verified, locally applied, real-runtime accepted, and production activated are separate states.

## Upgrading from 0.2.x

Run outside an Agent session:

```sh
cd /path/to/deepseek-harness/tools/dsh-creator-mode-plus
git pull --ff-only
node scripts/install.mjs --harness /path/to/deepseek-harness --upgrade
npm run verify:dshx -- --harness /path/to/deepseek-harness
```

Version 0.3.1 adds the safe-removal tool and bash guard to the server bridge, so a Web Host already running 0.3.0 also needs one controlled external restart to load the protection. That is the `server` activation branch. Ordinary preset discovery and later skill-only upgrades with unchanged composition bytes and stamp do not require a restart.

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
