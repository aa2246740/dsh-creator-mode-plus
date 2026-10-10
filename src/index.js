import { createDesktopProfileBridge } from './desktop-profile.js'
import { installTakeoverFence, requestTakeover } from './takeover.js'
/** Creator Mode+ model tools backed by fixed dshx operations. */

import {
  currentWebPort,
  installCreatorRecovery,
  runClaimedDshx,
  runClientFailureDshx,
  runDshx,
  resolveHarnessRoot,
} from './runner.js'
import { healCreatorPlusPresets } from './preset-015.js'
import { createDevelopmentExecutionAuthority } from './development-execution.js'
import { createDevelopmentTaskTracker } from './development-tasks.js'
import { createDevelopmentPolicyTracker } from './development-policy.js'
import { createDevelopmentInvocations } from './development-invocation.js'
import {
  forgetCreatorClaim,
  installCreatorSafetyGuard,
  rememberCreatorClaim,
} from './safety.js'

export {
  CREATOR_BRIDGE_VERSION,
  CREATOR_MODEL_TOOLS,
  DSHX_CONTRACT,
} from './compatibility.js'

export const name = 'dsh-creator-mode-plus'
export const inject = ['tools', 'webServer', 'connection', 'agents', 'sessions', 'userQuestions', 'profileContext']

const CLIENT_FAILURE_PATH = '/dsh-creator-mode-plus/client-failure'
const MAX_CLIENT_FAILURE_BYTES = 16 * 1024
const CLIENT_FAILURE_ROUTE_REGISTRY = Symbol.for('dsh-creator-mode-plus.client-failure-routes.v1')

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/
const KINDS = new Set(['function', 'tool', 'client', 'object', 'class'])
const CHANGES = new Set(['patch', 'manifest', 'preset', 'client', 'new-client', 'server', 'artifact'])
const HOT_RELOAD_INFRASTRUCTURE = new Set(['dsh-creator-mode-plus', 'dsh-external-plugin-devkit'])

function pluginId(value) {
  if (!PLUGIN_ID.test(value)) throw new Error('plugin name must be lower-case kebab-case')
  return value
}

function choice(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`${label} is not supported: ${value}`)
  return value
}

const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function isSameOrigin(req, options, port) {
  // Electron checks dsh-app origin, then forwards an authenticated request
  // without Origin. Require a script-only marker and the owned loopback route.
  if (options.hostProfile === 'desktop' && req.headers.origin === undefined
    && req.headers['x-dsh-creator-client'] === '1'
    && req.headers['content-type'] === 'application/json'
    && req.headers.host === `127.0.0.1:${port}`
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return true
  const origin = req.headers.origin
  const authority = req.headers.host
  if (typeof origin !== 'string' || typeof authority !== 'string') return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === authority
  } catch {
    return false
  }
}

async function readBoundedJson(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > MAX_CLIENT_FAILURE_BYTES) {
      const error = new Error('client failure report is too large')
      error.statusCode = 413
      throw error
    }
    chunks.push(buffer)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid client failure report')
  return value
}

function clientFailureRouteRegistry() {
  if (globalThis[CLIENT_FAILURE_ROUTE_REGISTRY] === undefined) {
    Object.defineProperty(globalThis, CLIENT_FAILURE_ROUTE_REGISTRY, {
      value: new WeakMap(),
      enumerable: false,
      configurable: false,
      writable: false,
    })
  }
  return globalThis[CLIENT_FAILURE_ROUTE_REGISTRY]
}

function clientFailureHandler(webServer, options) {
  return async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' })
        res.end()
        return
      }
      if (!isSameOrigin(req, options, webServer.port)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      try {
        const input = await readBoundedJson(req)
        const result = await (options.runClientFailureDshx ?? runClientFailureDshx)({
          failedIds: input.failedIds,
          message: input.message,
          hostPid: process.pid,
          hostParentPid: process.ppid,
          hostPort: webServer.port,
        }, options)
        if (result.exitCode !== 0) {
          res.writeHead(503, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ reload: false, error: result.stderr || result.stdout || 'recovery failed' }))
          return
        }
        const decoded = JSON.parse(result.stdout || '{}')
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({
          reload: decoded?.data?.reload === true,
          incident: decoded?.data?.incident,
        }))
      } catch (error) {
        const status = Number.isInteger(error?.statusCode) ? error.statusCode : 400
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ reload: false, error: error instanceof Error ? error.message : String(error) }))
      }
    }
}

