# Maintenance

## Safe removal

Claim the plugin, then call `dshx_remove_plugin`. It quarantines/removes the watched
Host row, proves same-PID absence, invokes the official profile remover and
detaches verified plugin-owned symlinks. Completion: `HOST_TREE_INACTIVE` and
`PROFILE_DEPENDENCY_REMOVED`; report `SOURCE_PRESERVED` when observed. Component
cleanup stays ordinary editing; whole-plugin teardown uses this operation.

Partial removal resumes durable quarantine. `detached-orphan-symlink` means both
dependency absence and the exact symlink target were verified. Avoid repeating a
completed package-removal stage. Boot-captured bundles use external
`dshx plugin remove`: prepare the exact package, current Host and rollback
information. Its disable marker remains until a later clean boot is proved;
marker cleanup alone does not justify a restart.

## Harness and launcher maintenance

Establish the specific missing Harness API/version or boot-captured change first.
Ordinary client/server updates follow the main activation table.

Read `dshx kb cat contracts/plugin-only` and `contracts/harness-update`.
Only `update plan` remains available. Source-changing stages are disabled: `prepare`, `verify`, `apply` and `rollback` may not be run
by the external DSHX supervisor either. Preserve the API/version gap and current
plugin source. Use a public plugin extension or report the unsupported feature;
never make a Host patch or official-package rebuild part of plugin delivery.

A launcher restart requires exact boot/recovery evidence and scope authorization.
`facts.handoff` identifies the original launcher; it is not authorization. Existing
installation authorization persists within its scope. Present any new scope or
required approval with the prepared, reviewable candidate. Keep raw process
commands and credentials outside model inputs.

## Creator self-upgrade

Root-scope `dshx_hot_reload` cannot replace the Creator+/DSHX code executing it.
An external supervisor reads `playbooks/restart-server-plugin`, verifies the full
artifact set and selects explicit `preset` scope for a private-only module, or
`mixed` scope when the same module also has one root mount. Both replace the
complete affected instance set; verify an existing session afterward.
Preserve unchanged `agent.cordis.yml` bytes and their exact filesystem stamp.
