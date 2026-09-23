# Creator Mode+

[中文](README.md)

Pick Creator Mode+ in a normal DeepSeek Harness Web session. Ten fixed tools scaffold, check, mount, and uninstall a file-backed plugin in a safe order.

Creator Mode+ 0.3.9 is paired with DSHX 0.7.9 and Harness `dsh-v0.1.7-rc.1`. The plugin peer range is `>=0.1.7-rc.1 <0.1.8`. The bridge compatibility range is [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit) `>=0.7.9 <0.8.0`; the desk pin, peer range, and human-confirmed takeover capability are checked before use. Session recovery listens on `agent/created`.

![Open Creator Mode+ in the official WebUI](docs/screenshots/mode-picker.gif)

![Creator Mode+ in the mode list](docs/screenshots/mode-picker.png)

![Creator Mode+ selected](docs/screenshots/mode-selected.png)

## Use it in a conversation

Select a workspace and **Creator Mode+**, then state the feature and delivery target:

> Create a page counter plugin and install it in this DSH. Then add a server tool to it.

The Agent creates source, builds, checks, selects activation and continues. Server changes use same-process hot reload; a new client entry needs a page refresh. Correct build failures before retrying. A missing browser adapter blocks its UI check only. An explicit installation request carries through these steps.

## Install

Do this outside an Agent session, in your Harness checkout:

```sh
cd /path/to/deepseek-harness
git clone https://github.com/aa2246740/dsh-creator-mode-plus.git tools/dsh-creator-mode-plus
pnpm dsh plugin --profile web add link:./tools/dsh-creator-mode-plus
node tools/dsh-creator-mode-plus/scripts/install.mjs --harness "$PWD"
```

The installer derives a user preset from the shipped Standard patch, writes `profiles/web/creator-mode-plus/agent.cordis.yml`, and includes that file from the Web profile `cordis.patch.yml`. It leaves the shipped Standard and Creator presets alone and does not write `.agent-presets`. Open the official WebUI, confirm Creator Mode+ is in the mode list, and try it in a new session. Adding a profile dependency is not by itself a reason to restart the Host.

Contracts: [Bridge v2](docs/bridge-contract.md) and [DSHX v0.7 alignment](docs/dshx-v0.7-alignment.md).

![Installer writing the user preset](docs/screenshots/install.png)

## The ten tools

| Tool | What |
|---|---|
| `dshx_browser_open` | Open the authenticated WebUI through the session-approved adapter, then continue UI verification |
| `dshx_status` | Read supervisor and Host. No process changes |
| `dshx_claim_plugin` | This session owns one plugin |
| `dshx_scaffold` | Create a project in the session workspace. Does not overwrite |
| `dshx_check` | Check interfaces, build artifacts and activation prerequisites |
| `dshx_activation_plan` | Select activation for the changed component |
| `dshx_activate_new_client` | Install a new client and verify its entry |
| `dshx_remove_plugin` | Unload from the current Host, then clear the profile. Source stays |
| `dshx_hot_reload` | Activate server code changes |

Whole-plugin removal goes through `dshx_remove_plugin` only. Running the installer again on an existing install does not overwrite.

![Duplicate install refused](docs/screenshots/already-installed.png)

Harness `update prepare` / `verify` / `apply` / `rollback` are not among the ten tools. They stay with an external DSHX supervisor. Inside the session, managed shell may only read `update plan`.

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
DSHX_HARNESS=/absolute/path/to/deepseek-harness npm run test:native
npm run verify:dshx -- --harness /absolute/path/to/deepseek-harness
npm run verify:harness-install -- --harness /absolute/path/to/deepseek-harness
```

## License

MIT.

`dshx_request_takeover({name})` asks through the current conversation’s user-question UI, then drains old work and atomically transfers ownership. This requires the `human-confirmed-creator-takeover` capability in addition to the version range.
