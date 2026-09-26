# Creator Mode+

[English](README.en.md)

**插件开发红线：DSH 官方源码只读。** 不为插件修改 Host、内置包或官方构建产物，临时副本和 worktree 也不例外。缺少公开接口时调整插件方案；`CORE_SOURCE_IMMUTABLE` 不可通过接管、审批或 `--force` 绕过。

在 DeepSeek Harness 的普通 Web 会话里选 Creator Mode+，用十个固定工具把一个文件化插件搭起来、检查、挂载，也能按安全顺序卸载。

Creator Mode+ 0.3.10 配套 DSHX 0.9.1 和 Harness `dsh-v0.1.7-rc.2`（SHA `477b4f420553e8a52c2fbccc464d7561b239c443`）。插件 peer 范围仍是 `>=0.1.7-rc.1 <0.1.8`，接受 `0.1.7-rc.2`。底层桥接兼容范围为 [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit) `>=0.9.1 <0.10.0`，拒绝 0.9.0 和 0.7.9。使用前核对桌面钉、peer 范围和用户确认接管能力。会话恢复挂在 `agent/created` 上。十个固定工具不变。

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

安装器从仓库自带的 Standard patch 派生用户 preset，写入 `profiles/web/creator-mode-plus/agent.cordis.yml`，并在 Web profile 的 `cordis.patch.yml` 里 include 它。它不改随仓库带的 Standard / Creator，也不再写 `.agent-presets`。打开官方 WebUI，检查 Creator Mode+ 是否出现在模式列表，并在新会话验收。不要仅因增加 profile 依赖就重启 Host。

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

Harness 更新只保留只读 `update plan`。`prepare` / `verify` / `apply` / `rollback` 已由 DSHX 禁用，外部 supervisor 也不能通过插件工具修改官方源码。

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
