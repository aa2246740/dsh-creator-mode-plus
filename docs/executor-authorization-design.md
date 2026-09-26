# 外部 DSHX 执行授权候选设计

## 0. 结论、状态与边界

**本文件是只读设计，不是已安装能力或执行验证结果。** 本次未修改 Harness core/vendor、当前 `/runtime/tools/dshx`、运行中的执行端、九工具定义或模型参数；未启动、构建、激活或热替换任何组件。

目标链路为：

> 受控解析真实目标 → 准备完整、固定的可执行产物 → 在同一 Host 内封存最终字节 → 官方人类单次/任务/记住确认 → 消费一次 ticket → 仅实例化该封存产物。

**不能继续把“父 beforeSpawn 复验 + child 再算一次 hash + 事后 receipt”描述为最终绑定。** child 必须不再从会变化的工作树选择或读取本次待执行代码。

可行性分为两层：

1. **可交外部维护流程实现的最小候选：** 外部 DSHX 增加受控 preparer、长期 Host executor 和稳定目标 adapter；首先支持明确限定的 root、单目标、封闭可执行 capsule。使用现有公共 Cordis 生命周期承载目标；批准后的实际项目代码来自 Host 私有内存内的不可变字符串，而不是一个“只读目录”中的路径。此路线不需要改 core/vendor，但须完成下述适配、隔离候选测试和外部部署。
2. **不能承诺现有公共接口已经支持任意旧插件：** 一般 ESM/CJS 解析图、动态导入、原文件 URL 语义、任意 Loader entry 的并发 CAS 替换、preset 多代际批量替换，都没有现成的 sealed-module 原语。若“完整接通”要求对所有既有插件保持完全透明兼容，仍需第 10 节的公共接口，或将目标迁移为执行端真正拥有的受管 adapter。不能通过访问 Node/Loader 私有缓存来假装满足限制。

固定九工具及其模型可见参数保持不变。新的 prepare/seal/authorize/consume 是**待实现的执行端内部协议**，不是新增模型工具、任意 argv、任意模块路径或命令执行通道。

## 1. 当前源码给出的事实

路径约定：

- `R` = `/Users/wu/Documents/DeepSeekHarness/runtime`
- `C` = `/Users/wu/Documents/DeepSeekHarness/plugins/dsh-creator-mode-plus`

以下判断依据本次实际读取的工作树；候选发布前必须在其锁定的 checkout 上复验，不能用旧安装依赖的接口代替。

| 编号 | 源码位置 | 对设计的直接约束 |
| --- | --- | --- |
| S1 | `R/tools/dshx/src/commands/hot-reload.ts:6–12` | 当前入口只有 pluginId/profile/port/timeout/scope，没有批准的 digest、目录身份或 sealed artifact 输入。 |
| S2 | `R/tools/dshx/src/internal/hot-reload.ts:771–835` | 先等待 Host 身份证明，再于 child 中 loadPlugin/checkPlugin，之后建立 artifactStates；父的检查不能约束 child 首次读到哪个版本。 |
| S3 | `R/tools/dshx/src/internal/hot-reload.ts:467–599` | 实际 Loader 目标可由 package exports/main 或行名解析；artifactStates 会把实际 runtimeEntry 加入集合，不能只快照 dshx.yml.entry。 |
| S4 | `R/tools/dshx/src/internal/hot-reload.ts:934–962` | READY、触发 utimes、模块替换后的 hash 检查相对 child 自己建立的 baseline；不是父批准内容的加载闸门。 |
| S5 | `R/tools/dshx/src/internal/plugin.ts:134–147,173–205` | resolvePluginDir 先尝试 root/id，再 my-plugins/id；manifest 缺失还可推断。授权准备必须禁止 shadow 和含糊推断，不能把 id 当来源证明。 |
| S6 | `R/tools/dshx/src/runtime/hot-reload-observer.mjs:74–119,213–267,290–313` | observer 以真实 entry/runtime/fiber 集合观察替换，并匹配 hmr/reload 事件；它不是批准前阻止 import 的接口。其 root 分支拒绝跨 entry 共享 runtime。 |
| S7 | `R/tools/dshx/src/runtime/hot-reload-observer.mjs:59–69` | 当前 observer 只接受精确 file URL；不能原样用于内存 capsule 或冒用旧 receipt。 |
| S8 | `R/vendor/loader/src/config/tree.ts:75–87,113–165` | 公共 resolve/entries/import 可用；import 支持 cordis: builtin，否则按 name 导入。没有 prepare-without-evaluation、sealed source、expected generation 或 conditional replace 参数。 |
| S9 | `R/vendor/loader/src/config/entry.ts:141–245,277–301` | 公共 Entry.update({name}) 可换模块；先 await 导入候选，再 dispose/start，失败可重用旧 callback 回滚。它不是带批准状态和代际 CAS 的事务。 |
| S10 | `R/packages/boot/app-boot/tests/config-reload.spec.ts:93–143` | 当前官方测试覆盖换 name、import 失败保留旧 fiber、apply 失败恢复旧 callback；并未证明并发授权、封存字节或取消在 import 前的闸门。 |
| S11 | `R/vendor/cordis/src/registry.ts:170–185,230–266,304–318`；`R/vendor/cordis/src/fiber.ts:704–751` | 公共 ctx.plugin、Fiber.await/dispose/restart/update 可用于执行端拥有的 child 生命周期。registry.delete 是整个 callback 的所有 fibers，不能拿来代替精确 scope 替换。 |
| S12 | `R/vendor/hmr/src/index.ts:446–539` | 现有 HMR 使用 Node loadCache/CJS cache、旧 fiber 的 _config 等内部细节；外部候选不得复制这些私有操作作为“公共扩展”。 |
| S13 | `R/packages/core/scope/src/index.ts:137–179`；`R/packages/preset/agent-presets/src/index.ts:380–388,746–786` | scope 是对象身份/继承链；旧 standing generation 可持续存在。ctx.root 不等于当前 Agent/producer scope，也不能用 preset 名称替代代际集合。 |
| S14 | `R/packages/interaction/user-approval/src/index.ts:207–225,235–296` | 必须在 open turn 内调用官方 request；never 在 answerer 前拒绝；request 对象原样借给 waterfall；等待期间模式/策略变化仍需消费端复验。 |
| S15 | `R/packages/client/connection/src/rpc.ts:115–134`；`rpc-host.ts:139–155` | 官方 Connection 可提供认证、effect-owned 的准确路由；这只是通信鉴权，不是人类同意证明。 |
| S16 | `R/tools/dshx/src/internal/creator.ts:37–46,366,407` | CreatorContext 不含 expected bytes；claim 和 activation lock 仍必须保留，但不能把协作锁当作工作树不可变性。 |

