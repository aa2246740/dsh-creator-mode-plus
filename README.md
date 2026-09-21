# Creator Mode+

[English](README.en.md)

在 DeepSeek Harness 的普通 Web 会话里选 Creator Mode+，用十个固定工具把一个文件化插件搭起来、检查、挂载，也能按安全顺序卸载。

Creator Mode+ 0.3.8 配套 DSHX 0.7.8，新增当前对话内的用户确认接管。此前已在 DSH `dsh-v0.1.5-rc.2` 上验证新插件加载、同一会话内服务端热更新和卸载。底层桥接兼容范围为 [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit) `>=0.7.8 <0.8.0`，并在使用前核对用户确认接管能力。

![在官方 WebUI 里打开 Creator Mode+](docs/screenshots/mode-picker.gif)

![模式列表里的 Creator Mode+](docs/screenshots/mode-picker.png)

![已选中 Creator Mode+](docs/screenshots/mode-selected.png)

## 在对话里使用

选择工作区和 **Creator Mode+**，直接说明功能和安装目标，例如：

> 做一个页面计数按钮插件，装到当前 DSH；完成后继续给它加一个服务端工具。

Agent 会创建源码、构建检查、选择激活方式并继续执行。服务端修改使用同进程热更新；新客户端首次加载需要刷新页面。构建失败后先修复再重试，浏览器适配器缺失只影响对应的界面验收。明确的安装请求会沿用到这些步骤。

## 安装

在 Agent 会话外面做。进你的 Harness 仓库：

```sh
cd /path/to/deepseek-harness
git clone https://github.com/aa2246740/dsh-creator-mode-plus.git tools/dsh-creator-mode-plus
pnpm dsh plugin --profile web add link:./tools/dsh-creator-mode-plus
node tools/dsh-creator-mode-plus/scripts/install.mjs --harness "$PWD"
```

安装器只写用户 preset，不动随仓库带的 Standard / Creator。打开官方 WebUI，检查 Creator Mode+ 是否出现在模式列表，并在新会话验收。不要仅因增加 profile 依赖就重启 Host。

合同见 [Bridge v2](docs/bridge-contract.md) 和 [DSHX v0.7 alignment](docs/dshx-v0.7-alignment.md)。

![安装器把 preset 写进用户目录](docs/screenshots/install.png)

## 十个工具

| 工具 | 做什么 |
|---|---|
| `dshx_browser_open` | 通过当前会话已批准的适配器完成私有认证交接，然后继续界面验收 |
| `dshx_status` | 读 supervisor 和 Host，不动进程 |
| `dshx_claim_plugin` | 这个会话独占一个插件 |
| `dshx_request_takeover` | 在当前对话请用户确认，停止旧任务后接管认领 |
| `dshx_scaffold` | 在会话工作区建项目，不覆盖已有的 |
| `dshx_check` | 检查接口、构建产物和激活前置条件 |
| `dshx_activation_plan` | 确定本次修改的激活方式 |
| `dshx_activate_new_client` | 安装并验证新客户端插件的入口 |
| `dshx_remove_plugin` | 先让当前 Host 脱载，再清 profile；只断开链接，保留源码 |
| `dshx_hot_reload` | 激活服务端代码修改 |

整插件删除只走 `dshx_remove_plugin`。已经装着再跑安装器，它不会覆盖。

![重复安装被拒绝](docs/screenshots/already-installed.png)

Harness 更新的 `prepare` / `verify` / `apply` / `rollback` 不在这十个工具里，交给外部 DSHX supervisor。会话内只允许通过 managed shell 读 `update plan`。

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
DSHX_HARNESS=/absolute/path/to/deepseek-harness npm run test:native
npm run verify:dshx -- --harness /absolute/path/to/deepseek-harness
npm run verify:harness-install -- --harness /absolute/path/to/deepseek-harness
```

## License

MIT。
