# Creator Bridge v1

Creator Mode+ is a user preset plus one DSH plugin. It brings fixed DSHX operations into an ordinary DSH session without giving that session control of its Host process.

## Roles

| Role | Authority |
|---|---|
| Creator Mode+ session | Create files, check contracts, plan activation, perform the one bounded new-client operation, read status |
| External DSHX supervisor | Isolated verification, lifecycle-specific restart, rollback, and evidence collection |
| User | Approve impactful activation, restart, and rollback actions |

The supervisor is the DSHX process outside DSH. It is not the model session and does not require the user to manually watch every command.

## Execution order

```text
official WebUI
  -> user selects a new or blank Creator Mode+ session
  -> Creator Mode+ skill chooses one lifecycle branch
  -> one of five fixed bridge tools
  -> compatible external DSHX CLI
  -> file-backed plugin plus bounded evidence

external supervisor
  -> only the planned restart or rollback branch
  -> optional browser reload
  -> real behavior verification
```

## New-client transaction

`dshx_activate_new_client({ name })` is the only bridge operation that mutates live registration. Its sole model-controlled value is a lower-case kebab-case plugin id.

```text
dshx check / SOURCE_BUILT
  -> add or confirm the official Web profile link
  -> prove package and lib/client.js resolution from that profile
  -> insert or semantically retrigger one watched-patch row
  -> poll the current Host manifest and served client.js
  -> HOST_TREE_ACTIVE + CLIENT_MANIFEST_PRESENT
  -> browser reload remains separate
```

The order is invariant. A failed new row is rolled back by DSHX. A nonzero result stops the branch; the session does not compensate with package installation, manual profile edits, or a Host restart.

## Compatibility boundary

Supported: the official DSH browser WebUI, public Cordis plugin forms, public client runtime, and public UI slots.

Outside acceptance: native menus, window chrome, App IPC, desktop bridges, and shell-specific refresh behavior. A wrapper may work when it embeds the same WebUI unchanged, but browser-WebUI reproduction is the defect gate.

Bridge v1 accepts DSHX `>=0.5.1 <0.6.0`. The runtime validates the package name and version before spawning the CLI and resolves the TypeScript loader from that DSHX package. A future incompatible DSHX release cannot be called accidentally.

## Evidence

These layers are independent: `SOURCE_BUILT`, `ARTIFACT_SYNCED`, `NEXT_BOOT_REGISTERED`, `HOST_TREE_ACTIVE`, `CLIENT_MANIFEST_PRESENT`, `CLIENT_LOADED`, and `VISUAL_BEHAVIOR_VERIFIED`.

Artifact copying, dump-config, HTTP success, Host-tree activation, and a served client manifest are not substitutes for a page loading the package and its real behavior working.