`C/src/development-target.js` 已提供父侧目标绑定和有界快照。它适合作为输入校验的一部分，不提供最终加载绑定；其 `evidenceBoundary: parent-observation-only` 必须保留。原有目标测试不能当成新 executor 协议已通过的证据。

## 2. 要证明什么、不证明什么

### 2.1 必须成立的不变量

- **P1 来源：** 只有真实 Creator execute 闭包持有的 producer lease，结合原生 execution token、真实 Agent、当前 root 和 task，才可创建授权候选。模型 JSON 的名称、callId、sourceVerified、路径和 ticket 字段都不是来源证明。
- **P2 内容：** 人类看到并批准的 digest，绑定 Host 已封存的最终可执行字节和完整支持范围；项目文件随后变化不能改变本次加载的代码。
- **P3 完整性：** manifest 同时包括原始 metadata、declared entry、实际 runtimeEntry、受支持代码闭包、编译结果和编译器/执行 profile。不能把缺失的 runtimeEntry 或依赖称为已批准。
- **P4 一次性：** 每个 ticket 至多跨越一次执行提交点；失败、取消、进程丢失或 receipt 不明都不能恢复其使用次数。
- **P5 位置：** 执行发生在批准的 Host lifetime、确切 adapter/目标代际、原 parent context/config 中；不因 ctx.root 服务共享而扩大到其他 scope。
- **P6 规则：** remembered rule 绑定稳定开发目标，而非某次 hash；每个未来版本仍须重新 prepare/seal，再由同一规则判定新候选。
- **P7 撤销：** 提交前的 never、模式改变、task/producer/consumer/adapter disposal、claim 失效、Host 更换或用户撤销都禁止消费；不自动降级到普通 HMR。
- **P8 执行路径：** 批准之后，项目代码的输入是封存对象，不是 sourceRoot、alias、runtimeEntry 路径、URL 的再次解析结果。

### 2.2 威胁与证明范围

防止模型伪造来源/参数、同名替代、文件或链接在批准前后变化、并发/重放、旧代际复用、异步迟到答复，以及 mutable path → child → Loader 的字节替换。

这不是对任意恶意同进程插件、被攻破的 Host、任意 OS 管理员或被替换的可信编译器的沙箱。已加载平台服务、编译器和 executor 属于明确列出的 TCB。若运行环境允许攻击者修改 executor 的内存或可信启动链，本方案不能声称仍有最终执行保证。

“固定可执行字节”也不等于“应用行为没有任何副作用”或“运行时读取的数据也固定”。但目标若会把可变数据当代码加载，则不能列入封闭代码 profile；不能用 AST 正则黑名单冒充一般 JavaScript 的动态行为证明。

## 3. 受支持范围：先封闭 capsule，不冒充任意模块兼容

### 3.1 首个可验证 profile

