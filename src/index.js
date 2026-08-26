/** Creator Mode+ model tools backed by fixed dshx operations. */

import {
  currentWebPort,
  installCreatorRecovery,
  runClaimedDshx,
  runClientFailureDshx,
  runDshx,
} from './runner.js'

export {
  CREATOR_BRIDGE_VERSION,
  CREATOR_MODEL_TOOLS,
  DSHX_CONTRACT,
} from './compatibility.js'

export const name = 'dsh-creator-mode-plus'
export const inject = ['tools', 'webServer']

const CLIENT_FAILURE_PATH = '/dsh-creator-mode-plus/client-failure'
const MAX_CLIENT_FAILURE_BYTES = 16 * 1024
const CLIENT_FAILURE_ROUTE_REGISTRY = Symbol.for('dsh-creator-mode-plus.client-failure-routes.v1')

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/
const KINDS = new Set(['function', 'tool', 'client', 'object', 'class'])
const CHANGES = new Set(['patch', 'manifest', 'preset', 'client', 'new-client', 'server', 'artifact'])

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

function isSameOrigin(req) {
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
      if (!isSameOrigin(req)) {
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

function acquireClientFailureRoute(webServer, handler) {
  const registry = clientFailureRouteRegistry()
  let broker = registry.get(webServer)
  const lease = { handler }
  if (broker === undefined) {
    broker = { leases: new Set([lease]), current: lease, dispose: undefined }
    broker.dispose = webServer.register({
      kind: 'exact',
      path: CLIENT_FAILURE_PATH,
      handler: (req, res) => broker.current.handler(req, res),
    })
    registry.set(webServer, broker)
  } else {
    broker.leases.add(lease)
    broker.current = lease
  }

  return () => {
    if (!broker.leases.delete(lease)) return
    if (broker.leases.size === 0) {
      broker.dispose()
      if (registry.get(webServer) === broker) registry.delete(webServer)
      return
    }
    if (broker.current !== lease) return
    for (const remaining of broker.leases) broker.current = remaining
  }
}

/** Register one generation-safe same-origin browser sentry route per Web Host. */
export function installClientFailureRoute(ctx, options = {}) {
  ctx.effect(
    () => acquireClientFailureRoute(ctx.webServer, clientFailureHandler(ctx.webServer, options)),
    'Creator Mode+ browser failure route',
  )
}

/** Register file-backed Creator Mode+ operations for one preset scope. */
export function apply(ctx) {
  console.log('[dsh-creator-mode-plus] loaded')
  installCreatorRecovery(ctx)
  installClientFailureRoute(ctx)

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
      return runDshx(['creator', 'claim', id], exec, { hostPort: currentWebPort() })
    },
    presentCall: args => ({ card: 'generic', title: `dshx claim ${args.name}`, kind: 'edit', rawInput: args.name }),
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
      ], exec, { hostPort: currentWebPort() })
    },
    presentCall: args => ({ card: 'generic', title: `dshx scaffold ${args.name}`, kind: 'edit', rawInput: args }),
  })

  ctx.tools.register({
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
    execute(args, exec) {
      const id = pluginId(args.name)
      return runClaimedDshx(id, ['check', id], exec, { hostPort: currentWebPort() })
    },
    presentCall: args => ({ card: 'generic', title: `dshx check ${args.name}`, kind: 'read', rawInput: args.name }),
  })

  ctx.tools.register({
    name: 'dshx_activation_plan',
    description: 'Classify one change as patch, manifest, preset, client, new-client, server, or artifact before any new-session, reload, or restart decision.',
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
    execute(args, exec) {
      const id = pluginId(args.name)
      return runClaimedDshx(id, [
        'activation-plan', id, '--change', choice(args.change, CHANGES, 'change surface'),
      ], exec, { hostPort: currentWebPort() })
    },
    presentCall: args => ({ card: 'generic', title: `dshx plan ${args.change}`, kind: 'read', rawInput: args }),
  })

  ctx.tools.register({
    name: 'dshx_activate_new_client',
    description: 'Activate one checked my-plugins Web client in the DSHX v0.7 safe order: profile link, resolution proof, watched-patch transaction, then current-Host manifest proof. It never reloads the browser or restarts DSH.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Plugin id under my-plugins' } },
      required: ['name'],
      additionalProperties: false,
    },
    timeoutMs: 90_000,
    output,
    execute(args, exec) {
      const id = pluginId(args.name)
      const port = currentWebPort()
      return runClaimedDshx(id, [
        'activate-new-client', id, '--profile', 'web', '--port', String(port),
      ], exec, { hostPort: port })
    },
    presentCall: args => ({ card: 'generic', title: `dshx activate ${args.name}`, kind: 'edit', rawInput: args.name }),
  })

  ctx.tools.register({
    name: 'dshx_status',
    description: 'Read the external DSHX v0.7 supervisor and Web Host status. The bridge also reports its pinned contract and capabilities; it never starts, stops, restarts, or updates DSH.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    timeoutMs: 30_000,
    output,
    execute(_args, exec) {
      return runDshx(['status'], exec, { hostPort: currentWebPort() })
    },
    presentCall: () => ({ card: 'generic', title: 'dshx status', kind: 'read' }),
  })
}
