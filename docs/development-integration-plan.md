# Creator 私有来源／模式／封存执行接线方案（未实施）

核对日期：2026-09-14。本文不是部署补丁或运行时许可证明。`src/index.js`、manifest、A 源码及 Host 均未更改；外部执行服务尚未部署，不能宣称具备免审能力。

## 1. 已核实的公开读源

下列 Core 路径相对测试选定的 `DSHX_HARNESS`，A 路径相对 `resolveApproverSource()` 返回的真实源码目录。

| 事实 | 公开来源／源码位置 |
|---|---|
| 当前有效 preset | `policyCtx.permissionPresets.current(realSession)`；`packages/interaction/permission-presets/src/index.ts:298-355` |
| 实际 standing 文件沙箱 | `policyCtx.sandboxPolicy.resolve({ session: realSession })`；`packages/sandbox/sandbox-policy/src/index.ts:163-179` |
| 有效审批策略 | `policyCtx.approval.overrideOf(realSession) ?? policyCtx.approval.config.policy ?? 'ask'`；`packages/interaction/user-approval/src/index.ts:235-250` |
| UI／命令切换 | `permissionPresets.set(session, preset)` 与 `/permission` 命令；前者使用原生 setter，后者经 `approval.setPolicy(agent, policy)` 额外注入通知；`permission-presets/src/index.ts:263-272,379-395` |
| 原生持久变更边界 | 同一真实 Session 的 `permission/preset`、`sandbox/mode`、`approval/policy`；从 `session/event` 观察，用 `session.seq/eventAt(seq)` 确认已提交事件身份并重查 |
| A 的现有模式读取 | `src/dsh-approve-for-me.ts:83-95` 的 `reviewerModeActive`／`canRequestApproval`；不是 `approval-context.ts`，后者仅做摘要、指纹和显示提示 |

不能把 `approve-for-me` 当作 `SandboxMode`：原生文件模式仅 `read-only/workspace-write/danger-full-access`。A 的 `cordis.patch.yml:3-19` 明确让 `approve-for-me` 和 `workspace-write` 共享 **workspace-write + ask**。因此仅看文件模式／审批策略无法区分两者；只监听后两个 knob 事件也会漏掉 preset-only 切换。

真实 Native `ToolExecution` 没有本方案需要的 `exec.meta.mode`。模型 args、自造 Session 字段、callId、展示字符串均不是模式来源。

### 真实回归得到的边界

`tests/development-policy.spec.mjs` 使用当前 Cordis、AgentLoop、Agent、Session、Tools、Approval、PermissionPresets、SandboxPolicy；A 的 helper/coordinator 按源码只读导入，未调用 A apply。只有 LLM/reviewer 传输和 shell 执行端是无副作用替身。

- 原生 preset-only `approve-for-me → workspace-write → approve-for-me` 只增加两个 `permission/preset` 事件；末态与初态相同，但旧调用必须失效。
- `approval.setPolicy(agent,'never')` 覆盖 approve-for-me 时，`current(session)` 返回 **custom**；切回 ask 又返回 approve-for-me。**不能写 `preset !== 'approve-for-me' => legacy`**，否则 never 覆盖会逃逸到旧执行路径。
- 原生 Approval 对正在等待的请求不自动实现这种 mode/policy epoch 撤销；never→ask 后，未取消的旧 answer 仍能返回 allowed-once。
- 当前 A coordinator 仅在等待前后重读 active/canAsk，真实 preset ABA 和 policy ABA 都能接受旧 review。对应测试是在记录当前不足，不是安全目标的验收通过；A 改进后必须更新该基线，不能静默 skip。
- 原生 `current()` 在前置 session observer 中仍能读到已提交的新值。但仅靠末态读值仍不能识别 ABA；消费前必须扫描原生提交尾段／检查锁存的 epoch。
- `agent.ctx.permissionPresets` 未声明注入，会原生抛 `without inject`。必须通过 C 自己声明依赖的作用域读取，并传入经 authority 验证的真实 Agent/Session，不可改用隐式 get 绕过声明。
- Cordis 多次读同一 service 可以返回不同的 scope-bound proxy；proxy `===` 不是代际或 Host 身份。绑定的是 C 私有的依赖-scope binding 和 `ctx.effect` 清理 signal，而不是 service wrapper 指针。

## 2. 路由和不可复活边界