候选名：`closed-root-capsule-v1`，仅为设计中的能力标识。

- 已由外部维护流程迁移并登记的稳定 root target adapter；一个确定的 root Loader 行及其由 executor 拥有的 payload generation。
- 保留同 PID、同 Home/checkout/port/process-start、claim、保护目录和控制插件排除规则。
- 原始 metadata/entry/实际 runtimeEntry 明确、无路径推断/同名 shadow；有限文件集合，无 metadata/代码 symlink。
- 最终产物为**自包含 ESM JavaScript**。项目内静态依赖可由固定、无用户插件的编译器从封存输入打包进同一产物；输出不得再从可变路径导入项目代码。
- 初版拒绝残留静态 import、动态 import、CJS require/createRequire、native addon、按原文件位置读取代码、运行时 code generation 和无法证明闭合的 worker/子进程代码加载。需要这些能力的插件不是“猜测通过”，而是 `UNSUPPORTED_SEALED_EXECUTION`。
- 目标通过 Cordis 的真实 ctx/services 工作；不得把另一份 Cordis/core 打包进去。需要外部运行时库的 profile，须另行定义固定 TCB namespace 或完整 image 依赖机制并测试，不能偷偷借工作树/node_modules。
- `import.meta.url`、`__dirname`、相对资源路径、self-resolution、exports condition 的语义变化必须显式处理；无法保持的目标拒绝迁移。初版不承诺“复制到新目录仍行为一样”。
- Host 的模块加载环境必须由外部维护流程证明可加载该 capsule 且不会通过未审查 hook 重写/外读其代码。没有这种环境资格，不宣称精确执行保证。

这些是后端支持范围，不是按九工具名称/模型参数增加的授权白名单。一个 profile 声明本身也不能给出资格；validator 必须实际证明其条件。若需要接受任意一般 JavaScript 的动态加载行为，转第 10 节，不能降低 profile 标准来凑“全支持”。

### 3.2 scope 与其他操作

- **Creator producer** 可以处在 root 或 Agent/preset scope；其来源、task 和消费资格始终按原对象身份核对。
- **九工具的 server hot-reload target** 仍是 root-scope；不得把 producer 在 preset scope 解释成授予 preset 全代际替换权。
- preset-private、跨 root/preset 共享 runtime、多 standing generations、自身/控制插件替换仍交外部维护流程。未来如支持批量 adapter replacement，必须有单独的完整 fiber 集合事务，不能复用 root ticket。
- 此首版的“最终字节绑定”只覆盖支持 profile 的服务器 payload。`new-client` 还需要浏览器实际消费的 manifest/chunk/CSS 固定交付；HTTP 缓存命中、文件 hash 或客户端 receipt 本身不足。不得给未实现的客户端路径挂上同一保证。
- claim/scaffold/check/plan/status/browser/remove 的原有授权与安全约束保留；它们并不因此自动获得一个新的任意执行接口。

## 4. 组件与信任归属

| 组件 | 归属/安装方式 | 职责 |
| --- | --- | --- |
| Creator issuer | 已有 C，由外部协调升级兼容接口 | 在实际 execute body 内绑定 exec/Agent/root/producer/task，发起私有准备；不 pre-auto-allow。 |
| Approval coordinator/UI | 已有审批插件及官方 Approval/Connection 扩展点 | 将封存 manifest 展示给用户，记录明确 once/task/remember 选择；维护私有来源关联和撤销。 |
| DSHX preparer | **外部候选执行端**，隔离验证后由维护方部署 | 只做受控目标解析、读源、可信编译与产物传输；不能自行批准或加载项目。 |
| Host executor/gate | 外部部署的长期 root Cordis 插件，不是临时 observer | 以 ctx.root 为归属持有私有 sealed bytes、ticket 状态和 adapter 所有权；提交前现场核对授权。 |
| Stable target adapter | 外部维护流程迁移/登记，使用公共 Cordis 生命周期 | 在自己真实 parent context 下管理项目 payload child；正常更新不再让旧文件 watcher 重新选择项目源码。 |
| Observer vNext | 外部候选的一部分 | 独立核对目标代际/生命周期/清理结果；不是执行授权的替代品。 |

Host gate 不能由一次请求临时插入的 observer 代替：准备期间不得因为安装 watcher 或 import 一个目标模块就已经运行待批准代码。

root 服务必须根键控、effect-owned 并有明确代际。多个 root/scoped Creator、多个审批插件实例不能重复注册路由或跨根共享 pending/grant。共享仅是同一 root 的控制平面；业务调用保存原 ctx、Agent、scope 对象和 lease。

新 executor/adapter 自身也属于受保护控制面，其升级和移除不得使用开发目标 remembered grant，更不得由当前会话自替换。

## 5. 第一阶段：准备并封存，不运行项目代码

### 5.1 安全启动协议

