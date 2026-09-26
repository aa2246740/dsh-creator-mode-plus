# Source-only 接线前基线

2026-09-14；开始真实 execute 闭包接线之前保全。

- Creator 原 `src/index.js` SHA-256：`8e9988700d15b4551b1244a7679b9a9a9a91f592eb844cbeb6b748d9616f4e34`。
- 全部相关回归：214 项；固定 bridge cancellation/argv 五项：5 项。合计 **219 passing / 0 failure / 0 skip**。`node --check` 两个增量文件、`git diff --check` 通过。
- 组成：source-checkout 11、development-policy 29、development-compilation 56、development-execution 25、development-tasks 30、development-target 48、authorization-feasibility 15，另 bridge 5。
- 明确错误的 DSHX_HARNESS 指向不存在目录时，policy suite 实际以 exit 1 / ENOENT 结束，0 skip，没有回退。清除 DSHX_HARNESS 后，本地确定性发现运行 locator+policy 共40项通过。
- 本基线没有调用 C 生产 apply、DSHX build/check/activation、自替换或 Host/preset 写入；旧 VM collector/wrapper 尚不是真实 C 本体接线证据。后续需把这项边界升级为真实 Cordis 中安装当前 C 闭包，不能把 wrapper 当来源证明。
- 此前 package.json 的 yaml dependency、runner/bridge 回归、node_modules 和已列 helper 为既有工作树状态；本次编译／epoch增量没有另改 package、生产 entry 或 artifacts 声明。

可重跑（在 C package；DSHX_HARNESS 由操作者选择经验证的源码 checkout，也可以使用确定性本地发现）：

```sh
node --check src/development-policy.js
node --check src/development-target.js
TSX_DISABLE_CACHE=1 node --experimental-vm-modules --test \
  tests/source-checkout.spec.mjs tests/development-policy.spec.mjs \
  tests/development-compilation.spec.mjs tests/development-execution.spec.mjs \
  tests/development-tasks.spec.mjs tests/development-target.spec.mjs \
  tests/authorization-feasibility.spec.mjs
node --test --test-name-pattern='exact argv|already-aborted|synchronous startup|cancellation occurs|fixed subprocess' tests/bridge.spec.mjs
git diff --check
```

当前新增 source 接线授权以父层 `creator-execution-interop-contract.md` 为准；源码接线仍不代表编译、activation、浏览器验证或真实人体操作证明。
