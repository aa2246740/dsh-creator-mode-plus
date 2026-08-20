---
name: creator-mode-plus
description: Use for DSH WebUI plugin creation, dshx projects, client components, activation, hot reload, refresh or restart decisions, and Creator Mode+ delivery.
---

# Creator Mode+

Build file-backed plugins for the official DeepSeek Harness browser WebUI. Public Cordis plugin forms, the public client runtime, and public UI slots are supported. App-shell IPC, native window controls, desktop bridges, and wrapper-specific refresh behavior are outside this compatibility target.

## Workflow

1. Call `dshx_status`. Completion: it returns exit code `0`, one Harness checkout, a compatible DSHX version, and bridge version `1`. Status is inventory, not activation proof.
2. Classify the change as exactly one of `patch`, `manifest`, `preset`, `client`, `new-client`, `server`, or `artifact`; call `dshx_activation_plan`. Completion: the required new session, Host restart, and browser reload are explicit before implementation.
3. Keep source under `my-plugins/<name>/`. Use `dshx_scaffold` for a new project. Edit only that project and user-owned preset files. Completion: no shipped DSH preset or Harness core file changed.
4. Add focused tests and build, then call `dshx_check`. For an RC8 client package, use the generated DSHX `externalClientBundle`. Declare every direct `ctx.<service>` read in the client entry's Cordis `export const inject`; package metadata `dsh.client.inject` is unrelated. Completion: `exitCode` is `0`, including `client-cordis-inject`, and a client has a built lazy-CJS `lib/client.js`. This proves only `SOURCE_BUILT`.
5. Before live mutation, show the source diff, selected lifecycle branch, impact, and rollback point. Completion: the user has approved that concrete mutation, or the current request already explicitly asks to activate or mount it.
6. Execute only the selected branch:
   - `new-client`: call `dshx_activate_new_client` with only the plugin id. Completion: exit code `0` plus `HOST_TREE_ACTIVE` and `CLIENT_MANIFEST_PRESENT`. The bridge installs and resolves the profile link before touching the watched patch. It performs no Host restart or browser reload.
   - `client`: rebuild the already-rostered client and observe same-page HMR.
   - `preset`: write only a user preset and verify it in a new or blank session.
   - `manifest` or `server`: hand off the required restart to the external supervisor.
   - `patch` or `artifact`: follow the plan literally; neither alone proves browser activation.
7. After successful `new-client`, reload or reopen the official WebUI only when the user authorized that interaction. Completion: the new page loads the package id and its real behavior works. Until then, report “registered,” not “usable” or “complete.”
8. Report only observed layers: `SOURCE_BUILT`, `ARTIFACT_SYNCED`, `NEXT_BOOT_REGISTERED`, `HOST_TREE_ACTIVE`, `CLIENT_MANIFEST_PRESENT`, `CLIENT_LOADED`, `VISUAL_BEHAVIOR_VERIFIED`.

## Stop condition

A nonzero DSHX exit code stops that branch. Quote the named blocker and preserve the rollback point. A retry is allowed only when the blocker identifies a retryable condition. A cached pre-install resolution scar is handed to the external supervisor for one controlled restart; this session does not restart its own Host.

## Invariants

- The external DSHX supervisor owns process restart and rollback.
- `dshx_activate_new_client` is the only live new-client mutation. Its model input is one validated plugin id, never a path, argv vector, port, profile, or shell string.
- Profile manifest and watched patch rows are not edited as separate manual steps.
- `ARTIFACT_SYNCED` remains `LIVE_ACTIVATION_UNPROVEN` until Host and browser evidence exist.
- A failed, interrupted, or waiting turn is not a completed AI answer.
- Client overlays remain click-through, honor `prefers-reduced-motion`, and do not depend on an App shell.