九工具的 JSON schema 不变化。C 和外部候选通过固定、版本化的私有通道协作，具体 transport 属于未来补丁：可以是受控 worker 的匿名继承管道，以及官方 Connection 上 root gate 拥有的精确认证路由。

必须遵守：

1. 先用只读握手证明 executor build/contract、Host lifetime、能力及协议版本；不只比较 `0.7.x`。
2. worker 默认无动作，在已鉴别的有界消息到达前不得运行 hot-reload。
3. **禁止对旧 `hot-reload <id>` 注入一个它可能忽略的 PREPARE 环境变量。** 否则旧执行端会在批准前真的 hot-reload。候选应提供无默认执行动作的私有 worker/协议入口；未协商能力立即拒绝。
4. 私有消息类型、目标和 worker 路径由 Host 代码选择；模型不能传 phase、argv、文件 URL、profile、PID、ticket 或执行字节。
5. 准备结果的公开展示层只返回 manifest/digest/状态；秘密 ticket/承载凭证不进入工具结果、日志、命令行或模型上下文。
6. Connection 的认证/CSRF 只证明通道，不证明人类选择。外部 worker 没有可从 JSON 构造的“人类授权”字段。

这需要外部候选和桥接插件的协同版本升级；不是当前 bridge 固定 argv 校验的规避方式。

### 5.2 解析实际目标

prepare 输入来自 Host 记录中的 pluginId、真实 workspace/root、当前 claim 和确切目标 owner，不来自任意路径参数。

流程：

- 复用 development-target 的 identity/bounds 原则，禁止 root/id shadow、core/control、含糊 id/name/profile，以及 metadata/artifact symlink。
- claim 必须已合法存在。prepare 不得为了通过检查悄悄进行一次未获授权的 `creator claim`；缺失时返回 `CLAIM_REQUIRED`，由原有工具流程处理。
- 从真实 Loader entry 对象、父 tree/baseUrl、当前 adapter 登记及 generation 记录得到目标。id/name 只定位，最终以对象/lease/manifest 关联证明所有权。
- 对首次未受管目标，不能用一次 import 来“探测”实际 exports。只接受当前 DSHX 能无歧义静态解析的 file/name、精确 profile link、唯一 exports leaf/main 等受限情况，并经外部维护迁移验证。需要任意 Host resolver 行为或实际 live module URL 证明时，缺少第 10 节接口即停止。
- 区分 `declaredEntry`、`resolvedRuntimeEntry`、`currentLiveTarget` 和 `emittedCapsule`。四者不得互相冒充。实际 runtimeEntry 必须列入此次原始输入与 hash 清单，即使它原本不在 hotReload.artifacts 中。
- 把 actual runtimeEntry、声明 artifacts、静态解析到的受支持代码闭包以及相关 package/解析元数据纳入完整有限输入；外部代码依赖要么是该 profile 明确的 TCB，要么拒绝。超出文件数/字节/路径/图深度预算即失败。

### 5.3 固定产物

先把输入读取为受控副本，再仅从这些副本进行解析和编译。不得批准源 hash 后又让编译器重新读工作树；不得运行 package scripts、postinstall、用户 build plugin 或目标模块顶层代码来生成待批准产物。

`checkPlugin` 当前包含基于路径的再读。未来 preparer 必须为其检查逻辑提供 snapshot reader，或在完全属于候选的封闭输入视图上运行静态检查；不能把未修改的 live-path 调用称为快照验证。

编译 options、编译器版本、实际 runtimeEntry、全部输入与输出均进入 manifest。最终产物中加入 prepare 时生成的唯一实例标识并一起封存，使模块实例 URL 不会无意复用另一 ticket 的旧评估结果；该标识不是未来 remembered rule 的一部分。

仅将目录 chmod 为只读、owner-only 或起一个 digest 文件名不够：同一可写主体仍可能替换目录项或改变权限。**本次执行的权威产物应先完整交到 Host gate，由 gate 自己计算 digest、复制并保存在私有闭包中。** JavaScript 源字符串不可变；不得把内部 Buffer/view 直接暴露给调用者。

一个建议的公开 manifest（不是批准凭证）：

```text
PreparedManifest {
  protocolVersion, supportProfile, preparerBuild,
  sourceBinding: {
    engine: "creator-plus-v1", harnessRoot, workspaceRoot,
    sourceRoot, pluginId, sourceDirectoryIdentity: { dev, ino }
  },
  hostLifetime, targetOwnerSummary, targetGenerationSetDigest,
  declaredEntry, resolvedRuntimeEntry, resolutionEvidence,
  inputs: [{ relativePath, kind, bytes, sha256 }],
  transform: { compilerIdentity, optionsDigest },
  emitted: [{ kind, bytes, sha256 }],
  configDigest, tcbDependencies, supportLimitations,
  imageDigest, expiresAt
}
```

