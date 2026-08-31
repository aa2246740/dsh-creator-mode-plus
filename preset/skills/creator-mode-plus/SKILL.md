---
name: creator-mode-plus
description: Use for DSH WebUI plugin creation, deletion or safe removal, DSHX v0.7 projects, client components, activation, hot reload, Harness update requests, concurrent Creator+ sessions, Guardian recovery, refresh or restart decisions, and Creator Mode+ delivery.
---

# Creator Mode+

Build file-backed plugins for the official DeepSeek Harness browser WebUI through the complete stable DSHX v0.7 contract. Public Cordis plugin forms, the public client runtime, and public UI slots are supported. App-shell IPC, native window controls, desktop bridges, and wrapper-specific refresh behavior are outside this compatibility target. Creator Bridge v2 exposes seven fixed model tools, including source-preserving safe removal; the v0.7 Harness Update Assistant stays externally supervised.

## Workflow

1. Session-start automatically arms the external Guardian. Call `dshx_status`; completion means exit code `0`, one Harness checkout, stable DSHX `>=0.7.3 <0.8.0`, contract `dshx-v0.7/creator-bridge-v2`, and bridge version `2`. The bridge must report Creator claims, workspace scaffold, bounded new-client activation, safe watched-plugin removal, safe profile-bundle removal handoff, proactive plugin-integrity quarantine, Guardian, same-PID activation matrix, and Harness Update Assistant capabilities. Status is inventory, not activation proof.
2. As soon as the plugin id is known, call `dshx_claim_plugin` before editing. Different sessions may claim different plugins concurrently; the same plugin has one owner. A nonzero conflict stops the branch.
3. For a new project, call `dshx_scaffold` immediately after the claim. It creates source under the calling session's trusted writable workspace and, when that workspace is outside the Harness checkout, creates the required `my-plugins/<name>` link itself. Use the returned source path for every edit. Never create a substitute project or ask the user to add a symlink. Existing projects skip this step.
4. Classify the change as exactly one of `patch`, `manifest`, `preset`, `client`, `new-client`, `server`, or `artifact`. A new browser UI plugin is normally `new-client`. Before broad repository exploration, use the read-only DSHX knowledge bundle for the selected seam. A client starts with `dshx kb cat contracts/client-build` and `dshx kb cat maps/extension-points`; an update request starts with `dshx kb cat contracts/harness-update`. Follow an official source pointer only when the contract lacks the needed detail.
5. Edit only the scaffolded/claimed project and user-owned preset files. Add focused tests and build, then call `dshx_check`. For an RC8/RC2 client package, keep the generated DSHX `externalClientBundle`; it owns lazy-CJS, shared modules, CSS and HMR. Declare every direct `ctx.<service>` read in the client entry's Cordis `export const inject`; package metadata `dsh.client.inject` is unrelated. Completion: `exitCode` is `0`, including `client-cordis-inject`, and a client has a built lazy-CJS `lib/client.js`. This proves only `SOURCE_BUILT`. A fresh `new-client` must reach this point before activation planning, because the plan validates that built handoff.
6. Call `dshx_activation_plan` for the classified branch. For a fresh `new-client`, call it only after `dshx_check` exits `0`; for an existing build-ready target it may run before editing. Do not begin live mutation until the selected plan returns exit code `0`. Completion: the required new session, Host restart, and browser reload are explicit.
7. Before live mutation, show the source diff, selected lifecycle branch, impact, and rollback point. Completion: the user has approved that concrete mutation, or the current request already explicitly asks to activate or mount it.
8. Execute only the selected branch:
   - `new-client`: call `dshx_activate_new_client` with only the plugin id. Completion: exit code `0` plus `HOST_TREE_ACTIVE` and `CLIENT_MANIFEST_PRESENT`. The bridge installs and resolves the profile link before touching the watched patch. It performs no Host restart or browser reload.
   - `client`: rebuild the already-rostered client and observe same-page HMR.
   - `preset`: write only a user preset and verify it in a new or blank session.
   - `manifest` or `server`: hand off the required restart to the external supervisor.
   - `patch` or `artifact`: follow the plan literally; neither alone proves browser activation.
9. After successful `new-client`, browser testing remains a task-time Agent or user-prompt decision; Creator Mode+ does not require a particular browser tool. Completion can include `CLIENT_LOADED` or `VISUAL_BEHAVIOR_VERIFIED` only after direct browser observation or an explicit live user report. A user report that the requested behavior works ends speculative diagnosis and further mutation.
10. Report only observed layers: `SOURCE_BUILT`, `ARTIFACT_SYNCED`, `NEXT_BOOT_REGISTERED`, `PRESET_ROSTER_VISIBLE`, `PRESET_SESSION_ACTIVE`, `HOST_TREE_ACTIVE`, `CLIENT_MANIFEST_PRESENT`, `CLIENT_LOADED`, `VISUAL_BEHAVIOR_VERIFIED`.

## Safe removal

When the user asks to remove, uninstall, or delete a whole plugin, call `dshx_remove_plugin` with only its claimed plugin id. Do not use bash, `rm`, `unlink`, `mv`, package-manager commands, or manual edits to the Web profile, Harness `my-plugins`, or the plugin root.

