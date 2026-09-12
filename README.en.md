# Creator Mode+

[中文](README.md)

**This is not a stock DSH Host feature plugin.** Do not run `dsh plugin --profile web add github:aa2246740/dsh-creator-mode-plus`. That command is not enough, and it will not install this package.

If you only run official DeepSeek Harness (for example **0.1.5-rc.2**): **skip this repository.** Stock DSH has no Creator Mode and no DSHX. The installer here needs a Harness checkout and DSHX already set up.

This repo is for **authors who already have a [Harness checkout](https://github.com/deepseek-ai/deepseek-harness) and [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit) `>=0.7.5 <0.8.0`**. Pick Creator Mode+ in a normal Web session. Nine fixed tools scaffold, check, mount, and uninstall a file-backed plugin in a safe order.

It does not replace official Creator Mode. Compatible with the Creator/Guardian contract on DSH `dsh-v0.1.0-rc.8`, and the authenticated Web line on `dsh-v0.1.1-rc.2`, `dsh-v0.1.2-rc.1`, and `dsh-v0.1.5-rc.2`. The ninth tool `dshx_hot_reload` is still a candidate. It needs a DSHX that actually implements it.

![Open Creator Mode+ in the official WebUI](docs/screenshots/mode-picker.gif)

![Creator Mode+ in the mode list](docs/screenshots/mode-picker.png)

![Creator Mode+ selected](docs/screenshots/mode-selected.png)

## Authors: Harness checkout + installer

Start with a local Harness checkout that already has [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit) in `tools/dshx`. Outside an Agent session, clone this repo into `tools/dsh-creator-mode-plus`, then use **that checkout's** `pnpm dsh` to add a **local `link:`** (not `github:`), then run the installer to write the user preset.

```sh
cd /path/to/deepseek-harness
git clone https://github.com/aa2246740/dsh-creator-mode-plus.git tools/dsh-creator-mode-plus
pnpm dsh plugin --profile web add link:./tools/dsh-creator-mode-plus
node tools/dsh-creator-mode-plus/scripts/install.mjs --harness "$PWD"
```

The `link:` step only attaches the bridge to this checkout's Web profile. The installer writes a user preset. It leaves the shipped Standard and Creator presets alone. Open the official WebUI, confirm Creator Mode+ is in the mode list, and try it in a new session. Adding a profile dependency is not by itself a reason to restart the Host.

Contracts: [Bridge v2](docs/bridge-contract.md) and [DSHX v0.7 alignment](docs/dshx-v0.7-alignment.md).

![Installer writing the user preset](docs/screenshots/install.png)

## The nine tools

| Tool | What |
|---|---|
| `dshx_browser_open` | Open the authenticated WebUI through the session-approved adapter, then continue UI verification |
| `dshx_status` | Read supervisor and Host. No process changes |
| `dshx_claim_plugin` | This session owns one plugin |
| `dshx_scaffold` | Create a project in the session workspace. Does not overwrite |
| `dshx_check` | Static check. Pass means the source can build |
| `dshx_activation_plan` | Classify whether this change needs reload or restart |
| `dshx_activate_new_client` | Mount a new client in a fixed order. No browser refresh, no DSH restart |
| `dshx_remove_plugin` | Unload from the current Host, then clear the profile. Source stays |
| `dshx_hot_reload` | Same-PID replacement for supported server plugins |

Whole-plugin removal goes through `dshx_remove_plugin` only. Running the installer again on an existing install does not overwrite.

![Duplicate install refused](docs/screenshots/already-installed.png)

Harness `update prepare` / `verify` / `apply` / `rollback` are not among the nine tools. They stay with an external DSHX supervisor. Inside the session, managed shell may only read `update plan`.

## Upgrade

```sh
cd /path/to/deepseek-harness/tools/dsh-creator-mode-plus
git pull --ff-only
node scripts/install.mjs --harness /path/to/deepseek-harness --upgrade
npm run verify:dshx -- --harness /path/to/deepseek-harness
```

## Develop

```sh
npm test
npm run check
npm run verify:dshx -- --harness /absolute/path/to/deepseek-harness
npm run verify:harness-install -- --harness /absolute/path/to/deepseek-harness
```

## License

MIT.