Host 私有记录另持有真实 entry/adapter、Agent、scope、exec.token、producer/consumer lease 和实际封存字节。JSON 内的同名字段不能重建这些对象。

**SEAL 完成后才可展示批准请求。** 如果候选编译后的 image 与 UI 展示的是不同版本，即便源文件相同也不能使用该批准。

## 6. 第二阶段：官方确认、一次性 ticket 与最终消费

### 6.1 官方确认

C 的实际 body 为这次封存 image 创建新的普通 ApprovalRequest。私有 WeakMap 关联该确切 request 对象与 prepared handle、exec.token、Agent、root、task 和 producer/consumer lease。

- 调用正式 `ctx.approval.request(req)`，保留 turn 内 asked/decided 审计。
- UI 展示真实 sourceBinding、实际 runtimeEntry、输入/输出 digest、目标 scope/代际范围、迁移影响和回滚点。
- once/task/remember 是独立、明确的人类选择。原生外层 pre-execute ask 的 allowed-once 不能升级成此 image 的 task/remember 授权。
- 任务授权/记住规则命中可以省去再次人类确认，但仍须以新 request 走官方服务并在消费时重查。native never 不允许被命中规则越过。
- 普通 default pre allow 不额外触发一次 AI 评审；本次 prepared-image 决策只有一个归属处理器。
- 如果产品无法区分人类点击与同浏览器权限的自动化，必须明示该威胁边界或增加真正可信宿主确认入口；不能用自定义 CSRF header 伪造“已证明人类”。

用户对“实现外部执行端”的总授权不是某个未来 image 的单次/任务/remember 批准。

### 6.2 ticket 状态机

建议状态：

```text
PREPARING -> SEALED -> AWAITING_APPROVAL -> AUTHORIZED -> COMMITTING
                       |                     |             |
                       +-> REJECTED           +-> REVOKED   +-> ACTIVE
                       +-> EXPIRED                          +-> FAILED_AFTER_COMMIT
                       +-> CANCELLED                        +-> UNKNOWN_AFTER_COMMIT
```

- SEALED 只有不可执行的 prepared handle；worker 不持有从 SEALED 自行变为 AUTHORIZED 的能力。
- 官方结果为 allowed-once 且相关 lease 仍有效时，Host 才创建一次消费记录。对于 task/remember，每个新 image 都重新签发本次记录。
- ticket 至少绑定 imageDigest、真实 owner、目标 generation set、config、Host lifetime、调用/任务关联、授权选择、撤销 epoch 和短期过期时间。
- actor/secret 信息只通过 Host 私有对象或私有通道传递。公开 snapshotId 可以用于 UI 定位，不能作为 bearer 权限。
- 并发消费以 Host 内同一控制平面的 compare-and-set 串行化；一旦进入 COMMITTING，ticket 永久烧毁。失败或不明结果只允许查状态，不能重放执行。

### 6.3 提交闸门与实际加载

以下是**候选自有 API 的伪代码**，不是现有 Loader API：

```text
with adapter-owned serial executor:
  require ticket == AUTHORIZED
  require same Host lifetime, owner context, adapter generation and source binding
  require same live Agent/task/producer/consumer leases
  require claim remains valid
  require AutoApprove still explicitly active for this grant path
  require official policy is not never; request/execution signals not aborted
  require approved imageDigest == private sealed imageDigest
  burn ticket -> COMMITTING                   // before any project evaluation
  instantiate ONLY private sealed code       // no workspace/module-path reread
  if still valid, replace exact owned payload generation
  await old payload disposal and new payload readiness
  emit generation/cleanup receipt
```

提交点之后不能承诺撤销已经发生的顶层副作用。取消/撤销应尽可能阻止后续尚未发生的激活，并清楚报告 `FAILED_AFTER_COMMIT` 或取消发生时的阶段；不能把“已执行但用户随后取消”写成“未执行”。每个 await 后都重新检查相关 lease，尤其不能在旧 payload disposal 等待后无条件启动新 payload。

对于 root 执行端已经拥有的 adapter，可保留之前已加载的 namespace/callback/config，按已批准的有限回滚策略恢复旧 payload，不能回滚时再次从会变化的旧工作树路径 import。项目顶层副作用不一定可回滚；模块 import/apply 失败要烧毁 ticket 并如实说明。

为保持当前“等待中的源变化作废”语义，v1 默认在提交前检测到 live 源变化就返回 `SOURCE_CHANGED_STALE`，要求新 prepare/新决策；不能悄悄刷新 manifest 继续使用旧批准。**即使最后一次复验之后又发生源文件变化，实际加载仍只来自已封存 image**，所以该竞态不再决定被执行字节。

## 7. 如何使用公共 Loader/Cordis，而不偷用内部实现