function acquireClientFailureRoute(hostKey, webServer, handler) {
  const registry = clientFailureRouteRegistry()
  let broker = registry.get(hostKey)
  const lease = { handler }
  if (broker === undefined) {
    broker = { port: webServer.port, leases: new Set([lease]), current: lease, dispose: undefined }
    broker.dispose = webServer.register({
      kind: 'exact',
      path: CLIENT_FAILURE_PATH,
      handler: (req, res) => broker.current.handler(req, res),
    })
    registry.set(hostKey, broker)
  } else {
    if (broker.port !== webServer.port) throw new Error('Creator+ Web Host changed while route leases remain active')
    broker.leases.add(lease)
    broker.current = lease
  }

  return () => {
    if (!broker.leases.delete(lease)) return
    if (broker.leases.size === 0) {
      broker.dispose()
      if (registry.get(hostKey) === broker) registry.delete(hostKey)
      return
    }
    if (broker.current !== lease) return
    for (const remaining of broker.leases) broker.current = remaining
  }
}

/** Register one generation-safe same-origin browser sentry route per Web Host. */
export function installClientFailureRoute(ctx, options = {}) {
  const webServer = ctx.webServer
  // Cordis returns scope-bound service proxies; their object identity is not a
  // Host identity. The public root Context is shared by all preset generations.
  // Raw-service fixtures without a Context retain their original identity.
  const hostKey = ctx.root ?? webServer
  ctx.effect(
    () => acquireClientFailureRoute(hostKey, webServer, clientFailureHandler(webServer, options)),
    'Creator Mode+ browser failure route',
  )
}