Completion requires exit code `0`, `HOST_TREE_INACTIVE`, and `PROFILE_DEPENDENCY_REMOVED`. The tool removes or disables the watched row first, proves absence in the same Host PID, uses the official profile remover while its dependency exists, proves dependency/link absence, and detaches only target-verified plugin-owned symlinks. RC8 may remove the dependency while leaving its `node_modules` symlink: `detached-orphan-symlink` means DSHX proved the residual entry was a symlink targeting this claim's Harness/source path before unlinking it. A directory or outside target fails closed. A partial attempt resumes from durable quarantine without rerunning package removal for an already-absent dependency. The source directory remains preserved; `SOURCE_PRESERVED` is reported only when observed. This operation never restarts DSH or controls the browser.

This fixed tool owns only watched-row plugins. If it reports boot-captured bundle evidence or no bounded watched row, stop the Creator branch and hand the operation to the external supervisor command `dshx plugin remove <package> --profile web --port <current-port>`. That command proves same-PID Loader absence before official profile removal and may retain one temporary disable until a later normal App boot. Creator Mode+ never runs that external command through bash or adds an eighth tool.

Deleting or renaming an ordinary file/component inside the claimed source remains normal editing. The protected boundary is teardown of the claimed plugin root or its DSH/Harness registration. If raw teardown is denied, do not retry through another shell or script; call `dshx_remove_plugin`. If Guardian reports `plugin-integrity-failed`, the registration has already been quarantined before cold boot: inspect preserved source and incident evidence, then use the fixed tool or repair the plugin.

## Harness update requests

DSHX v0.7 adds `update plan → prepare → verify → apply` plus exact `rollback`, but these do not become Creator bridge tools.

1. Call `dshx_status` and fail closed unless it reports the exact v0.7 contract and one Harness checkout.
2. Read `contracts/harness-update`. The inherited managed shell may run only read-only `dshx update plan` against that resolved checkout. DSHX's CLI gate permits this one update subcommand and rejects the mutating stages.
3. Report plan output as inventory only: target tag/SHA, current branch/SHA, dirty state, and plugin matrix. It does not prove the target builds or any plugin works.
4. Hand `update prepare`, `update verify`, `update apply`, and `update rollback` to the external DSHX supervisor. Never unset `DSH_SHELL`, spawn a replacement Host, or turn a fixed tool into a generic update runner.
5. Keep the state labels separate: `candidate prepared`, `candidate verified`, `applied locally`, `real runtime accepted`, and `production activated`. The update assistant never silently restarts production.

## Stop condition

A nonzero DSHX exit code stops that branch. Quote the named blocker and preserve the rollback point. A retry is allowed only when the blocker identifies a retryable condition. A cached pre-install resolution scar is handed to the external supervisor for one controlled restart; this session does not restart its own Host.

If a fixed tool throws `refusing an operation outside bridge v2` before returning a structured result, report a Creator Bridge integrity defect with the exact tool and error, then stop. Preserve the claimed plugin and its source location. Do not reinterpret this error as a supervisor or permission decision, continue through a raw shell, create the project elsewhere, edit profile files manually, or claim that a later lifecycle step succeeded. Resume only after the bridge is upgraded and the same fixed tool succeeds.

If a `[Creator+ Guardian incident ...]` steering message arrives, it takes priority.
Inspect its confidence, plugin, rollback, and log excerpt; repair the preserved
source and rerun `dshx_check` before retrying the original activation. Do not
undo quarantine and repeat unchanged bytes.

## Invariants

- The external DSHX supervisor owns process restart and rollback.
- The inherited bash tool is not an external supervisor. Raw mutating `dshx` commands from a DSH-managed shell are rejected by DSHX v0.7; read-only `update plan` is the sole Harness-update exception. Use only the seven fixed tools for plugin mutation and never unset managed DSH environment markers to bypass that boundary.
- A matching `0.7.x` string is insufficient if Creator, watched-plugin removal, safe profile-bundle removal, proactive integrity quarantine, Guardian, activation, managed-shell, Update Assistant, or their knowledge contract is missing. The bridge and installer fail before mutation on incomplete surfaces.
- Guardian is armed for every Creator+ session and may perform one deterministic recovery outside DSH; a second failure inside 30 seconds opens the fuse.
- Normal launcher exit disarms Guardian. The fixed browser sentry may recover an official Loader `FAILED` entry only after DSHX uniquely attributes and quarantines it; component render exceptions, visual defects, and functional defects remain outside automatic recovery.
- While the Host remains healthy, Guardian quarantines a claimed watched client whose profile link or source package disappears. This prevents a later cold boot from consuming the stale row; it does not delete source or restart the Host.
- `dshx_activate_new_client` is the only live new-client mutation. Its model input is one validated plugin id, never a path, argv vector, port, profile, or shell string.
- `dshx_remove_plugin` is the only whole-plugin teardown operation. It is source-preserving and accepts one validated plugin id, never a path or deletion command.
- Profile manifest and watched patch rows are not edited as separate manual steps.
- `ARTIFACT_SYNCED` remains `LIVE_ACTIVATION_UNPROVEN` until Host and browser evidence exist.
- A failed, interrupted, or waiting turn is not a completed AI answer.
- Client overlays remain click-through, honor `prefers-reduced-motion`, and do not depend on an App shell.