### 7.1 推荐的受管 adapter 路线

外部维护方一次性把一个符合支持范围的 root 目标迁移为稳定 adapter，并把该迁移的影响、scope、持久化行为与回滚点单独交人类确认。它不是当前会话的自升级动作。

adapter 保留真实 parent context；项目 payload 作为该 context 下的 Cordis child 创建。使用公共 ctx.plugin、Fiber.await/dispose、正式 inject/config 机制，不把 child 全部挂到 ctx.root，也不操作 `_config`、`fiber.entry`、Node loadCache 或 registry 私有 Map。

Host gate 拥有 adapter 的注册 lease、当前 payload handle、已解析 config 和代际记录。模型不能通过同名 Loader 行取得该 owner。新增同名/root/preset adapter 默认不继承旧 ticket；原生配置变更/adapter disposal 会使其 lease 失效，不能自动导入工作树代码。

首个无外部代码导入的 capsule 可使用完整封存源码构造内存模块 URL，由受资格确认的 Host 加载环境进行导入，再通过公共插件生命周期应用其 exports。URI/内容来自私有 sealed 字符串，不来自调用者路径。实例唯一标识在批准前已经计入 imageDigest。

公共 `ctx.loader.builtins` 与 `cordis:` import 提供另一种装配方式：**批准后**得到的 namespace 可由 executor 登记为私有受管 builtin。不能在批准前为了获取 namespace 就 import 项目。也不能把一个永远从可变文件读取 payload 的 builtin wrapper 称为封存执行。

正常后续更新由 adapter 自己的单目标串行器处理，不反复修改陌生 Loader entry 的 name。源码 HMR 不得另有一条路径把受管目标切回未批准源码；迁移必须验证原入口/关联 watcher 的处置，并使稳定 adapter 的配置不指向 live payload 文件。

### 7.2 为什么不能直接依赖 Entry.update 完成所有保证

Entry.update 是可用的公共迁移/生命周期原语，官方也测了失败回滚；但它没有 expected fiber/generation CAS，而且导入候选期间存在 await。一次外部检查之后调用它，不能防止别的配置更新同时改动该 entry。

因此：

- 对**已有受管 adapter**，执行端拥有 payload 串行器及 generation lease，可以实现自己的提交闸门。
- 对**任意未受管 entry**，不能靠临时外层 mutex 宣称所有 Loader/config/HMR writer 都受锁约束。首次迁移必须外部停住/协调该控制面并验证 owner，或等待第 10 节公共事务接口。
- 不直接赋值 `entry.options`、`entry.fiber`、`fiber.entry` 或复制 HMR 内部缓存算法来“补齐”事务。
- 不能用 registry.delete(callback) 来替换一个 scope；它影响该 callback 的全部 fibers。

### 7.3 同 PID、root/scope 与模式兼容

- root gate 按真实 ctx.root 隔离；producer 的原 scope、Agent 和 lease 随请求保留。
- payload 使用 adapter 原上下文，不凭 taskId/preset 名称重新 mint 一个等价 scope。
- 根目标与同一模块的 preset fibers 共存时，沿用现有 root scope ambiguity 拒绝原则，不能扩大九工具权限。
- Full access/其他模式不消费新的 task/remember grant，也不把等待中的 AutoApprove 请求因模式变更转成直通。对已迁移 adapter，固定 DSHX 操作仍可在既有模式权限下使用新的后端；这改变的是已明确批准的部署方式，不是偷偷新增一次 remembered 授权。
- 若要求非 AutoApprove 模式连底层文件/HMR 行为也字节级完全不变，则受管 adapter 迁移不满足该要求，需要第 10 节通用 Loader 接口；不能同时声称两种互斥部署语义。
- unsupported target 或缺失能力不得自动回退 live-path HMR 并仍标记“已绑定批准字节”。

## 8. 规则、撤销与持久化

### 8.1 未来版本匹配同一规则

稳定 binding 保持现有严格六个顶层字段形状：engine、harnessRoot、workspaceRoot、sourceRoot、pluginId、sourceDirectoryIdentity(dev/ino 字符串)。原字段之外的运行 profile、host/task/lease 等属于本次候选/决策记录，不塞进 sourceBinding 冒充其 schema。

同一源目录正常编辑文件：新 prepare → 新 inputs/output/imageDigest → 同一 remembered target rule 可判定新请求。**不能把旧 ticket 或旧 imageDigest 当作对新字节的授权。** 目录被替换导致 dev/ino 改变时是新的 binding，不能只凭同路径延续旧规则。

### 8.2 撤销

在 Host 提交串行器中重新检查：

- task 结束/取消、Agent dispose、producer/approval consumer/adapter 代际 dispose；
- effective policy 变为 never、AutoApprove 退出、用户撤销 remembered rule；
- claim/Host/Home/process-start/root/source binding 不再匹配；
- 目标 fiber 集合/config 已变化、image 过期、资格 profile/可信编译器版本不匹配。

