# Creator Mode+

[English](README.en.md)

在 DeepSeek Harness 的普通 Web 会话里选 Creator Mode+，就能用六个固定工具把一个文件化插件搭起来、检查完、挂上去。过不了的操作直接停。会话拿不到 Host 的开关，也拿不到一条随便写的命令。

不替代官方创造模式。不改 Harness 核心。非官方。

![在官方 WebUI 里打开 Creator Mode+](docs/screenshots/mode-picker.gif)

官方模式列表里，Creator Mode+ 排在创造模式下面。那段中文来自用户 preset。

![模式列表里的 Creator Mode+](docs/screenshots/mode-picker.png)

选中之后，新会话走这六个固定工具。

![已选中 Creator Mode+](docs/screenshots/mode-selected.png)

## 安装

在 Agent 会话外面做。进你的 Harness 仓库：

```sh
cd /path/to/deepseek-harness
git clone https://github.com/aa2246740/dsh-creator-mode-plus.git tools/dsh-creator-mode-plus

# profile 依赖是 manifest 变更，下次 Host 启动才生效
pnpm dsh plugin --profile web add link:./tools/dsh-creator-mode-plus

# 只写用户 preset，不动随仓库带的 Standard / Creator
node tools/dsh-creator-mode-plus/scripts/install.mjs --harness "$PWD"
```

因为加了 profile 依赖，先在会话外面把 Web Host 重启一次。然后打开官方 WebUI，选 Creator Mode+，开一个新会话，或者还是空白的那个。

要 DSH `dsh-v0.1.0-rc.8`，以及 [DSHX](https://github.com/aa2246740/dsh-external-plugin-devkit) `>=0.6.2 <0.7.0`。对不上，桥会在改任何东西之前停掉。

从旧的 bundled 版本迁过来、以后升级，看 [Bridge v2 合同](docs/bridge-contract.md)。

![安装器把 preset 写进用户目录](docs/screenshots/install.png)

## 六个工具

| 工具 | 做什么 |
|---|---|
| `dshx_status` | 读 supervisor 和 Host，不动进程 |
| `dshx_claim_plugin` | 这个会话独占一个插件 |
| `dshx_scaffold` | 在会话工作区建项目，不覆盖已有的 |
| `dshx_check` | 静态检查。过了只证明源码能建起来 |
| `dshx_activation_plan` | 分类这次改动要不要重载或重启 |
| `dshx_activate_new_client` | 按固定顺序挂新 client。不刷新浏览器，不重启 DSH |

![桥注册六个工具，并拒绝 start / restart](docs/screenshots/six-tools.png)

## 过不了就停

已经装着再跑安装器，它不会覆盖。模型想 start、restart，或者把端口写成乱的，桥直接拒。

![重复安装被拒绝](docs/screenshots/already-installed.png)

Guardian 怎么隔离、怎么只重启一次、怎么把事故交回原来的会话，都写在合同里。这里不展开。

## 开发

```sh
npm test
npm run check
```

## License

MIT。DeepSeek Harness 和 DSHX 是别的项目，各有各的许可证。
