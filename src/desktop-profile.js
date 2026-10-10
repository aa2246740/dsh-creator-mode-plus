/** Private, per-invocation adapter to the application's public profile APIs. */
import { randomBytes } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stringify } from 'yaml'

const PATH = '/dsh-creator-mode-plus/desktop-profile'
const REGISTRY = Symbol.for('dsh-creator-mode-plus.desktop-profile.v1')
const ID = /^[a-z][a-z0-9-]*$/

export function createDesktopProfileBridge(ctx, dependencies = {}) {
  const profile = ctx.profileContext
  if (profile?.name !== 'desktop') return {}
  const anchorSuffix = '/node_modules/@deepseek-ai/dsh/package.json'
  if (!profile.installAnchor.endsWith(anchorSuffix)) throw new Error('Unrecognized Desktop runtime install anchor')
  const hostRoot = profile.installAnchor.slice(0, -anchorSuffix.length)
  const server = ctx.webServer
  const hostKey = ctx.root ?? server
  globalThis[REGISTRY] ??= new WeakMap()
  let shared = globalThis[REGISTRY].get(hostKey)
  if (!shared) {
    shared = { tickets: new Map(), owners: 0 }
    shared.dispose = server.register({ kind: 'exact', path: PATH, handler: async (req, res) => {
      const ticket = shared.tickets.get(req.headers['x-dshx-profile-ticket'])
      if (req.method !== 'POST' || !ticket || ticket.signal?.aborted || Date.now() > ticket.expires) {
        res.writeHead(403); res.end('desktop profile access expired'); return
      }
      try {
        let bytes = 0; const chunks = []
        for await (const part of req) {
          bytes += part.length
          if (bytes > 4096) throw new Error('profile request too large')
          chunks.push(part)
        }
        const request = JSON.parse(Buffer.concat(chunks).toString())
        const result = await ticket.run(request)
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(result))
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ code: 1, stdout: '', stderr: String(error.message ?? error) }))
      }
    } })
    globalThis[REGISTRY].set(hostKey, shared)
  }
  shared.owners++
  const owned = new Set()
  ctx.effect(() => () => {
    for (const token of owned) shared.tickets.delete(token)
    if (--shared.owners === 0) { shared.dispose(); globalThis[REGISTRY].delete(hostKey) }
  })
  return {
    hostProfile: 'desktop', hostPort: server.port,
    hostRoot, hostHome: profile.home,
    createProfileAccess(args, exec, root) {
      const token = randomBytes(32).toString('hex')
      let mutationUsed = false
      const pluginId = args[0] === 'creator' ? args[2] : args[1]
      const mutation = args[0] === 'activate-new-client' ? 'add'
        : args[0] === 'creator' && args[1] === 'remove' ? 'remove' : undefined
      const run = async request => {
        if (request.operation === 'dump') {
          const boot = dependencies.boot ?? await import('@deepseek-ai/dsh-app-boot')
          const rows = boot.composeEntries([boot.readProfilePatches('dshx', profile)])
          // Configuration values and credential references never leave the Host.
          return { code: 0, stderr: '', stdout: stringify(rows.map(({ id, name, disabled }) => ({ id, ...name ? { name } : {}, ...disabled ? { disabled } : {} }))) }
        }
        if (!mutation || mutationUsed || request.operation !== mutation || request.pluginId !== pluginId || !ID.test(pluginId)) throw new Error('desktop profile operation not granted')
        const claims = dependencies.claims ?? await import(pathToFileURL(join(root, 'tools/dshx/src/internal/creator-claims.mjs')).href)
        claims.assertUnfenced(root, exec.agent.id, pluginId)
        if (!claims.listClaims(root).some(row => row.sessionId === exec.agent.id && row.pluginId === pluginId)) throw new Error('desktop profile claim changed')
        const source = realpathSync(join(root, 'my-plugins', pluginId))
        if (source.split(sep).includes('node_modules') || ['apps', 'packages', 'vendor'].some(dir => source === join(root, dir) || source.startsWith(join(root, dir) + sep))) throw new Error('protected plugin source')
        const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
        if (pkg.name !== pluginId || pkg.dsh?.bundle !== undefined) throw new Error('desktop watched operation requires a matching plain plugin')
        const manifest = JSON.parse(readFileSync(join(profile.dir, 'package.json'), 'utf8'))
        if (manifest.dsh?.profile?.bundles?.includes(pluginId)) throw new Error('desktop bundle removal is external-only')
        const existing = manifest.dependencies?.[pluginId]
        if (existing && (!existing.startsWith('link:') || realpathSync(resolve(profile.dir, existing.slice(5))) !== source)) throw new Error('desktop profile dependency identity changed')
        mutationUsed = true
        const operations = dependencies.operations ?? await import('@deepseek-ai/dsh-plugin-manager/operations')
        const pm = profile.packageManager
        const result = await operations.runPluginCommand({ profile: profile.name, dir: profile.dir, installAnchor: profile.installAnchor, cwd: source, home: profile.home },
          mutation === 'add' ? ['add', `link:${source}`] : ['remove', pluginId],
          { execution: 'service', ...pm, signal: exec.signal, outputBytes: 16384, activateNewBundles: false, lockWaitMs: 30000, idleTimeoutMs: 60000 })
        return { code: result.exitCode, stdout: result.output, stderr: '' }
      }
      shared.tickets.set(token, { run, signal: exec.signal, expires: Date.now() + 120000 })
      owned.add(token)
      return { env: { DSHX_DESKTOP_PROFILE_ACCESS: JSON.stringify({ token, port: server.port, hostPid: process.pid }) },
        dispose() { shared.tickets.delete(token); owned.delete(token) } }
    },
  }
}