作用是拒绝尚未提交的 ticket，不是倒撤已安装组件的所有副作用。rule 撤销、取消和提交的先后以 Host 控制平面实际接收并串行处理的顺序定义，不能承诺跨进程无时延的全局“同时撤销”。

### 8.3 重启、崩溃与副本

pending ticket 必须绑定 Host lifetime；Host 重启或 executor 换代后全部失效。磁盘 snapshot/receipt 只是缓存和审计副本，不能重新成为 bearer grant。

受管 adapter 的冷启动策略必须在外部迁移时讲清楚：不得悄悄恢复“从最新工作树 import”。首版可以失败关闭并等待重新封存/合法授权。若要无人值守恢复已批准 image，需要独立、受信任的安装记录/签名和固定 artifact 交付；仅同用户可改写的 JSON + hash 不是信任根。此能力未实现就不得宣称自动安全回放。

## 9. Observer vNext 与证据标签

旧 observer 的 file-URL/hmr-event 证明不能原封不动用于 capsule。候选应新增独立版本化报告，至少区分：

1. `TARGET_RESOLUTION_PROVED`
2. `IMAGE_SEALED_IN_HOST`
3. `APPROVAL_RECORDED`
4. `TICKET_COMMITTED`
5. `CAPSULE_EVALUATED`
6. `PAYLOAD_GENERATION_ACTIVE`
7. `OLD_PAYLOAD_DISPOSED`
8. `TEMPORARY_RESOURCES_DISPOSED`
9. `FUNCTIONAL_BEHAVIOR_VERIFIED`（仍需单独行为测试）

报告绑定 imageDigest、真实 Host lifetime、adapter/old/new payload generation、config/target set、实际 loader profile 和失败阶段。日志字符串、UI 成功 toast 或 child stdout 不代替真实对象状态。

预防来自“只能消费 Host 私有 sealed image”的数据流与提交闸门；observer 负责核对实际生命周期结果。hashBefore==hashAfter、receipt 对比和 watcher clean-up 仍是有用证据，但不得被倒置成预防机制。

## 10. 对任意旧模块完整兼容仍缺哪些公共接口

现有 Loader 没有以下能力。下面是**待协商的公共接口需求示意，不是可直接调用的 API**：

```text
prepareExecutable(entryHandle, supportPolicy)
  -> resolved entry/format/dependency graph
  -> no project evaluation
  -> opaque immutable executable handle

replacePrepared(entryHandle, executableHandle, {
  expectedEntryRevision,
  expectedFiberSet,
  exactOwnerScope,
  approvedConfig,
  signal,
  consumePermitAtCommit
})
  -> serialized compare-and-replace
  -> permit checked before first project evaluation
  -> evaluates only prepared bytes with closed resolution
  -> preserves public lifecycle / scope / rollback semantics
```

接口必须解决，而不是仅暴露新字段：

- 与实际 Host importer 一致且不执行项目的模块解析证明；
- ESM/CJS/编译 hook 的固定代码图及不可变消费，动态 code import 要有明确支持或明确拒绝；
- 与所有 entry/config/HMR writer 共享的代际 CAS/事务边界；
- 在正确 context/config/fiber 集合下替换，支持明确的取消与失败语义；
- 不从名字、mutable URL 或可变工作树重新选择模块；
- scope 批量替换有完整集合与加入/退出代际的协调机制；
- 对客户端另需实际 browser delivery 的内容绑定接口，而不只是 server 文件证明。

不改 core/vendor 的约束下，外部候选**可以实现自己拥有的 adapter/capsule 子系统**，但不能把它说成上述通用 Loader 接口已经存在。若用户要求所有旧模块透明适配，这仍是明确的公共接口/上游维护依赖，不能通过 monkeypatch loader.import、读取 Node 私有 loadCache 或写 fiber 私有字段绕过。

## 11. 外部候选补丁与部署顺序

候选变更范围由外部维护方在独立 branch/worktree 制作，本文不直接修改这些位置：

- DSHX：版本化 preparer/worker、输入 image/manifest/check reader、私有协议、支持 profile validator、Host identity/claim/activation lock 集成、受管目标识别和新 receipt。
- 外部 Host 插件：长期 gate、私有 sealed store、一次 ticket/撤销状态机、stable adapter、observer vNext；只使用公共 Cordis/Connection/Loader seams。
- C/审批插件：能力协商、真实 body issuer、官方 once/task/remember UI 关联、模式/lease 复验。九工具 schema 和模型参数快照必须完全相同。
- 外部测试：同一当前 checkout 的 Tools/Approval/Cordis/Loader 源码，不借旧安装库或独立伪 Loader 冒充兼容。