/** Register file-backed Creator Mode+ operations for one preset scope. */
export function apply(ctx, config = {}) {
  console.log('[dsh-creator-mode-plus] loaded')
  try {
    const healed = healCreatorPlusPresets()
    if (healed.length > 0) {
      ctx.logger?.info?.(`dsh-creator-mode-plus: migrated 0.1.5 persona in ${healed.join(', ')}`)
    }
  } catch (error) {
    ctx.logger?.warn?.(`dsh-creator-mode-plus: persona heal failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const authOptions = { ...createDesktopProfileBridge(ctx), getWebStartupUrl: port => typeof ctx.connection.authenticatedUrl === 'function' ? ctx.connection.authenticatedUrl(`http://127.0.0.1:${port}/`) : undefined }
  installCreatorRecovery(ctx, authOptions)
  installClientFailureRoute(ctx, authOptions)
  installCreatorSafetyGuard(ctx, () => resolveHarnessRoot())
  installTakeoverFence(ctx)

  // The sealed executor is a separate, undeployed integration. Enable it only
  // in an explicitly configured development preset; ordinary Creator sessions
  // keep the reviewed fixed bridge and the Host's existing approval stack.
  const developmentExecution = config.developmentExecution === true
  const ownedDefinitions = new Map()
  const tasks = developmentExecution ? createDevelopmentTaskTracker(ctx) : undefined
  const policy = developmentExecution ? createDevelopmentPolicyTracker(ctx) : undefined
  let authority, invocations
  const registerOwned = definition => {
    ownedDefinitions.set(definition.name, definition)
    return ctx.tools.register(definition)
  }

  ctx.tools.register({
    name: 'dshx_claim_plugin',
    description: 'Claim one plugin for this Creator+ session and arm the external Guardian before editing. Different sessions may claim different plugins concurrently.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Plugin id this session will own' } },
      required: ['name'],
      additionalProperties: false,
    },
    timeoutMs: 30_000,
    output,
    execute(args, exec) {
      const id = pluginId(args.name)
      return runDshx(['creator', 'claim', id], exec, { ...authOptions, hostPort: (authOptions.hostPort ?? currentWebPort()) }).then((result) => {
        if (result.exitCode === 0) rememberCreatorClaim(exec, id)
        return result
      })
    },
    presentCall: args => ({ card: 'generic', title: `dshx claim ${args.name}`, kind: 'edit', rawInput: args.name }),
  })

  ctx.tools.register({
    name: 'dshx_request_takeover',
    description: 'Ask the user in this conversation to take over a claimed plugin. Shows the actual owner, stops old work after confirmation, and transfers ownership. Never infer approval from chat text or automation.',
    parameters: { type: 'object', properties: { name: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' } }, required: ['name'], additionalProperties: false },
    timeoutMs: 360_000,
    output,
    execute: (args, exec) => requestTakeover(ctx, pluginId(args.name), exec, { ...authOptions, hostPort: (authOptions.hostPort ?? currentWebPort()) }),
    presentCall: args => ({ card: 'generic', title: `申请接管 ${args.name}`, kind: 'edit', rawInput: args.name }),
  })

  ctx.tools.register({
    name: 'dshx_scaffold',
    description: 'Create one plugin inside the calling session workspace and mount it into Harness automatically when needed. It never overwrites an existing project.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Lower-case kebab-case plugin id' },
        kind: { type: 'string', description: 'function, tool, client, object, or class' },
      },
      required: ['name', 'kind'],
      additionalProperties: false,
    },
    timeoutMs: 60_000,
    output,
    execute(args, exec) {
      const id = pluginId(args.name)
      return runClaimedDshx(id, [
        'creator', 'scaffold', id, choice(args.kind, KINDS, 'plugin kind'),
      ], exec, { ...authOptions, hostPort: (authOptions.hostPort ?? currentWebPort()) })
    },
    presentCall: args => ({ card: 'generic', title: `dshx scaffold ${args.name}`, kind: 'edit', rawInput: args }),
  })

  registerOwned({
    name: 'dshx_check',
    description: 'Run DSHX v0.7 external-plugin checks, including client Cordis service injection and the built-client handoff. Passing proves SOURCE_BUILT only, not live activation.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Plugin id under my-plugins' } },
      required: ['name'],
      additionalProperties: false,
    },
    timeoutMs: 60_000,
    output,
    async execute(args, exec) {
      if (!developmentExecution) return runClaimedDshx(pluginId(args.name), ['check', pluginId(args.name)], exec, { ...authOptions, hostPort: (authOptions.hostPort ?? currentWebPort()) })
      const owner = authority.enter(exec, args)
      let call
      try {
        call = invocations.open(owner, exec, policy.capture(exec))
        const id = pluginId(args.name)
        if (call.route === 'sealed') return await call.invokeSealed()
        return await runClaimedDshx(id, ['check', id], call.legacyExecution(), { ...authOptions, hostPort: (authOptions.hostPort ?? currentWebPort()) })
      } finally { if (call) call.close(); else authority.revoke(owner) }
    },
    presentCall: args => ({ card: 'generic', title: `dshx check ${args.name}`, kind: 'read', rawInput: args.name }),
  })

  registerOwned({
    name: 'dshx_activation_plan',
    description: 'Select the activation method for one changed component: patch, manifest, preset, client, new-client, server, or artifact.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Plugin id under my-plugins' },
        change: { type: 'string', description: 'patch, manifest, preset, client, new-client, server, or artifact' },
      },
      required: ['name', 'change'],
      additionalProperties: false,
    },
    timeoutMs: 60_000,
    output,
    async execute(args, exec) {
      if (!developmentExecution) {
        const id = pluginId(args.name)
        return runClaimedDshx(id, ['activation-plan', id, '--change', choice(args.change, CHANGES, 'change surface')], exec, { ...authOptions, hostPort: (authOptions.hostPort ?? currentWebPort()) })
      }
      const owner = authority.enter(exec, args)
      let call
      try {
        call = invocations.open(owner, exec, policy.capture(exec))
        const id = pluginId(args.name)
        if (call.route === 'sealed') return await call.invokeSealed()
        return await runClaimedDshx(id, [
          'activation-plan', id, '--change', choice(args.change, CHANGES, 'change surface'),
        ], call.legacyExecution(), { ...authOptions, hostPort: (authOptions.hostPort ?? currentWebPort()) })
      } finally { if (call) call.close(); else authority.revoke(owner) }
    },
    presentCall: args => ({ card: 'generic', title: `dshx plan ${args.change}`, kind: 'read', rawInput: args }),
  })

  registerOwned({
    name: 'dshx_activate_new_client',
    description: 'Activate one checked my-plugins Web client in the DSHX v0.7 safe order: profile link, resolution proof, watched-patch transaction, then current-Host manifest proof.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Plugin id under my-plugins' } },
      required: ['name'],
      additionalProperties: false,
    },
    timeoutMs: 90_000,
    output,
    async execute(args, exec) {
      if (!developmentExecution) {
        const id = pluginId(args.name), port = (authOptions.hostPort ?? currentWebPort())
        return runClaimedDshx(id, ['activate-new-client', id, '--profile', 'web', '--port', String(port)], exec, { ...authOptions, hostPort: port })
      }
      const owner = authority.enter(exec, args)
      let call
      try {
        call = invocations.open(owner, exec, policy.capture(exec))
        const id = pluginId(args.name)
        if (call.route === 'sealed') return await call.invokeSealed()
        const port = (authOptions.hostPort ?? currentWebPort())
        return await runClaimedDshx(id, [
          'activate-new-client', id, '--profile', 'web', '--port', String(port),
        ], call.legacyExecution(), { ...authOptions, hostPort: port })
      } finally { if (call) call.close(); else authority.revoke(owner) }
    },
    presentCall: args => ({ card: 'generic', title: `dshx activate ${args.name}`, kind: 'edit', rawInput: args.name }),
  })

  ctx.tools.register({
    name: 'dshx_remove_plugin',
    description: 'Safely deactivate and unregister one claimed plugin. It proves the current Host no longer contains the plugin before removing the Web-profile dependency, detaches only symlinks, preserves source, and never restarts DSH.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Claimed plugin id to deactivate and unregister' } },
      required: ['name'],
      additionalProperties: false,
    },
    timeoutMs: 90_000,
    output,
    async execute(args, exec) {
      const id = pluginId(args.name)
      const port = (authOptions.hostPort ?? currentWebPort())
      const result = await runClaimedDshx(id, ['creator', 'remove', id], exec, { ...authOptions, hostPort: port })
      if (result.exitCode === 0) forgetCreatorClaim(exec)
      return result
    },
    presentCall: args => ({ card: 'generic', title: `dshx remove ${args.name}`, kind: 'edit', rawInput: args.name }),
  })

  registerOwned({
    name: 'dshx_hot_reload',
    description: 'Activate the code changes of one already-loaded, checked server plugin. The requested behavior remains RUNTIME_VERIFICATION_REQUIRED until exercised. Use the fixed plugin ID; runtime provenance and cleanup are checked internally.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Existing checked plugin id under my-plugins' } },
      required: ['name'],
      additionalProperties: false,
    },
    timeoutMs: 90_000,
    output,
    async execute(args, exec) {
      const id = pluginId(args.name)
      if (HOT_RELOAD_INFRASTRUCTURE.has(id)) {
        throw new Error(`dshx_hot_reload cannot replace its executing infrastructure plugin: ${id}`)
      }
      if (!developmentExecution) {
        const port = (authOptions.hostPort ?? currentWebPort())
        return runClaimedDshx(id, ['hot-reload', id, '--profile', 'web', '--port', String(port), '--json'], exec, { ...authOptions, hostPort: port })
      }
      const owner = authority.enter(exec, args)
      let call
      try {
        call = invocations.open(owner, exec, policy.capture(exec))
        if (call.route === 'sealed') return await call.invokeSealed()
        const port = (authOptions.hostPort ?? currentWebPort())
        return await runClaimedDshx(id, [
          'hot-reload', id, '--profile', 'web', '--port', String(port), '--json',
        ], call.legacyExecution(), { ...authOptions, hostPort: port })
      } finally { if (call) call.close(); else authority.revoke(owner) }
    },
    presentCall: args => ({ card: 'generic', title: `dshx hot reload ${args.name}`, kind: 'edit', rawInput: args.name }),
  })

  ctx.tools.register({
    name: 'dshx_browser_open',
    description: "Open the current authenticated DSH WebUI through this session's externally approved browser adapter. No URL, path, credential or command input. BROWSER_AUTHENTICATED proves browser access only; continue feature verification without a Host restart.",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    timeoutMs: 60_000,
    output,
    execute(_args, exec) {
      return runDshx(['browser', 'open', '--json'], exec, { ...authOptions, hostPort: (authOptions.hostPort ?? currentWebPort()) })
    },
    presentCall: () => ({ card: 'generic', title: 'Open authenticated DSH browser', kind: 'edit', rawInput: {} }),
  })

  ctx.tools.register({
    name: 'dshx_status',
    description: 'Read the external DSHX v0.7 supervisor and Web Host status. The bridge also reports its pinned contract and capabilities; it never starts, stops, restarts, or updates DSH.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    timeoutMs: 30_000,
    output,
    execute(_args, exec) {
      return runDshx(['status'], exec, { ...authOptions, hostPort: (authOptions.hostPort ?? currentWebPort()) })
    },
    presentCall: () => ({ card: 'generic', title: 'dshx status', kind: 'read' }),
  })
  if (developmentExecution) {
    authority = createDevelopmentExecutionAuthority(ctx, ownedDefinitions)
    invocations = createDevelopmentInvocations(ctx, { authority, tasks, policy, getHarnessRoot: resolveHarnessRoot })
  }
}
