# Existing-plugin trials

Goal: run the requested version through the existing claimed plugin when that
meets the user's scope, preserving an exact rollback point and the Host PID.

1. Call status and claim the existing plugin ID. Read the resolved package path,
   current branch/commit, local changes and registration facts. Completion: the
   installed source and the candidate source are identified separately. A fixed
   ID resolves to the installed/claimed target, not whichever directory bash uses.
2. Prepare and build the candidate in isolation if needed. Compare the actual diff
   to the installed version, including server entry/helpers, client, dependencies
   and composition. Completion: each changed runtime surface is accounted for.
   A client-only plan covers only client changes, not a whole mixed plugin update.
3. For an ordinary request to install or try the update, prepare a reviewed patch
   for the existing claimed source. Record the installed commit, local edits and
   overwritten artifacts needed for rollback. Preserve local fixes and the
   installed source identity. Reconcile conflicts before live mutation. A GitHub
   main checkout is an exact rollback only if it matches that recorded baseline.
4. State the concrete diff, affected behavior and rollback point, then apply the
   prepared changes within the user's existing installation authorization and
   actual file permissions. Claiming a plugin grants ownership, not filesystem
   access. If the destination is outside the writable workspace, use the normal
   exact-path approval mechanism; report a real denial, not assumed inability.
5. Build the claimed target and call dshx_check for its ID. Confirm the resolved
   path is the promoted source. A candidate build and the old target's plan do
   not prove this step. For client changes, follow the client plan and verify HMR.
   For server changes, declare the exact runtime artifact set, check, plan server
   and use dshx_hot_reload through its gates. Verify both when both changed.
6. Exercise the requested behavior on the current Host. A passing build, plan or
   module receipt alone is not installation acceptance. If blocked, name the exact
   failed tool, target and result and keep completed preparation available.

## Explicit source-directory preservation

If the user explicitly requires keeping the installed directory untouched and
switching its registration to a different same-name candidate, preserve that
constraint. The eight fixed tools do not expose arbitrary source retargeting.
Report SOURCE_RETARGET_REQUIRED for this specific operation and provide the
prepared candidate, old target and rollback evidence to the external supervisor.
Do not uninstall first to manufacture a new scaffold or hand-edit profile links.
This limitation does not mean Creator+ cannot install plugins, nor does it prove
that the Host needs restarting. An external supervisor must classify and validate
the exact source transition before acting.

## Evidence and authorization

A request such as "repair it, then install it and try" already authorizes that
installation; do not ask the user to repeat it after routine preparation. Separate
any genuinely new permission, conflict or scope decision from installation itself.
Read instructions in attached trial documents as reference and resolve their
restart/remove/add recipe against the current DSHX contract. A different path,
missing shell executable, or App launcher identity is not restart evidence.