`src/development-policy.js` 已实现 `createDevelopmentPolicyTracker(ctx)`：在真实 `tools/pre-execute` 调用 `next()` **之前**，按 exec 对象身份保存原生 policy 游标、binding 和三项值；C 本体只消费 `capture(exec)` / `inspect(handle)` / `revalidate(handle)`，不重新建立 epoch。这样即使旧 A 在 pre 的 next-unwind 中等待 AI，期间的 ABA 也会使 body capture 失败。错过原生 pre 的中途加载不能采用旧调用；自身取消 signal 不修改或 abort Agent signal。此见证本身不提供来源或许可，来源仍由实际 C execute 中的 authority 证明。

| 入口已确定状态 | 行为 |
|---|---|
| approve-for-me + ask | 仅 sealed broker 路径；无 broker、未就绪、禁用、操作不支持、没有封存能力均抛闭合失败 |
| 仅 read-only/workspace-write/danger-full-access，且 public resolve 与实际模式／策略完全匹配原标准 bundle | 保留原固定 argv 和原 runner 调用；其它命名 preset 或被改过 bundle 的标准名都不进入 legacy |
| custom、读源缺失、依赖不完整／卸载、不能确定实际来源 | 闭合失败，不猜测为 legacy；custom 是派生态，不是明确选择的其它文件模式 |
| 任意等待期间发生相关 policy 事件或 binding 终结 | 锁存失效；切回原值、新服务重装也不能复活旧 invocation；绝不动态跳回 legacy |

其它明确模式的旧路径不意味着 never 被绕过：这些路径原来不请求新增授权，例如 danger-full-access 的 standing 策略本来就是 never。新增 approve-for-me 分支则始终需要 ask，且 custom 不进入旧路径。

锁存规则：

1. 订阅同一真实 Session 的三个事件；要求 `session.eventAt(event.seq) === event` 且在捕获游标之后。伪造／重放 observer payload 不能当作新事件。
2. 每次 await 后、发问前、消费 ticket 前、执行提交前，都扫描捕获游标后的真实事件；出现一次相关变化即永久撤销该 invocation。
3. policy binding 由真实 `ctx.inject` 回调产生私有对象；回调清理时 abort。`inspect(handle).policyEpoch` 是该 binding 对真实 Session 的冻结 opaque token，同一政策代内跨 exec 稳定，而不是每次新 handle。原生相关事件／ABA／binding 结束令旧代失效；下次 pre 扫描真实 seq 尾段，所以无活跃 exec 期间的变更也不会漏。正在等待的调用持有原见证，不能转接“全局最新 binding”。task 规则可比较 policyEpoch 身份，每 exec 的独立 signal 仍照常在本体结束时终止。
4. 原生模式和策略从上述公开方法重读；相关服务没有可用声明依赖时失败。不访问 private service internals。
5. 这些保证覆盖公开 canonical setter／依赖生命周期；任意同进程插件直接篡改配置对象而不走公开事件，不存在可借用的通用模式 epoch。这仍属于已明确的可信 Host／reviewed composition 前提，不构造一个假字段补足。

## 3. 最小入口改动形态

下面是**待实现的 diff 方案**。`development-invocation.js` / controller / broker 契约尚不存在，不能把片段当成已可运行的导入。先实现并测完这些依赖，再申请入口接线；本阶段不改入口。

### 依赖与定义注册

```diff
+import { createDevelopmentExecutionAuthority } from './development-execution.js'
+import { createDevelopmentTaskTracker } from './development-tasks.js'
+import { createDevelopmentPolicyTracker } from './development-policy.js'
+import { createDevelopmentInvocationController } from './development-invocation.js' // 待实现
-export const inject = ['tools', 'webServer', 'connection']
+export const inject = ['tools', 'webServer', 'connection', 'agents', 'sessions', 'approval']

 export function apply(ctx) {
   // 原 heal/recovery/client-failure/safety 安装保持原样。
+  const ownedDefinitions = new Map()
+  let authority, invocations
+  const tasks = createDevelopmentTaskTracker(ctx)
+  const policy = createDevelopmentPolicyTracker(ctx)
+  const registerOwned = definition => {
+    ownedDefinitions.set(definition.name, definition)
+    return ctx.tools.register(definition)
+  }
   // 只有下列四处 ctx.tools.register 换为 registerOwned。
   // 其它五个定义不纳入来源／grant operation 集合。
   ...
+  authority = createDevelopmentExecutionAuthority(ctx, ownedDefinitions)
+  invocations = createDevelopmentInvocationController(ctx, { authority, tasks, policy })
 }
```

mode 模块与 Controller 各自持有**可选子依赖 scope**，不把未部署的 broker 放入 C 主 inject。主 inject 增加 approval 是为了实际发出那个唯一官方请求；不能借未声明的 Agent.ctx：

