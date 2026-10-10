import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createDesktopProfileBridge } from '../src/desktop-profile.js'

test('Desktop bridge binds one claimed mutation, preserves app pnpm, and strips config from dumps', async t => {
  const root = mkdtempSync(join(tmpdir(), 'creator-desktop-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'my-plugins/plugin-a'), profile = join(root, 'home/profiles/desktop')
  mkdirSync(source, { recursive: true }); mkdirSync(profile, { recursive: true })
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'plugin-a' }))
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: {} }))
  let handler, registrations = 0, disposals = 0, calls = []
  const server = { port: 19387, register({ path, handler: callback }) { registrations++; handler = callback; return () => disposals++ } }
  const cleanup = []
  const ctx = { webServer: server, profileContext: { name: 'desktop', dir: profile, home: join(root, 'home'), installAnchor: join(root, 'app/node_modules/@deepseek-ai/dsh/package.json'), packageManager: { command: '/app/node', args: ['/app/pnpm'], env: { APP_NODE: '1' } } }, effect(fn) { cleanup.push(fn()) } }
  const deps = { claims: { assertUnfenced() {}, listClaims: () => [{ sessionId: 'session-a', pluginId: 'plugin-a' }] }, operations: { async runPluginCommand(...args) { calls.push(args); return { exitCode: 0, output: 'installed' } } }, boot: { readProfilePatches: () => [], composeEntries: () => [{ id: 'plugin-a', name: 'plugin-a', config: { apiKey: 'must-not-leave-host' } }] } }
  const bridge = createDesktopProfileBridge(ctx, deps)
  assert.equal(bridge.hostRoot, join(root, 'app'))
  createDesktopProfileBridge(ctx, deps)
  assert.equal(registrations, 1)
  const controller = new AbortController()
  const exec = { agent: { id: 'session-a' }, signal: controller.signal }
  const access = bridge.createProfileAccess(['activate-new-client', 'plugin-a'], exec, root)
  const { token } = JSON.parse(access.env.DSHX_DESKTOP_PROFILE_ACCESS)
  const request = async (body, supplied = token) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = 'POST'; req.headers = { 'x-dshx-profile-ticket': supplied }
    let code, text
    await handler(req, { writeHead(value) { code = value }, end(value) { text = value } })
    return { code, text }
  }
  assert.equal((await request({ operation: 'add', pluginId: 'other' })).code, 400)
  assert.equal((await request({ operation: 'add', pluginId: 'plugin-a' }, 'invalid')).code, 403)
  const dumped = await request({ operation: 'dump' })
  assert.equal(dumped.code, 200); assert(!dumped.text.includes('apiKey')); assert(!dumped.text.includes('must-not-leave-host'))
  assert.equal((await request({ operation: 'add', pluginId: 'plugin-a' })).code, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0].profile, 'desktop'); assert.equal(calls[0][0].dir, profile)
  assert.deepEqual(calls[0][1], ['add', `link:${realpathSync(source)}`])
  assert.equal(calls[0][2].command, '/app/node'); assert.equal(calls[0][2].activateNewBundles, false)
  assert.equal((await request({ operation: 'add', pluginId: 'plugin-a' })).code, 400)
  access.dispose(); assert.equal((await request({ operation: 'dump' })).code, 403)
  const cancelled = bridge.createProfileAccess(['activation-plan', 'plugin-a'], exec, root)
  controller.abort()
  assert.equal((await request({ operation: 'dump' }, JSON.parse(cancelled.env.DSHX_DESKTOP_PROFILE_ACCESS).token)).code, 403)
  cleanup[0](); assert.equal(disposals, 0); cleanup[1](); assert.equal(disposals, 1)
})

test('Web profiles retain the established bridge', () => {
  assert.deepEqual(createDesktopProfileBridge({ profileContext: { name: 'web' } }), {})
})
