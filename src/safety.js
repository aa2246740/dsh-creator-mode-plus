import { CORE_SOURCE_IMMUTABLE, PLUGIN_ONLY_RULE, creatorCoreMutationReason } from './core-boundary.js'
/** Creator Mode+ claim tracking and last-mile destructive-shell guard. */

const claimedPlugins = new WeakMap()
const PLUGIN_ID = /^[a-z][a-z0-9-]*$/

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function sessionWorkspace(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.startsWith('/') ? cwd.replace(/\/$/, '') : undefined
}

function commandFrom(exec) {
  const args = record(exec?.arguments)
  return typeof args?.command === 'string' ? args.command : undefined
}

function destructiveShell(command) {
  return /(?:^|[;&|()\n]\s*)(?:(?:command|env|sudo)\s+)*(?:(?:\/[\w@.+-]+)+\/)?(?:rm|rmdir|unlink|mv)\b/.test(command)
}

function containsPath(command, path) {
  return command.includes(path)
    || command.includes(JSON.stringify(path))
    || command.includes(`'${path.replaceAll("'", "'\\''")}'`)
}

/** Remember the exact plugin claimed by the current agent object. */
export function rememberCreatorClaim(exec, pluginId) {
  if (exec?.agent && PLUGIN_ID.test(pluginId)) claimedPlugins.set(exec.agent, pluginId)
}

/** Forget a claim after safe removal or preset disposal. */
export function forgetCreatorClaim(exec) {
  if (exec?.agent) claimedPlugins.delete(exec.agent)
}

export function claimedCreatorPlugin(exec) {
  return exec?.agent ? claimedPlugins.get(exec.agent) : undefined
}

/**
 * Deny only plugin-root and active-profile teardown. Normal edits and removal
 * of files inside a plugin remain available through bash.
 */
export function creatorDestructiveCommandReason(exec, explicitPluginId) {
  if (exec?.name !== 'bash') return undefined
  const command = commandFrom(exec)
  if (!command || !destructiveShell(command)) return undefined

  if (/(?:^|[\s'"=])(?:\/Users\/[^/]+\/)?\.dsh\/profiles(?:\/|[\s'";]|$)/.test(command)
    || /\/\.dsh\/profiles(?:\/|[\s'";]|$)/.test(command)) {
    return 'Creator Mode+ blocks direct teardown of the active DSH profile. Use dshx_remove_plugin so the live Host row is removed before its profile dependency.'
  }

  const pluginId = explicitPluginId ?? claimedCreatorPlugin(exec)
  if (!pluginId) return undefined
  const workspace = sessionWorkspace(exec)
  const pluginRoot = workspace ? `${workspace}/${pluginId}` : undefined
  const protectsHarnessLink = command.includes(`/my-plugins/${pluginId}`)
  const protectsWorkspaceRoot = pluginRoot ? containsPath(command, pluginRoot) : false
  const escapedId = pluginId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const removesClaimedRelativeRoot = new RegExp(`(?:^|[\\s'"=;])(?:\\.\\/)?${escapedId}(?:[\\s'";]|$)`).test(command)
  const removesCurrentRoot = workspace?.endsWith(`/${pluginId}`) === true
    && /(?:^|[;&|()\n]\s*)(?:(?:command|env|sudo)\s+)*(?:(?:\/[\w@.+-]+)+\/)?(?:rm|rmdir|unlink|mv)\s+(?:-[^\s]+\s+)*(?:\.|\.\/)(?:[\s;]|$)/.test(command)

  if (protectsHarnessLink || protectsWorkspaceRoot || removesClaimedRelativeRoot || removesCurrentRoot) {
    return `Creator Mode+ blocks direct teardown of claimed plugin ${pluginId}. Use dshx_remove_plugin; it deactivates the live Host first and preserves source.`
  }
  return undefined
}

/** Install the required preset-scoped monotonic guard through public Host APIs. */
export function installCreatorSafetyGuard(ctx, resolveHarness = () => process.env.DSHX_HARNESS) {
  if (typeof ctx?.tools?.guard !== 'function') throw new Error(`${CORE_SOURCE_IMMUTABLE}: public tools.guard is required for Creator Mode+`)
  // Keep the guard installed even while a dependency is unavailable. Only
  // declared, live dependency scopes may read services; agent.ctx has no such
  // declarations. Re-read each service per call so replacement and per-session
  // policy changes are observed without retaining an old service generation.
  function serviceReader(name) {
    let binding
    ctx.inject?.([name], scope => {
      const current = { scope, active: true }
      binding = current
      scope.effect(() => () => {
        current.active = false
        if (binding === current) binding = undefined
      })
    })
    return () => {
      if (!binding?.active) throw new Error(`${name} service is unavailable`)
      binding.scope.fiber.assertActive()
      return binding.scope[name]
    }
  }
  const sandboxPolicy = serviceReader('sandboxPolicy')
  const shell = serviceReader('shell')
  ctx.tools.guard(exec => {
    const destructive = creatorDestructiveCommandReason(exec)
    if (destructive) return destructive
    if (!['write', 'edit', 'write_file', 'edit_file', 'delete_file', 'move_file', 'copy_file', 'apply_patch', 'bash', 'terminal_open', 'terminal_send'].includes(exec?.name)) return undefined
    try {
      const root = resolveHarness()
      if (!root) return `${CORE_SOURCE_IMMUTABLE}: cannot identify the Harness before a write operation`
      let policy
      if (['bash', 'terminal_open', 'terminal_send'].includes(exec.name)) {
        try {
          policy = sandboxPolicy().resolve(exec.agent ? { session: exec.agent.session } : {})
          if (policy && exec.name === 'bash') policy = { ...policy, shellConfined: shell().sandboxMode !== undefined }
        } catch (error) {
          policy = { unavailableReason: error instanceof Error ? error.message : String(error) }
        }
      }
      return creatorCoreMutationReason(exec, root, policy)
    } catch (error) {
      return `${CORE_SOURCE_IMMUTABLE}: cannot validate write boundary: ${error.message}`
    }
  })
  ctx.inject?.(['systemPrompt'], scope => {
    scope.systemPrompt.section({ name: 'creator:plugin-only', order: 1000, text: PLUGIN_ONLY_RULE })
  })
}