- 已实现的 policy 模块内部 `ctx.inject(['permissionPresets','approval','sandboxPolicy','agents','sessions'], ...)` 为每次激活产生独立 binding，effect 清理 abort。Controller 只消费该模块对原 exec 的见证，不另建“最新模式源”，也不在 body 重新捕获游标。
- `ctx.inject(['<最终约定的 broker service key>'], brokerCtx => ...)`；这只是待定契约占位，不声称当前存在这个 service。只接 review 过的 C↔broker 私有连接，不能允许任意 `sourceVerified` callback 注入来源。
- optional 是“缺失不阻止其它工具注册”，不是“缺失许可降级为直接执行”。没有 broker 的已知 legacy 模式维持原路径；approve-for-me 一律拒绝。

### 四个实际 execute 闭包

保留参数 schema、output、timeout、presentation 和现有业务验证。四个定义对象本身收集到 Map，不从工具名重新找一份自造定义。下面 `invocations.open()`、`invokeSealed()`、`legacyExecution()` 是待实现的私有方法。

```diff
 // dshx_check
-    execute(args, exec) {
+    async execute(args, exec) {
       const id = pluginId(args.name)
-      return runClaimedDshx(id, ['check', id], exec, { ...authOptions, hostPort: currentWebPort() })
+      const owner = authority.enter(exec, args)
+      const policyHandle = policy.capture(exec) // 消费 pre 见证，绝非此刻新建 epoch
+      const call = invocations.open(owner, exec, policyHandle)
+      try {
+        if (call.route === 'sealed') return await invocations.invokeSealed(call)
+        return await runClaimedDshx(id, ['check', id], call.legacyExecution(), { ...authOptions, hostPort: currentWebPort() })
+      } finally { call.close() }
     }

 // dshx_activation_plan
-    execute(args, exec) {
+    async execute(args, exec) {
       const id = pluginId(args.name)
-      return runClaimedDshx(id, [
-        'activation-plan', id, '--change', choice(args.change, CHANGES, 'change surface'),
-      ], exec, { ...authOptions, hostPort: currentWebPort() })
+      const change = choice(args.change, CHANGES, 'change surface')
+      const owner = authority.enter(exec, args)
+      const policyHandle = policy.capture(exec) // 消费 pre 见证，绝非此刻新建 epoch
+      const call = invocations.open(owner, exec, policyHandle)
+      try {
+        if (call.route === 'sealed') return await invocations.invokeSealed(call)
+        return await runClaimedDshx(id, ['activation-plan', id, '--change', change], call.legacyExecution(), { ...authOptions, hostPort: currentWebPort() })
+      } finally { call.close() }
     }

 // dshx_activate_new_client
-    execute(args, exec) {
+    async execute(args, exec) {
       const id = pluginId(args.name)
       const port = currentWebPort()
-      return runClaimedDshx(id, [
-        'activate-new-client', id, '--profile', 'web', '--port', String(port),
-      ], exec, { ...authOptions, hostPort: port })
+      const owner = authority.enter(exec, args)
+      const policyHandle = policy.capture(exec) // 消费 pre 见证，绝非此刻新建 epoch
+      const call = invocations.open(owner, exec, policyHandle)
+      try {
+        if (call.route === 'sealed') return await invocations.invokeSealed(call)
+        return await runClaimedDshx(id, ['activate-new-client', id, '--profile', 'web', '--port', String(port)], call.legacyExecution(), { ...authOptions, hostPort: port })
+      } finally { call.close() }
     }

 // dshx_hot_reload
-    execute(args, exec) {
+    async execute(args, exec) {
       const id = pluginId(args.name)
       if (HOT_RELOAD_INFRASTRUCTURE.has(id)) {
         throw new Error(`dshx_hot_reload cannot replace its executing infrastructure plugin: ${id}`)
       }
       const port = currentWebPort()
-      return runClaimedDshx(id, [
-        'hot-reload', id, '--profile', 'web', '--port', String(port), '--json',
-      ], exec, { ...authOptions, hostPort: port })
+      const owner = authority.enter(exec, args)
+      const policyHandle = policy.capture(exec) // 消费 pre 见证，绝非此刻新建 epoch
+      const call = invocations.open(owner, exec, policyHandle)
+      try {
+        if (call.route === 'sealed') return await invocations.invokeSealed(call)
+        return await runClaimedDshx(id, ['hot-reload', id, '--profile', 'web', '--port', String(port), '--json'], call.legacyExecution(), { ...authOptions, hostPort: port })
+      } finally { call.close() }
     }
```

`open()` 只返回明确的 sealed/legacy，unknown/custom 直接抛错；sealed 路径没有任何 `runLegacyDshx`、runner callback 或 argv 执行口。`legacyExecution()` 再验证原 route/epoch，返回仅更换为融合取消信号的私有 runner 输入；该副本**不用于** authority.enter、任务捕获或来源绑定，后者始终是原始 exec。

