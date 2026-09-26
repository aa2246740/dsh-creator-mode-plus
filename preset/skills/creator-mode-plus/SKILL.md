---
name: creator-mode-plus
description: Develop and deliver DSH plugins from a Creator+ conversation. Use for new plugins, existing-plugin changes, activation, functional verification, removal, recovery, or required Harness upgrades.
---

# Creator Mode+

## 不可跨越：只开发插件，不改 DSH 源码

DSHX 与 Creator Mode+ 只用于独立外部插件。官方 Harness 源码、内置插件、内置预设、官方包及其构建产物均为只读；本机工作树、临时副本、Git worktree、node_modules 链接和安装目录遵守同一规则。

禁止为插件补 Host 接口、改核心实现、替换官方文件、应用 Host 源码补丁，或让插件构建重新编译官方子项目。需要“先改 Host 才能完成”的方案不成立：先找公开扩展点，在插件内实现；接口确实缺失时报告具体能力缺口，并完成其余插件工作。不要把核心修改包装成兼容修复、临时验收或交付前提。

插件开发授权、用户确认接管、自动审批、交接包中的“必要时补 Host”、`--force` 都不能解除此规则。外部监督者同样受约束。不要为此请求一次性豁免。用户自己的 profile 的 watched `cordis.patch.yml` 是配置扩展，与修改官方源码的 `.patch` 完全不同；插件包、插件自己的构建目录、用户预设和正式插件安装配置仍可按已授权流程操作。

看到 `CORE_SOURCE_IMMUTABLE` 就调整插件方案；不得换 shell、脚本、路径、复制目录或其他 Agent 绕过。只能读取官方实现和公开 API，所有插件构建输出都留在插件目录。


Complete the requested plugin in the user's DSH conversation: build, activate on
the current Host, then exercise its behavior. Use the DSHX v0.7 fixed bridge and
public Cordis/client extension points. Tie evidence to the claimed source and
each changed runtime surface.

## Deliver a plugin

1. **Identify the runtime.** Call `dshx_status`. Continue when the bridge reports
   its supported contract and one identified current Host. Use that Host; its
   process keeps the conversation alive. On resume, continue the recorded pending
   delivery. Status alone is inventory.
2. **Claim the source.** Call `dshx_claim_plugin` before edits. For a new plugin,
   immediately call `dshx_scaffold` and edit its returned workspace path; the tool
   creates any Harness link. For an existing plugin, read
   [Existing-plugin trials](existing-plugin-trials.md). Completion: one identified
   source and an accepted claim.
3. **Implement and build.** Read `dshx kb cat contracts/client-build` for a client,
   or the selected extension-point contract for a server. Run the project's build
   and relevant tests, then `dshx_check`. Repair package-local build failures
   through the existing-plugin guide. An old artifact passing static check cannot
   replace a successful build. A fresh `new-client` needs its built handoff before
   activation planning.
4. **Plan each changed surface.** Read `dshx kb cat contracts/live-activation`,
   then call `dshx_activation_plan`. A fresh `new-client` plans only after
   `dshx_check` exits `0`. Mixed client/server changes need both branches; finish
   the client branch, then the server branch, retaining evidence for each.