发布阶段必须分离：

1. 候选 prepared：补丁和协议文档就绪，未安装。
2. 候选 verified：隔离 Home 中通过真实管线及攻击性竞态测试。
3. 外部维护部署：备份、精确回滚点、受控安装 gate/adapter/桥接兼容版本；必要重启或自身/控制插件替换仍由外部维护流程决定和执行。
4. 当前 Host 握手：证明一个同 Home Host、确切 build/capability、无旧协议混用，所有旧 pending ticket 失效。
5. 同一真实会话/目标验证：验证 root/scoped producer 来源、真实审批和最终 payload digest，再测试用户行为。

本会话的普通/管理 shell不是外部监督者。不得写当前 `/runtime/tools/dshx`、手动覆盖正在运行的控制源、启动第二个 Host、热替换自己的执行端或把“用户同意设计实现”当成当前具体部署已完成。

## 12. 必须通过的候选验收矩阵

以下全部是待外部候选实现后执行的测试；本文未运行这些场景。

### 12.1 字节与解析

- metadata、declared entry、package exports/main 和真实 runtimeEntry 不同时，image 必须包含真正被编译/消费的那个入口；条件歧义拒绝。
- root/id shadow、alias/dir inode 替换、entry/artifact symlink、case/归一化别名、超预算、未知依赖和动态代码加载拒绝。
- 在 prepare 读源中、编译前后、seal 前后、批准期间、父复验后、child 首读前、commit 后逐点修改工作树。被执行代码只能是已批准 image；不接受仅“最后报 hash 不同”。
- snapshot 缓存文件在 seal 后被替换/删除/修改权限；Host 执行仍取已封存字节或失败关闭，不能加载新文件。
- 构造顶层 side-effect sentinel，证明 SEALED/AWAITING_APPROVAL 状态从未运行项目代码；用户 build hook 不能通过 prepare 偷跑。
- Host loader hooks、重复 Cordis、data/module cache、旧 namespace 复用、不同 payload nonce/profile 都有明确资格测试。

### 12.2 授权、竞争与生命周期

- 默认 pre allow 无重复 AI；外层 deny/ask、monotonic guard 不被体内协议越过。
- never 在 answerer 前拒绝；等待中模式/策略/撤销/代际改变禁止提交；Full access/其他模式不消费新 grant。
- 同名 Definition 替代、相同 callId 重用、伪造 sourceVerified/JSON ticket、跨 Agent/root/Host/target/scope 复用全部失败。
- 两 child 同时消费一个 ticket，仅一次能进入 COMMITTING；崩溃、不明 receipt、迟到答复不能触发第二次执行。
- 真实 root + scoped Creator、多个审批实例、多 standing generations 同时存在；不能因共享 ctx.root 扩大授权。
- 目标 adapter config 更新/移除、scope disposal、服务重载与消费竞争；不得在已失效 context 中启动新 payload。
- old payload dispose 失败/超时、新 namespace 顶层异常、新 apply 失败、cleanup 失败均报告准确阶段，不重试消费；回滚只用保留的已知 callback/image。
- 对未受管 entry 并发配置写入必须拒绝迁移或由真实公共事务机制串行化，不能用 mock 中无人竞争的成功掩盖问题。

### 12.3 兼容与部署

- 九工具名称、数量、schema、模型参数完全不变；旧 executor 缺少能力时先失败，绝不把 PREPARE 当普通 hot-reload 执行。
- 同 PID/Home/root/port/process-start/claim 原规则保留；控制插件、自身、preset 外部升级不得被普通 Creator ticket 覆盖。
- 新版本 image 改变，但正常同目录的稳定 sourceBinding 不变；旧 ticket 不可用于新 image，明确 remembered rule 可为新 image 产生新单次消费记录。
- live working tree digest 与 loaded image digest 分开展示；source edited 不等于 loaded latest；模块活跃不等于功能正确。
- 验证 adapter 迁移后的原 source watcher、冷启动和恢复行为，不隐含一个绕过 gate 的导入路径。

## 13. 交付用语

外部候选在通过上述门槛前，只能称为“设计/候选补丁待验证”。

通过受限 profile 验证后，可以称为：

> 该受管目标在此 Host/代际中消费了一次合法授权，并仅从其批准前已经封存的 image 实例化；工作树在复验后的变化未参与本次代码选择。支持范围、TCB、功能验证和失败阶段另列。

不得称为：

- “所有 DSH 插件都已透明获得精确字节执行保证”；
- “hash 检查前移到 child 就关闭了最终加载竞态”；
- “返回 receipt 相同证明批准之前没有执行”；
- “chmod/read-only 路径就是不可变产物”；
- “root gate 存在就能替换任意 scope 的 fiber”；
- “当前会话已经更新或验证了运行中的 DSHX 执行端”。