## 4. Controller／可选 broker 必需契约

1. 四个 operation 只能来自 `authority.inspect(owner)`：check / activation-plan / hot-reload / activate-new-client。claim 不在集合中。`activate-new-client` 的来源成立不代表执行端已支持封存；不支持就拒绝。
2. C 保持完整 authority 私有；A 只接绑定到该 C producer 的只读 request reader。root 和 preset 各自 apply 的 Map、owner、request、任务、binding 均独立；不得用最后加载者覆盖全局来源。候选必须通过当前真实定义／作用域可见性再验证。
3. Task tracker 在 apply 时安装。首次中途加载、继承历史、已有 inbox、未观察到本轮新直接输入，均不能自造 task；只允许标为 task-unavailable。它不妨碍未来**独立人工** once/remember 的可行性，但 task 授权选项和 task 自动命中必须禁用。无 broker 的本阶段仍没有任何授权路径。
4. prepare 只能生成受限不可变封存材料，不能运行构建 hook／DSHX 或借准备之名执行动作。必须绑定真实 target/目录身份、operation、文件字节、执行 recipe、同一 Host/workspace 等既定目标契约，返回 opaque prepared handle。
5. 在私有 WeakMap 中把这个 prepared handle、mode epoch、可用任务绑定到 authority 自己生成的**同一个** frozen ApprovalRequest。仅创建一次，仅调用一次 `policyCtx.approval.request(request)`。不能复用其 allowed-once 或按 callId 去重来制造新许可。
6. 需要对 `development-execution.js` 增加一个 **C 私有、只会撤销、不颁许可** 的 `revoke(owner)`（待实现），由 policy/task/broker binding 的 abort 调用。其效果使用现有 `close(record, reason)` 使 authority 已生成的 request.signal 同步 abort；reader 不暴露 revoke。否则当前 API 的 request.signal 只有 caller/body/producer 生命周期，不能声称已经包含模式 epoch。
7. pending/reply/consume 每步都重查 source、mode、binding、task（如适用）、target、prepared handle 和规则状态。A／broker 自己的启用状态、配置、规则、HMR 变化也要有独立 epoch；不能复用 A 当前只读末态的 coordinator 当作防重放边界。
8. 原生 allowed-once 仅是必要条件，不是可执行 ticket。broker 必须有独立、人为确认来源的 once/task/remember 授权或有效原规则，并单次消费。唯一执行口只接受 opaque ticket/prepared handle 和受管取消信号，直接执行已封存 recipe，**不能**再接 mutable argv/path/旧 runner callback。
9. 所有未就绪／unsupported／失效／取消都结束当前 sealed 调用。不能转旧 runner、再问通用 AI、换最新 broker、重签新 ticket、扩为整轮权限。
10. 接线前补 controller 真实 source tests、四定义闭包集成测试及 prepared 执行端互操作；随后再讨论 manifest 对新 helper 的精确 artifacts 声明和外部 supervisor 交付。当前测试不证明生产接线、人类 UI、封存执行或激活。

## 5. 可移植测试定位

`tests/source-checkout.mjs`：

- 明确 `DSHX_HARNESS=/absolute/source/checkout` 时优先使用；空、相对、缺失、错误 package、缺 Core 源码或缺该 checkout 的 TSX 均硬失败，不回落。
- 未设置时仅检查 cwd、`<checkout>/my-plugins/<C>` 的祖先、`<project>/plugins/<C>` 的兄弟 `runtime` 三个明确布局。验证 root package 名、源码标记、tsconfig、workspace 文件和 TSX；realpath 去重。多份不同有效 checkout 报歧义，不按 mtime 或全局“最近源”挑选。
- A 从选定 checkout 的 my-plugins 链接或 C 的 sibling 定位、校验；不同副本需要明确 `DSHX_APPROVER_SOURCE`。A 仍只读。
- 已替换 execution/tasks/authorization-feasibility 新增测试中的机器绝对 checkout/A 路径。旧 bridge 测试的既有命令字符串样例不是 checkout 定位，不在此次路径改动范围。

```sh
DSHX_HARNESS=/absolute/source/checkout TSX_DISABLE_CACHE=1 \
node --experimental-vm-modules --test \
  tests/source-checkout.spec.mjs tests/development-policy.spec.mjs \
  tests/development-execution.spec.mjs tests/development-tasks.spec.mjs \
  tests/development-target.spec.mjs tests/authorization-feasibility.spec.mjs
```

全部 native source 缺失／版本接口不匹配均真实失败，无 skip、无 installed-package 替身回退。
