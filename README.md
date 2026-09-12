# Creator Mode+

[English](README.en.md)

**这不是官方原装 DSH 的 Host 功能插件。** 不要用 `dsh plugin --profile web add github:aa2246740/dsh-creator-mode-plus`。那条命令不够，也装不上。

只跑官方 DeepSeek Harness（例如 **0.1.5-rc.2**）的人：**跳过这个仓库。** 原装 DSH 没有 Creator Mode，也没有 DSHX；这里的安装器要一份 Harness checkout，以及已经装好的 DSHX。

本仓库给**手里已有 [Harness checkout](https://github.com/deepseek-ai/deepseek-harness) 和 [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit) `>=0.7.5 <0.8.0`** 的作者用。在普通 Web 会话里选 Creator Mode+，用九个固定工具把一个文件化插件搭起来、检查、挂载，也能按安全顺序卸载。

不替代官方创造模式。兼容 DSH `dsh-v0.1.0-rc.8` 的 Creator/Guardian 合同，以及 `dsh-v0.1.1-rc.2`、`dsh-v0.1.2-rc.1` 到 `dsh-v0.1.5-rc.2` 的认证 Web 链路。第九个工具 `dshx_hot_reload` 是尚未发布的候选能力，必须配套具备该实现的 DSHX。

![在官方 WebUI 里打开 Creator Mode+](docs/screenshots/mode-picker.gif)

![模式列表里的 Creator Mode+](docs/screenshots/mode-picker.png)

![已选中 Creator Mode+](docs/screenshots/mode-selected.png)

## 作者：Harness checkout + 安装器

先有一份本机 Harness checkout，并且已经按 [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit) 把工作台装进 `tools/dshx`。然后在 Agent 会话外面，把本仓库 clone 进 `tools/dsh-creator-mode-plus`，用这份 checkout 里的 `pnpm dsh` 做**本地 `link:`**（不是 `github:`），再跑安装器写用户 preset。

```sh
cd /path/to/deepseek-harness
git clone https://github.com/aa2246740/dsh-creator-mode-plus.git tools/dsh-creator-mode-plus
pnpm dsh plugin --profile web add link:./tools/dsh-creator-mode-plus
node tools/dsh-creator-mode-plus/scripts/install.mjs --harness "$PWD"
```

`link:` 只把桥接到这份 checkout 的 Web profile。安装器才写用户 preset，不动随仓库带的 Standard / Creator。打开官方 WebUI，检查 Creator Mode+ 是否出现在模式列表，并在新会话验收。不要仅因增加 profile 依赖就重启 Host。

合同见 [Bridge v2](docs/bridge-contract.md) 和 [DSHX v0.7 alignment](docs/dshx-v0.7-alignment.md)。

![安装器把 preset 写进用户目录](docs/screenshots/install.png)

## 九个工具

| 工具 | 做什么 |
|---|---|
| `dshx_browser_open` | 通过当前会话已批准的适配器完成私有认证交接，然后继续界面验收 |
| `dshx_status` | 读 supervisor 和 Host，不动进程 |
| `dshx_claim_plugin` | 这个会话独占一个插件 |
| `dshx_scaffold` | 在会话工作区建项目，不覆盖已有的 |
| `dshx_check` | 静态检查。过了只证明源码能建起来 |
| `dshx_activation_plan` | 分类这次改动要不要重载或重启 |
| `dshx_activate_new_client` | 按固定顺序挂新 client。不刷新浏览器，不重启 DSH |
| `dshx_remove_plugin` | 先让当前 Host 脱载，再清 profile；只断开链接，保留源码 |
| `dshx_hot_reload` | 对受支持的服务端插件做同 PID 热替换 |

整插件删除只走 `dshx_remove_plugin`。已经装着再跑安装器，它不会覆盖。

![重复安装被拒绝](docs/screenshots/already-installed.png)

Harness 更新的 `prepare` / `verify` / `apply` / `rollback` 不在这九个工具里，交给外部 DSHX supervisor。会话内只允许通过 managed shell 读 `update plan`。

## 升级

```sh
cd /path/to/deepseek-harness/tools/dsh-creator-mode-plus
git pull --ff-only
node scripts/install.mjs --harness /path/to/deepseek-harness --upgrade
npm run verify:dshx -- --harness /path/to/deepseek-harness
```

## 开发

```sh
npm test
npm run check
npm run verify:dshx -- --harness /absolute/path/to/deepseek-harness
npm run verify:harness-install -- --harness /absolute/path/to/deepseek-harness
```

## License

MIT。
