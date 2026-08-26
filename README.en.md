# Creator Mode+

[中文](README.md)

Pick Creator Mode+ in a normal DeepSeek Harness WebUI session. Six fixed tools scaffold, check, and mount a file-backed plugin. Version 0.3.0 fully aligns session claims, workspace scaffolding, the seven activation surfaces, the external Guardian, and the Harness Update Assistant authority boundary with DSHX v0.7. Anything outside the fixed contract stops.

This does not replace official Creator Mode. It does not patch Harness core. Unofficial.

![Opening Creator Mode+ in the official WebUI](docs/screenshots/mode-picker.gif)

In the official mode list, Creator Mode+ sits under Creator mode. The Chinese line is from the user preset.

![Creator Mode+ in the mode list](docs/screenshots/mode-picker.png)

After you pick it, a new session uses the six fixed tools.

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

The compatibility line covers the Creator/Guardian contracts from DSH `dsh-v0.1.0-rc.8` through the current `dsh-v0.1.1-rc.2`. It requires [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit) `>=0.7.1 <0.8.0`. Version 0.7.1 accepts both RC8's `window.__DSH_BOOT__` and RC2's official `globalThis["__DSH_BOOT__"]` injection. The installer also checks the actual Creator, Guardian, activation, managed-shell, Harness Update Assistant, and knowledge surfaces and stops before preset mutation when any surface is missing.

For a fresh browser plugin, the fixed order is scaffold, implement/build, `dshx_check`, `dshx_activation_plan`, then same-PID activation. An unbuilt scaffold is no longer required to pass an activation plan.

Migration and upgrade rules live in the [Bridge v2 contract](docs/bridge-contract.md); the complete release mapping is in [DSHX v0.7 alignment](docs/dshx-v0.7-alignment.md).

![Installer writing the user preset](docs/screenshots/install.png)

## The six tools

| Tool | What it does |
|---|---|
| `dshx_status` | Read the supervisor and Host. No process change. |
| `dshx_claim_plugin` | Give this session exclusive ownership of one plugin. |
| `dshx_scaffold` | Create the project in the session workspace. Never overwrites. |
| `dshx_check` | Static checks. A pass only proves the source built. |
| `dshx_activation_plan` | Say whether this change needs a reload or a restart. |
| `dshx_activate_new_client` | Mount a new client in a fixed order. No browser reload. No DSH restart. |

![The bridge registers six tools and refuses start / restart](docs/screenshots/six-tools.png)

## Fail closed

A second install does not overwrite. Start, restart, and a garbage port are refused.

![Second install refused](docs/screenshots/already-installed.png)

How Guardian quarantines, restarts once, and hands the incident back to the same session is in the contract. Not here.

## Harness update boundary

DSHX v0.7 adds `update plan → prepare → verify → apply` and exact `rollback`, but Creator Mode+ still exposes only six model tools. A managed shell may read `update plan`; `prepare`, `verify`, `apply`, `rollback`, and Host process control remain external-supervisor operations. Candidate verified, locally applied, real-runtime accepted, and production activated are separate states.

## Upgrading from 0.2.x

Run outside an Agent session:

```sh
cd /path/to/deepseek-harness/tools/dsh-creator-mode-plus
git pull --ff-only
node scripts/install.mjs --harness /path/to/deepseek-harness --upgrade
npm run verify:dshx -- --harness /path/to/deepseek-harness
```

Version 0.3.0 changes the server bridge module, so a Web Host that already loaded 0.2.x needs one controlled external restart. That is the `server` activation branch. Ordinary preset discovery and later skill-only upgrades with unchanged composition bytes and stamp do not require a restart.

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
