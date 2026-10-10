# 私有编译输入：固定登记目标（source-only）

2026-09-14。`src/development-target.js` 的增量只提供受限数据，不提供来源证明、人工授权、通用 Loader 解析或执行能力。`src/index.js`、manifest 和 Host 未接线／未激活。

## API

```js
createDevelopmentTargetResolver({
  getHarnessRoot,                       // 原有 Host 私有读源
  readRegisteredTarget,                // opaqueLease -> 固定物理登记描述，严格同步
  readCompilationSignals,              // 原 exec -> { ownerSignal, policySignal }，严格同步
  producerSignal,                      // C producer 的私有生命周期
  compilationTtlMs: 300000,             // 可更短，不可超过五分钟
  compilationNow: () => performance.now(), // 单调时钟；另有真实到期 timer
})

captureCompilation(exec, opaqueLease)  // -> 冻结空 opaque handle
compilationSnapshot(handle, exec)     // -> 冻结公开 metadata，无 code
compilationInput(handle, exec)        // -> 私有冻结输入（再次安全重验）
releaseCompilation(handle)            // -> boolean；幂等、立即清缓存
dispose()                            // 停止编译捕获、清全部待办；原观察 API 不改变
```

原 `capture(exec, pluginId)` / `revalidate(snapshot, exec)` 不依赖三个新增生命周期／registry 配置，不增加代码或 Loader 推断。编译 snapshot 也可以交给 `revalidate(snapshot, exec)`，但会走其更严格的原 exec／登记 lease／生命周期校验。

新增 callback 不存在于任何模型参数或 HTTP 接口。构造器未提供它们，编译入口直接关闭。不得把它们包装成可选模型字段。

### 可信接线形态

```js
// 仅在真实 C execute 中 authority.enter + policy.capture 后写入。
const invocations = new WeakMap() // exact original exec -> { owner, policyHandle }
const lifetime = new AbortController()
ctx.effect(() => () => lifetime.abort())
const targets = createDevelopmentTargetResolver({
  getHarnessRoot: trustedHarnessRoot,
  readRegisteredTarget: lease => preparedExecutor.readRegisteredTarget(lease),
  readCompilationSignals(exec) {
    const call = invocations.get(exec)
    if (!call) return undefined
    return {
      ownerSignal: authority.inspect(call.owner).signal,
      policySignal: policy.inspect(call.policyHandle).signal,
    }
  },
  producerSignal: lifetime.signal,
})
ctx.effect(() => () => targets.dispose())
```

不得按 agent.id/sessionId 选择最新 owner。读取方法始终还检查原 `exec.signal`；owner signal 应来自同一 exec 已 enter 的 C owner，包含 caller/body timeout。旧调用、换 Agent／Session／token／参数对象、换 body/owner/policy signal、取消、异步／缺失读源，均不能借用代码句柄。

## 登记目标与 binding

`readRegisteredTarget(opaqueLease)` 返回冻结的物理描述：

```js
{ harnessRoot, sourceRoot, pluginId, sourceDirectoryIdentity: { dev, ino }, runtimeEntry }
```

- 只信任私有 registry reader 对原 opaque lease 的回答，不读 lease 自带的 JSON 字段。
- `runtimeEntry` 是已经外部固定登记的精确包内 JS/CJS/MJS 路径；不是模型参数，不根据 package.main/exports、Node resolver 或项目脚本推断。
- 每遍读取都校验实际 `locate()` 的物理目标与登记描述完全相符；lease 撤销、目标／runtimeEntry 改变、依赖信号变更时失效，不切换到新目标。外部 registry 应按不可复活 lease 管理代际。
- 登记物理描述 **没有 workspaceRoot**。实际 workspaceRoot 仍从原 Agent 的真实 Session cwd 取得。
- 私有 input 返回完整冻结 `binding`（engine/harnessRoot/workspaceRoot/sourceRoot/pluginId/sourceDirectoryIdentity）。该 binding 与本次编译 snapshot 的 binding 是**同一个对象**，来自同一次双遍 locate；不能之后另做一次普通 capture 拼入另一个时刻的 binding。

外部候选 `PreparedExecutor.readRegisteredTarget()` 的字段已按用户指定源码只读核对；这不是对生产 registry 挂载或执行的验证。当前执行候选仅支持明确登记且真实 ACTIVE 的 fixed-entry managed hot-reload，其它目标继续关闭。

## 读取和代码边界

- 保留既有 no-follow / nonblocking FD、regular-file、inode/size/time/trail、目录身份、目标保护和两遍一致性检查。
- 编译要求 manifest 显式 `hotReload.artifacts` JS 闭包。原 `declaredEntry` 与登记 `resolvedRuntimeEntry` 分开记录；实际入口即使未列在 artifacts 中，也加入两遍读取、hash、预算和 metadata 文件清单。
- 项目 TS/JSX、隐式依赖、Node loader 绑定或 build 脚本不在本轮读取／编译支持范围。该模块不运行源码；实际编译器仍必须拒绝未列相对依赖、动态 require 和不支持的环境绑定。
- `compilationInput` 形态：

```js
{
  binding,
  declaredEntry,
  resolvedRuntimeEntry,
  files: [{ path, code, sha256, bytes }],
  evidenceBoundary: 'parent-observation-only',
}
```

- `code` 只在批准前双遍 FD 读取时生成并保存于私有 WeakMap。后续 input/revalidate 会重新安全核对文件和登记状态，但**不重新生成或替换已保存字符串**；变更即拒绝。
- UTF-8 code 解码使用 `fatal:true, ignoreBOM:true`，明确保留原 BOM、CRLF 和多字节字符；sha256/bytes 仍是原始文件字节，不把去 BOM 字符串冒充原文件。无效 UTF-8 拒绝。
- 公开 snapshot 不含 code，且保留 `parent-observation-only` 标签。所有这些对象都不是 grant 或 sourceVerified 证据。

## 生命周期与预算

- 每遍仍最多 16 MiB 总读取，单 artifact 4 MiB、metadata 256 KiB；32 个运行文件包括新增实际入口。
- 每个 resolver/producer 最多 64 个待办，并额外保守限制聚合保留代码为 16 MiB（按原 UTF-8 字节计数）。拒绝重入捕获／重入校验。
- TTL 不超过五分钟，单调时钟校验加真实 `unref` timer；系统时钟回退／无效时关闭。timer 从最初捕获期限扣除已用时间，不因读取耗时额外延长。
- 原 exec、owner、policy、producer 任一取消，即删除待办／代码／真实对象关联，只留轻量失效 tombstone。release/dispose/过期也清除；超容量不会挤出或复活旧句柄。
- 这只能回收 resolver 持有的引用，不能擦除已交给可信编译器的 JS 字符串副本。外部 compiled capsule／prepared ticket／消费端仍须绑定其独立生命周期；该数据 API 不能保证一个拿到明文的同进程调用者忘记内容。

## 回归范围

`tests/development-compilation.spec.mjs` 使用真实临时文件和实际安全 FD 读取器，验证原字节／实际入口、登记匹配、exec 身份、信号换代、取消、双遍变更、symlink、预算、64 待办、回收和真实 TTL。其 exec/registry/lifetime 是明确测试夹具，不冒充真实 C 来源或外部生产挂载。真实 Native source、policy、task 生命周期由相应独立回归覆盖；跨组件生产接线仍待验证。
