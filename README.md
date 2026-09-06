# Creator Mode+

[English](README.en.md)

在 DeepSeek Harness 的普通 Web 会话里选 Creator Mode+，就能用八个固定工具把一个文件化插件搭起来、检查、挂载，也能按安全顺序卸载。0.3.4 对齐 DSHX v0.7.5：App、直接 `dsh web` 和 dshx 通过同 Home 原子互斥与完整进程身份只对应一个长期 Web Host；会话认领、工作区 scaffold、安全卸载、七分支激活、隔离验证、外部 Guardian 和 Harness Update Assistant 仍在同一份 fail-closed 合同里。过不了的操作直接停。

第八个 `dshx_hot_reload` 是尚未发布的候选能力，用于受支持服务端模块的同 PID 热替换；必须配套具备该实现的 DSHX，旧版本号相同也不能冒充已支持。

不替代官方创造模式。不改 Harness 核心。非官方。

![在官方 WebUI 里打开 Creator Mode+](docs/screenshots/mode-picker.gif)

官方模式列表里，Creator Mode+ 排在创造模式下面。那段中文来自用户 preset。

![模式列表里的 Creator Mode+](docs/screenshots/mode-picker.png)

选中之后，新会话走这八个固定工具。

![已选中 Creator Mode+](docs/screenshots/mode-selected.png)

## 安装

在 Agent 会话外面做。进你的 Harness 仓库：

```sh
cd /path/to/deepseek-harness
git clone https://github.com/aa2246740/dsh-creator-mode-plus.git tools/dsh-creator-mode-plus

# profile 依赖提供模块解析，不单独构成重启依据
pnpm dsh plugin --profile web add link:./tools/dsh-creator-mode-plus

# 只写用户 preset，不动随仓库带的 Standard / Creator
node tools/dsh-creator-mode-plus/scripts/install.mjs --harness "$PWD"
```

安装后打开官方 WebUI，检查 Creator Mode+ 是否出现在模式列表，并在新会话或空白会话验收。不要仅因增加 profile 依赖就重启 Host；已加载服务端代码的替换要单独验证。模式可见也不代表浏览器端 Guardian 已加载，后者需检查当前客户端图与页面。

兼容线覆盖 DSH `dsh-v0.1.0-rc.8` 的 Creator/Guardian 合同、`dsh-v0.1.1-rc.2` 和 `dsh-v0.1.2-rc.1` 的认证 Web 链路。必须使用具备完整能力的 [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit) `>=0.7.5 <0.8.0`。安装器除 Creator、Guardian、卸载、激活、managed-shell 和更新助手外，还会验证受控同 PID 热替换、同 Home Host 原子互斥、PID/启动时间/Home/profile/root 身份绑定，以及临时 Home `verify-boot` 必清理；缺一项就在写 preset 前停止。

新浏览器插件的固定顺序是：scaffold 后先实现、构建并通过 `dshx_check`，再运行 `dshx_activation_plan` 和同 PID 激活。未构建的 scaffold 不再被错误地要求先通过 activation plan。

从旧的 bundled 版本迁过来、以后升级，看 [Bridge v2 合同](docs/bridge-contract.md)；本次完整对齐矩阵见 [DSHX v0.7 alignment](docs/dshx-v0.7-alignment.md)。

![安装器把 preset 写进用户目录](docs/screenshots/install.png)

## 八个工具

| 工具 | 做什么 |
|---|---|
| `dshx_status` | 读 supervisor 和 Host，不动进程 |
| `dshx_claim_plugin` | 这个会话独占一个插件 |
| `dshx_scaffold` | 在会话工作区建项目，不覆盖已有的 |
| `dshx_check` | 静态检查。过了只证明源码能建起来 |
| `dshx_activation_plan` | 分类这次改动要不要重载或重启 |
| `dshx_activate_new_client` | 按固定顺序挂新 client。不刷新浏览器，不重启 DSH |
| `dshx_remove_plugin` | 先让当前 Host 脱载，再清 profile；只断开链接，保留源码 |
| `dshx_hot_reload` | 对受支持的服务端插件做同 PID 热替换；验证代际替换和临时资源清理，不代表功能已验收 |

整插件删除只走 `dshx_remove_plugin`。组件内部普通文件仍可正常删除；直接拆插件根、`my-plugins` 链接或 active profile 会被桥拒绝。RC8 若删了 dependency 却遗留该插件的 `node_modules` symlink，事务会从 durable quarantine 续跑，只在目标精确属于本 claim 时解绑；目录或越界目标失败关闭。即使旧 Agent 绕过桥，Guardian 也会在 profile link 消失、Host 尚健康时先隔离 stale row，避免下一次冷启动炸掉。

这里的固定工具只处理 watched-row 插件。遇到 `dsh.profile.bundles` 的 boot-captured bundle，会话必须停下并交给外部 supervisor 执行 `dshx plugin remove <package> --profile web --port <当前端口>`；外部命令先证明当前 Loader 图同 PID 脱载，再调用官方 remover。它不属于固定模型工具，也不要求为了卸载而重启 DSH。

## 过不了就停

已经装着再跑安装器，它不会覆盖。模型想 start、restart，或者把端口写成乱的，桥直接拒。

![重复安装被拒绝](docs/screenshots/already-installed.png)

Guardian 怎么隔离、怎么只重启一次、怎么把事故交回原来的会话，都写在合同里。这里不展开。

## Harness 更新边界

DSHX v0.7 新增 `update plan → prepare → verify → apply` 和精确 `rollback`，但 Creator Mode+ 的第七个工具只负责安全卸载，不把 Harness 更新暴露为固定工具。会话内只允许通过 managed shell 读取 `update plan`；`prepare`、`verify`、`apply`、`rollback` 和 Host 进程控制全部交给外部 DSHX supervisor。候选验证通过、本机应用完成、真实运行时接受、正式激活是四个不同状态。

## 升级

在 Agent 会话外执行：

```sh
cd /path/to/deepseek-harness/tools/dsh-creator-mode-plus
git pull --ff-only
node scripts/install.mjs --harness /path/to/deepseek-harness --upgrade
npm run verify:dshx -- --harness /path/to/deepseek-harness
```

0.3.1 增加了安全卸载和 bash guard，0.3.3 收紧到 DSHX 0.7.4，0.3.4 要求 0.7.5 的原子互斥与完整身份门禁。这些服务端改动需要运行时激活证据，不能仅凭版本变化要求重启。缺少热替换证据时保持待验，不自动改判为必须重启；普通 Host 插件的 HMR 结果不能代替 preset 内部 Creator+ 的验收。仅刷新 skill 或 metadata 不应触发 preset generation，也不要求立即重启。

## 开发

```sh
npm test
npm run check
npm run verify:dshx -- --harness /absolute/path/to/deepseek-harness
npm run verify:harness-install -- --harness /absolute/path/to/deepseek-harness
/absolute/path/to/deepseek-harness/tools/dshx/skill/dshx/scripts/dshx.sh check "$PWD" --harness /absolute/path/to/deepseek-harness
npm pack --dry-run
```

## License

MIT。DeepSeek Harness 和 DSHX 是别的项目，各有各的许可证。
