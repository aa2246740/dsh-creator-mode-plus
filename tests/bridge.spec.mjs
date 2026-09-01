import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { apply, installClientFailureRoute } from '../src/index.js'
import {
  CREATOR_BRIDGE_VERSION,
  currentWebPort,
  deliverCreatorRecovery,
  releaseCreatorClaim,
  resolveDshxRuntime,
  resolveHarnessRoot,
  runClientFailureDshx,
  runDshx,
  supportsDshxVersion,
} from '../src/runner.js'
import {
  CREATOR_MODEL_TOOLS,
  DSHX_CONTRACT,
  DSHX_SURFACE_MARKERS,
  REQUIRED_DSHX_PATHS,
} from '../src/compatibility.js'
import {
  creatorDestructiveCommandReason,
  rememberCreatorClaim,
} from '../src/safety.js'

const temporaryRoots = []

function temporaryDirectory(label) {
  const path = mkdtempSync(join(tmpdir(), label))
  temporaryRoots.push(path)
  return path
}

function harnessAt(root, version = '0.7.4') {
  mkdirSync(join(root, 'apps/cli/src'), { recursive: true })
  writeFileSync(join(root, 'apps/cli/src/bin.ts'), '')
  for (const path of REQUIRED_DSHX_PATHS) {
    const target = join(root, 'tools/dshx', path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, DSHX_SURFACE_MARKERS[path].join('\n'))
  }
  writeFileSync(join(root, 'tools/dshx/package.json'), JSON.stringify({
    name: 'dsh-external-plugin-devkit',
    version,
  }))
  return root
}

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Creator Bridge v2', () => {
  it('registers only the seven fixed tools and rejects process control', () => {
    const registered = []
    apply({
      tools: { register(tool) { registered.push(tool) } },
      webServer: { port: 43127, register() { return () => {} } },
      effect(callback, label) {
        if (label.includes('browser failure route')) callback()
      },
    })

    assert.deepEqual(registered.map(tool => tool.name), CREATOR_MODEL_TOOLS)
    assert.equal(registered.some(tool => /start|stop|restart|shell|command/.test(tool.name)), false)
    assert.throws(
      () => registered[0].execute({ name: '../escape' }, { signal: undefined }),
      /lower-case kebab-case/,
    )
    assert.throws(() => runDshx(['restart']), /outside bridge v2/)
    assert.throws(
      () => runDshx(['activate-new-client', 'demo', '--profile', 'web', '--port', 'not-a-port']),
      /outside bridge v2/,
    )
  })

  it('allows the exact argv shape behind every fixed Creator tool and lifecycle hook', async () => {
    const harness = harnessAt(temporaryDirectory('creator-mode-plus-allowlist-'))
    const spawned = []
    const spawnProcess = (_command, argv) => {
      spawned.push(argv)
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.kill = () => true
      queueMicrotask(() => child.emit('close', 0))
      return child
    }
    const exec = {
      agent: { id: 'session-a' },
      callId: 'call-a',
      rootCallId: 'root-a',
      signal: new AbortController().signal,
    }
    const operations = [
      ['status'],
      ['creator', 'claim', 'demo'],
      ['creator', 'scaffold', 'demo', 'client'],
      ['check', 'demo'],
      ['activation-plan', 'demo', '--change', 'new-client'],
      ['activate-new-client', 'demo', '--profile', 'web', '--port', '43127'],
      ['creator', 'remove', 'demo'],
      ['creator', 'watch', '--json'],
      ['creator', 'release', '--json'],
      ['creator', 'recovery', 'pull', '--json'],
      ['creator', 'recovery', 'ack', '11111111-1111-4111-8111-111111111111', '--json'],
    ]

    for (const args of operations) {
      const result = await runDshx(args, exec, {
        harnessRoot: harness,
        loaderPath: '/fake/tsx-loader.mjs',
        hostPort: 43127,
        spawnProcess,
      })
      assert.equal(result.exitCode, 0)
    }
    assert.deepEqual(spawned.map(argv => argv.slice(3)), operations)
  })

  it('blocks the observed raw teardown chain while allowing ordinary component cleanup', () => {
    const agent = { id: 'session-a', session: { header: { cwd: '/Users/wu/Documents/DSH/mmx3' } } }
    const exec = command => ({ name: 'bash', arguments: { command }, agent })
    rememberCreatorClaim({ agent }, 'emoji-rain')

    assert.match(
      creatorDestructiveCommandReason(exec('rm -rf "/Users/wu/Documents/DSH/mmx3/emoji-rain"')),
      /dshx_remove_plugin/,
    )
    assert.match(
      creatorDestructiveCommandReason(exec('unlink "/harness/my-plugins/emoji-rain"')),
      /dshx_remove_plugin/,
    )
    assert.match(
      creatorDestructiveCommandReason(exec('rm -f "/Users/wu/.dsh/profiles/web/node_modules/emoji-rain"')),
      /active DSH profile/,
    )
    assert.equal(creatorDestructiveCommandReason(exec('rm -f emoji-rain/src/old-component.ts')), undefined)
    assert.equal(creatorDestructiveCommandReason(exec('rm -rf dist')), undefined)
  })

  it('forwards browser failures through fixed argv without a model context', async () => {
    const harness = harnessAt(temporaryDirectory('creator-mode-plus-client-failure-'))
    let spawnedArgs
    let spawnedOptions
    const spawnProcess = (_command, argv, options) => {
      spawnedArgs = argv
      spawnedOptions = options
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.kill = () => true
      queueMicrotask(() => child.emit('close', 0))
      return child
    }
    await runClientFailureDshx({
      failedIds: ['demo'],
      message: 'Failed to load plugins',
      hostPid: 11,
      hostParentPid: 10,
      hostPort: 43127,
    }, { harnessRoot: harness, loaderPath: '/fake/tsx-loader.mjs', spawnProcess })
    assert.deepEqual(spawnedArgs.slice(-3), ['creator', 'client-failure', '--json'])
    assert.equal('DSHX_CREATOR_CONTEXT' in spawnedOptions.env, false)
    assert.deepEqual(JSON.parse(spawnedOptions.env.DSHX_CREATOR_CLIENT_FAILURE), {
      failedIds: ['demo'],
      message: 'Failed to load plugins',
      hostPid: 11,
      hostParentPid: 10,
      hostPort: 43127,
    })
  })

  it('accepts only same-origin bounded reports and stamps the live Host identity', async () => {
    let route
    let forwarded
    installClientFailureRoute({
      webServer: {
        port: 43127,
        register(value) { route = value; return () => {} },
      },
      effect(callback) { callback() },
    }, {
      runClientFailureDshx: async (report) => {
        forwarded = report
        return { exitCode: 0, stdout: JSON.stringify({ data: { reload: true, incident: { id: 'incident-a' } } }), stderr: '' }
      },
    })
    const req = new PassThrough()
    req.method = 'POST'
    req.headers = { origin: 'http://127.0.0.1:43127', host: '127.0.0.1:43127' }
    const response = {
      writeHead(status) { this.status = status },
      end(body = '') { this.body = body },
    }
    req.end(JSON.stringify({ failedIds: ['demo'], message: 'failed', hostPid: 1 }))
    await route.handler(req, response)
    assert.equal(response.status, 200)
    assert.equal(JSON.parse(response.body).reload, true)
    assert.deepEqual(forwarded, {
      failedIds: ['demo'],
      message: 'failed',
      hostPid: process.pid,
      hostParentPid: process.ppid,
      hostPort: 43127,
    })

    const foreign = new PassThrough()
    foreign.method = 'POST'
    foreign.headers = { origin: 'https://evil.example', host: '127.0.0.1:43127' }
    const denied = {
      writeHead(status) { this.status = status },
      end(body = '') { this.body = body },
    }
    foreign.end('{}')
    await route.handler(foreign, denied)
    assert.equal(denied.status, 403)
  })

  it('shares one client-failure route across live preset generations', async () => {
    const first = await import(`../src/index.js?generation=first-${Date.now()}`)
    const second = await import(`../src/index.js?generation=second-${Date.now()}`)
    const releases = []
    let registrations = 0
    let disposals = 0
    let route
    let owner
    const webServer = {
      port: 43127,
      register(value) {
        if (route !== undefined) throw new Error('duplicate exact route')
        registrations += 1
        route = value
        return () => {
          route = undefined
          disposals += 1
        }
      },
    }
    const context = {
      webServer,
      effect(callback) { releases.push(callback()) },
    }

    first.installClientFailureRoute(context, {
      runClientFailureDshx: async () => {
        owner = 'first'
        return { exitCode: 0, stdout: '{}', stderr: '' }
      },
    })
    second.installClientFailureRoute(context, {
      runClientFailureDshx: async () => {
        owner = 'second'
        return { exitCode: 0, stdout: '{}', stderr: '' }
      },
    })

    assert.equal(registrations, 1)
    const req = new PassThrough()
    req.method = 'POST'
    req.headers = { origin: 'http://127.0.0.1:43127', host: '127.0.0.1:43127' }
    const response = {
      writeHead(status) { this.status = status },
      end(body = '') { this.body = body },
    }
    req.end(JSON.stringify({ failedIds: ['demo'], message: 'failed' }))
    await route.handler(req, response)
    assert.equal(owner, 'second')

    releases[1]()
    assert.equal(disposals, 0)
    owner = undefined
    const fallbackRequest = new PassThrough()
    fallbackRequest.method = 'POST'
    fallbackRequest.headers = { origin: 'http://127.0.0.1:43127', host: '127.0.0.1:43127' }
    fallbackRequest.end(JSON.stringify({ failedIds: ['demo'], message: 'failed again' }))
    await route.handler(fallbackRequest, response)
    assert.equal(owner, 'first')

    releases[0]()
    assert.equal(disposals, 1)
  })

  it('derives only the current official Web port', () => {
    assert.equal(currentWebPort(['node', 'bin.ts', 'web', '--port', '43127', '--no-open']), 43127)
    assert.equal(currentWebPort(['node', 'bin.ts', '--profile', 'web']), 3080)
    assert.throws(() => currentWebPort(['node', 'bin.ts', 'headless']), /current Web profile/)
    assert.throws(() => currentWebPort(['node', 'bin.ts', 'web', '--port', '0']), /valid TCP port/)
  })

  it('accepts only the declared DSHX compatibility range', () => {
    assert.equal(CREATOR_BRIDGE_VERSION, 2)
    assert.equal(DSHX_CONTRACT.id, 'dshx-v0.7/creator-bridge-v2')
    assert.equal(supportsDshxVersion('0.6.99'), false)
    assert.equal(supportsDshxVersion('0.7.0-beta.1'), false)
    assert.equal(supportsDshxVersion('0.7.0'), false)
    assert.equal(supportsDshxVersion('0.7.1'), false)
    assert.equal(supportsDshxVersion('0.7.2'), false)
    assert.equal(supportsDshxVersion('0.7.3'), false)
    assert.equal(supportsDshxVersion('0.7.4'), true)
    assert.equal(supportsDshxVersion('0.7.9+build.4'), true)
    assert.equal(supportsDshxVersion('0.8.0'), false)
    assert.equal(supportsDshxVersion('invalid'), false)
  })

  it('resolves one explicit checkout and rejects conflicting discovery', () => {
    const first = harnessAt(temporaryDirectory('creator-mode-plus-first-'))
    const second = harnessAt(temporaryDirectory('creator-mode-plus-second-'))
    const nested = join(first, 'workspace/plugin/src')
    mkdirSync(nested, { recursive: true })

    assert.equal(resolveHarnessRoot({ harnessRoot: first }), first)
    assert.equal(resolveHarnessRoot({ envRoot: '', configFile: '/missing', cwd: nested, moduleDir: '/missing' }), first)
    assert.throws(
      () => resolveHarnessRoot({ envRoot: first, configFile: '/missing', cwd: second, moduleDir: '/missing' }),
      /multiple Harness checkouts/,
    )
  })

  it('resolves a compatible DSHX runtime and fails closed on drift', () => {
    const compatible = harnessAt(temporaryDirectory('creator-mode-plus-compatible-'), '0.7.4')
    const runtime = resolveDshxRuntime({ harnessRoot: compatible, loaderPath: '/fake/tsx-loader.mjs' })
    assert.equal(runtime.dshxVersion, '0.7.4')
    assert.equal(runtime.bridgeVersion, 2)
    assert.equal(runtime.loader, '/fake/tsx-loader.mjs')
    assert.equal(runtime.contractId, 'dshx-v0.7/creator-bridge-v2')
    assert.equal(runtime.capabilities.includes('safe-profile-bundle-removal'), true)
    assert.equal(runtime.capabilities.includes('transactional-harness-update-assistant'), true)
    assert.equal(runtime.capabilities.includes('single-home-web-host'), true)
    assert.equal(runtime.capabilities.includes('isolated-verify-home'), true)

    const incompatible = harnessAt(temporaryDirectory('creator-mode-plus-incompatible-'), '0.8.0')
    assert.throws(
      () => resolveDshxRuntime({ harnessRoot: incompatible, loaderPath: '/fake/tsx-loader.mjs' }),
      /dshx 0\.8\.0 is incompatible/,
    )
  })

  it('requires the complete DSHX v0.7 Creator, Guardian, activation, and update surfaces', () => {
    const incomplete = harnessAt(temporaryDirectory('creator-mode-plus-incomplete-'))
    rmSync(join(incomplete, 'tools/dshx/src/commands/update.ts'))
    rmSync(join(incomplete, 'tools/dshx/knowledge/contracts/harness-update.md'))
    assert.throws(
      () => resolveDshxRuntime({ harnessRoot: incomplete, loaderPath: '/fake/tsx-loader.mjs' }),
      /missing required dshx-v0\.7\/creator-bridge-v2 surfaces: src\/commands\/update\.ts, knowledge\/contracts\/harness-update\.md/,
    )
  })

  it('stamps the exact DSH session and call chain into the external command environment', async () => {
    const harness = harnessAt(temporaryDirectory('creator-mode-plus-context-'))
    let spawned
    const spawnProcess = (_command, _argv, options) => {
      spawned = options
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.kill = () => true
      queueMicrotask(() => child.emit('close', 0))
      return child
    }
    await runDshx(['status'], {
      agent: { id: 'session-a', session: { header: { cwd: '/workspace/demo' } } },
      callId: 'call-a',
      rootCallId: 'root-a',
      signal: new AbortController().signal,
    }, {
      harnessRoot: harness,
      loaderPath: '/fake/tsx-loader.mjs',
      hostPort: 43127,
      spawnProcess,
    })
    assert.deepEqual(JSON.parse(spawned.env.DSHX_CREATOR_CONTEXT), {
      sessionId: 'session-a',
      callId: 'call-a',
      rootCallId: 'root-a',
      hostPid: process.pid,
      hostParentPid: process.ppid,
      hostPort: 43127,
      bridgeVersion: 2,
      workspaceRoot: '/workspace/demo',
    })
  })

  it('steers a recovered incident with plugin authority and acknowledges it', async () => {
    const incidentId = '11111111-1111-4111-8111-111111111111'
    const calls = []
    const messages = []
    const run = async (args) => {
      calls.push(args)
      if (args[2] === 'pull') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ data: { incidents: [{
            id: incidentId,
            summary: 'Host recovered',
            pluginId: 'demo',
            rollback: 'disabled',
            port: 43127,
          }] } }),
          stderr: '',
        }
      }
      return { exitCode: 0, stdout: '{}', stderr: '' }
    }
    const incidents = await deliverCreatorRecovery({
      id: 'session-a',
      steer(message) { messages.push(message) },
    }, { runDshx: run, hostPort: 43127 })
    assert.equal(incidents.length, 1)
    assert.equal(messages[0].source.kind, 'plugin')
    assert.equal(messages[0].source.plugin, 'dsh-creator-mode-plus')
    assert.match(messages[0].content[0].text, /Attributed plugin: demo/)
    assert.deepEqual(calls[0], ['creator', 'watch', '--json'])
    assert.deepEqual(calls[2], ['creator', 'recovery', 'ack', incidentId, '--json'])

    await releaseCreatorClaim({ id: 'session-a' }, { runDshx: run, hostPort: 43127 })
    assert.deepEqual(calls[3], ['creator', 'release', '--json'])
  })
})