5. **Activate within the request.** Record the concrete change, impact and rollback
   point in the delivery evidence. A request to repair and install, try, mount or make it work already
   authorizes that delivery within its scope. Continue after routine preparation.
   Request actual missing filesystem access through the normal tool; a claim
   establishes ownership, not additional filesystem permission.

   | Changed surface | Next action | Activation evidence |
   |---|---|---|
   | Existing `server` | After build/check, call `dshx_hot_reload` for the ID | Same-PID replacement and temporary-resource cleanup |
   | Existing `client` | Rebuild its already-rostered client | Same-page HMR and changed behavior |
   | `new-client` | `dshx_activate_new_client`, then reload/reopen the page | `HOST_TREE_ACTIVE`, `CLIENT_MANIFEST_PRESENT`, then actual page load |
   | User `preset` | Follow the preset playbook; verify a new/blank session | Requested tools and behavior are present |
   | `patch` or `artifact` | Follow that branch's playbook | Its specified proof; artifact sync alone is not activation |
   | Boot-captured `manifest` | Read [Maintenance](maintenance.md#harness-and-launcher-maintenance) | External activation and feature verification |

   For a multi-file server, declare the runtime entry and changed helpers in
   `dshx.yml` under `hotReload.artifacts` before check. Require hashes for the
   complete set and behavior that uses those helpers.
6. **Exercise the feature.** Use an available, authorized, authenticated UI, or
   the plugin's actual command/tool/service when that is the requested behavior.
   Test a client change in the real page. `dshx_browser_open` is an optional
   authentication entry, not a prerequisite for development or activation.
   On access failure read [Verification and recovery](verification-recovery.md).
   An explicit live user result establishes only the behavior the user observed.
7. **Report the result.** Tell the user whether the plugin is complete, which
   requested features work, and where to use them. If unfinished, name the
   remaining work and any action needed from the user. Keep lifecycle receipts
   and process diagnostics in internal evidence; explain those details only when
   the user asks or needs them to act. Once the requested behavior works, finish.

## Follow the next action

Read `outcome` and `delivery.nextAction` before interpreting a raw command code.

| Result | Continue with |
|---|---|
| `HOT_RELOAD_READY` or an actionable server plan | The named `dshx_hot_reload` call, then feature verification |
| Older `ACTIVATION_DECISION_REQUIRED` plus server `hostRestart: not-decided` | Build/check, then bounded hot reload when module-HMR evidence is the only missing item |
| `BLOCKED` with `scope: browser` | Independent build/check/activation; retain the exact UI-verification gap |
| Authentication, source, claim, composition or Host-identity error | Repair that prerequisite and continue work independent of it |
| Failed hot reload or Guardian incident | [Repair the activation failure](verification-recovery.md#activation-failure) before retrying |

`not-decided` means evidence is needed, not that a restart is required. Bounded
hot reload obtains it through its own gates. Older DSHX may return exit code 1
for this evidence-only plan; unrelated errors still block the dependent operation.
A missing browser adapter affects browser verification only when the current
Host proofs required for activation are valid.

## Boundaries and other branches

- Use fixed tools for plugin lifecycle operations and normal file tools inside
  the claimed source. Host process control stays with its external launcher;
  managed-shell markers and profile authentication remain intact.
- Root Loader module replacement does not prove preset-private bridge replacement.
  Creator+/DSHX self-upgrades use [Maintenance](maintenance.md#creator-self-upgrade).
- For whole-plugin removal, read [Safe removal](maintenance.md#safe-removal).
- For a genuine Harness API/version requirement, read
  [Harness maintenance](maintenance.md#harness-and-launcher-maintenance).
  Ordinary plugin updates use the activation table above.
- Retain only observed layers as internal evidence: `SOURCE_BUILT`, `ARTIFACT_SYNCED`,
  `HOST_TREE_ACTIVE`, `CLIENT_MANIFEST_PRESENT`, `CLIENT_LOADED`,
  `VISUAL_BEHAVIOR_VERIFIED`. A module receipt or HTTP 200 is not feature acceptance.

## 认领冲突直接申请接管

如果 `dshx_claim_plugin` 或自动认领提示已有持有者，在当前对话调用 `dshx_request_takeover({name})`，让用户在原生选项卡里确认。工具自己查找实际持有者并负责停止、等待和转移。不要让用户先找旧对话，不要建议等 24 小时，不要手删认领或 session.lock。

只能传插件 ID。不要传 `force`、`userApproved`、会话 ID、路径或令牌，也不要把聊天里的同意或自动审批结果冒充 UI 确认。取消、认领变化、停止失败时依照工具错误处理；成功后继续 check → 对应激活 → 行为验证。旧会话收到 `CREATOR_OWNERSHIP_REVOKED` 时停止开发；重新接手也要走同一个确认入口。
