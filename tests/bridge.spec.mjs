import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  installCreatorRecovery,
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

describe('Creator delivery continuation', () => {
  it('continues a checked server activation after a missing browser adapter in the same session', async () => {
    const harness = harnessAt(temporaryDirectory('creator-continuation-'))
    const plugin = join(harness, 'my-plugins/demo')
    mkdirSync(plugin, { recursive: true })
    writeFileSync(join(plugin, 'index.js'), 'export const value = 1')
    const commands = []
    const plan = { command: 'activation-plan', ok: false,
      findings: [{ level: 'error', code: 'activation-blocker' }],
      data: { change: 'server', facts: { packageDir: plugin, hasClient: true, handoff: { port: 43127 } },
        decision: { hostRestart: 'not-decided' } } }
    const options = { harnessRoot: harness, loaderPath: '/fake/tsx-loader.mjs', hostPort: 43127,
      spawnProcess(_command, argv) {
        const operation = argv[3]
        commands.push(operation)
        const child = new EventEmitter()
        child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true
        queueMicrotask(() => {
          child.stdout.write(operation === 'activation-plan' ? JSON.stringify(plan)
            : operation === 'browser' ? JSON.stringify({ command: 'browser', ok: false,
              findings: [{ level: 'error', code: 'browser-access', message: 'BROWSER_ADAPTER_REQUIRED: configure this session' }] })
            : 'dshx check\nOK manifest')
          child.emit('close', operation === 'check' ? 0 : 1)
        })
        return child
      } }
    const exec = { agent: { id: 'continuation-session' }, callId: 'call-a', signal: new AbortController().signal }
    const planned = await runDshx(['activation-plan', 'demo', '--change', 'server'], exec, options)
    assert.equal(planned.outcome.status, 'ACTION_REQUIRED')
    assert.equal(planned.commandExitCode, 1)
    assert.equal(planned.exitCode, 0, 'a successful planning result is not an operation failure')
    const checked = await runDshx(['check', 'demo'], exec, options)
    assert.equal(checked.delivery.state, 'HOT_RELOAD_READY')
    assert.deepEqual(checked.delivery.nextAction, { tool: 'dshx_hot_reload', arguments: { name: 'demo' } })
    const browser = await runDshx(['browser', 'open', '--json'], exec, options)
    assert.equal(browser.exitCode, 1)
    assert.equal(browser.outcome.status, 'BLOCKED')
    assert.equal(browser.outcome.scope, 'browser')
    assert.equal(browser.delivery.state, 'HOT_RELOAD_READY')
    assert.deepEqual(browser.outcome.continueWith, [checked.delivery.nextAction])
    assert.deepEqual(commands, ['activation-plan', 'check', 'browser'])
  })

  it('keeps an unrelated server-plan error blocking and offers no hot-reload action', async () => {
    const harness = harnessAt(temporaryDirectory('creator-continuation-error-'))
    const plan = { command: 'activation-plan', ok: false,
      findings: [{ level: 'error', code: 'activation-blocker' }, { level: 'error', code: 'offline-composition' }],
      data: { change: 'server', facts: { packageDir: '/not-checked' }, decision: { hostRestart: 'not-decided' } } }
    const result = await runDshx(['activation-plan', 'demo', '--change', 'server'], { agent: { id: 'plan-error' } }, {
      harnessRoot: harness, loaderPath: '/fake/tsx-loader.mjs', hostPort: 43127,
      spawnProcess() {
        const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true
        queueMicrotask(() => { child.stdout.write(JSON.stringify(plan)); child.emit('close', 1) })
        return child
      },
    })
    assert.equal(result.exitCode, 1)
    assert.equal(result.outcome.status, 'BLOCKED')
    assert.equal(result.outcome.scope, 'activation')
    assert.equal(result.outcome.continueWith.some(action => action.tool === 'dshx_hot_reload'), false)
  })
})

function temporaryDirectory(label) {
  const path = mkdtempSync(join(tmpdir(), label))
  temporaryRoots.push(path)
  return path
}

function harnessAt(root, version = '0.9.1') {
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
  it('registers only the ten fixed tools and rejects process control', async () => {
    const registered = []
    apply({
      root: {},
      tools: { guard() { return () => {} }, register(tool) { registered.push(tool) }, get() {} },
      webServer: { port: 43127, register() { return () => {} } },
      connection: {},
      logger: { info() {}, warn() {} },
      on() { return () => {} },
      inject() { return { dispose() {} } },
      fiber: { assertActive() {} },
      agents: { get() {}, list() { return [] } },
      sessions: { get() {}, list() { return [] } },
      effect(callback, label) {
        if (typeof label === 'string' && label.includes('browser failure route')) callback()
      },
    })

    assert.deepEqual(registered.map(tool => tool.name), CREATOR_MODEL_TOOLS)
    const hotReload = registered.find(tool => tool.name === 'dshx_hot_reload')
    assert.deepEqual(hotReload.parameters.required, ['name'])
    assert.deepEqual(Object.keys(hotReload.parameters.properties), ['name'])
    assert.match(hotReload.description, /RUNTIME_VERIFICATION_REQUIRED/)
    await assert.rejects(
      () => hotReload.execute({ name: 'dsh-creator-mode-plus' }, { signal: undefined }),
      /cannot replace its executing infrastructure plugin/,
    )
    await assert.rejects(
      () => hotReload.execute({ name: 'dsh-external-plugin-devkit' }, { signal: undefined }),
      /cannot replace its executing infrastructure plugin/,
    )
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
    assert.throws(
      () => runDshx(['hot-reload', '../demo', '--profile', 'web', '--port', '43127', '--json']),
      /outside bridge v2/,
    )
    assert.throws(
      () => runDshx(['hot-reload', 'demo', '--profile', 'web', '--port', '43127']),
      /outside bridge v2/,
    )
    assert.throws(
      () => runDshx(['hot-reload', 'demo', '--profile', 'web', '--port', '43127', '--json', '--timeout', '1']),
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
      queueMicrotask(() => child.emit('close', argv.includes('hot-reload') ? 1 : 0))
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
      ['browser', 'open', '--json'],
      ['creator', 'claim', 'demo'],
      ['creator', 'takeover', 'demo', '--json'],
      ['creator', 'scaffold', 'demo', 'client'],
      ['check', 'demo'],
      ['activation-plan', 'demo', '--change', 'new-client'],
      ['activate-new-client', 'demo', '--profile', 'web', '--port', '43127'],
      ['creator', 'remove', 'demo'],
      ['hot-reload', 'demo', '--profile', 'web', '--port', '43127', '--json'],
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
      assert.equal(result.exitCode, args[0] === 'hot-reload' ? 1 : 0)
    }
    assert.deepEqual(spawned.map(argv => argv.slice(3)), operations.map(args => [...args, ...args[0] === 'activation-plan' ? ['--json'] : [], '--harness', harness]))
  })

  it('stamps Desktop identity and maps every fixed operation without exposing profile selection', async () => {
    const harness = harnessAt(temporaryDirectory('creator-desktop-argv-'))
    const calls = []; let disposed = 0
    const operations = [['status'], ['creator', 'claim', 'demo'], ['creator', 'scaffold', 'demo', 'client'], ['check', 'demo'], ['activation-plan', 'demo', '--change', 'new-client'], ['activate-new-client', 'demo', '--profile', 'web', '--port', '19387'], ['creator', 'remove', 'demo'], ['hot-reload', 'demo', '--profile', 'web', '--port', '19387', '--json'], ['creator', 'watch', '--json'], ['creator', 'release', '--json'], ['browser', 'open', '--json']]
    for (const args of operations) await runDshx(args, { agent: { id: 'desktop-session' }, signal: new AbortController().signal }, {
      harnessRoot: harness, loaderPath: '/fake/loader', hostProfile: 'desktop', hostPort: 19387, hostRoot: '/app/runtime', hostHome: '/user/home',
      createProfileAccess() { return { env: { DSHX_DESKTOP_PROFILE_ACCESS: 'private-ticket' }, dispose() { disposed++ } } },
      spawnProcess(command, argv, opts) {
        calls.push({ argv, opts }); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true
        queueMicrotask(() => child.emit('close', args[0] === 'hot-reload' ? 1 : 0)); return child
      },
    })
    assert.equal(disposed, operations.length)
    for (const { argv, opts } of calls) {
      const identity = JSON.parse(opts.env.DSHX_CREATOR_CONTEXT)
      assert.equal(identity.hostProfile, 'desktop'); assert.equal(identity.hostRoot, '/app/runtime'); assert.equal(identity.hostPid, process.pid)
      const index = argv.indexOf('--profile'); if (index >= 0) assert.equal(argv[index + 1], 'desktop')
      assert(!argv.includes('private-ticket'))
    }
  })

  it('never spawns an already-aborted operation and retains the structured result shape', async () => {
    const harness = harnessAt(temporaryDirectory('creator-mode-plus-pre-abort-'))
    const controller = new AbortController()
    controller.abort(new Error('cancel before invocation'))
    let spawns = 0, startupReads = 0
    const result = await runDshx(['activate-new-client', 'demo', '--profile', 'web', '--port', '43127'], {
      agent: { id: 'cancelled-agent' }, signal: controller.signal,
    }, {
      harnessRoot: harness, loaderPath: '/fake/tsx-loader.mjs', hostPort: 43127,
      getWebStartupUrl() { startupReads++; return undefined },
      spawnProcess() { spawns++; throw new Error('must never start') },
    })
    assert.equal(spawns, 0)
    assert.equal(startupReads, 0)
    assert.equal(result.exitCode, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /aborted before spawn/)
    assert.equal(result.command, 'dshx activate-new-client demo --profile web --port 43127')
    assert.equal(result.creatorBridgeVersion, CREATOR_BRIDGE_VERSION)
    assert.equal(result.dshxContract, DSHX_CONTRACT.id)
    assert.equal(result.hostPid, process.pid)
    assert.equal(result.hostPort, 43127)
  })

  it('rechecks cancellation after synchronous startup preparation but before any spawn', async () => {
    const harness = harnessAt(temporaryDirectory('creator-mode-plus-late-pre-abort-'))
    const controller = new AbortController()
    let spawns = 0, startupReads = 0
    const result = await runDshx(['check', 'demo'], {
      agent: { id: 'cancelled-agent' }, signal: controller.signal,
    }, {
      harnessRoot: harness, loaderPath: '/fake/tsx-loader.mjs', hostPort: 43127,
      getWebStartupUrl() { startupReads++; controller.abort(); return undefined },
      spawnProcess() { spawns++; throw new Error('must never start') },
    })
    assert.equal(startupReads, 1)
    assert.equal(spawns, 0)
    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /aborted before spawn/)
  })

  it('still terminates a child if cancellation occurs during a successful spawn call', async () => {
    const harness = harnessAt(temporaryDirectory('creator-mode-plus-spawn-cancel-'))
    const controller = new AbortController()
    let spawns = 0, kills = 0
    const result = await runDshx(['check', 'demo'], {
      agent: { id: 'cancelled-agent' }, signal: controller.signal,
    }, {
      harnessRoot: harness, loaderPath: '/fake/tsx-loader.mjs', hostPort: 43127,
      spawnProcess() {
        spawns++
        const child = new EventEmitter()
        child.stdout = new PassThrough()
        child.stderr = new PassThrough()
        child.kill = signal => { assert.equal(signal, 'SIGTERM'); kills++; queueMicrotask(() => child.emit('close', null)); return true }
        controller.abort()
        return child
      },
    })
    assert.equal(spawns, 1)
    assert.equal(kills, 1)
    assert.equal(result.exitCode, 1)
  })

  it('clears a stale hot-reload receipt when the fixed subprocess cannot start', async () => {
    const harness = harnessAt(temporaryDirectory('creator-mode-plus-hmr-spawn-failure-'))
    const sessionId = 'session-a'
    const receipt = join(harness, '.dshx', 'creator-plus', 'deliveries', `${createHash('sha256').update(sessionId).digest('hex')}.json`)
    mkdirSync(dirname(receipt), { recursive: true })
    writeFileSync(receipt, JSON.stringify({
      version: 1,
      sessionId,
      pluginId: 'demo',
      sourceBuilt: true,
      plan: { hostRestart: 'not-decided', handoff: { port: 43127 } },
      hotReload: { transactionId: 'stale-success', hostPort: 43127 },
    }))
    const spawnProcess = () => {
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.kill = () => true
      queueMicrotask(() => child.emit('error', new Error('spawn unavailable')))
      return child
    }
    await assert.rejects(
      runDshx(['hot-reload', 'demo', '--profile', 'web', '--port', '43127', '--json'], {
        agent: { id: sessionId },
        signal: new AbortController().signal,
      }, {
        harnessRoot: harness,
        loaderPath: '/fake/tsx-loader.mjs',
        hostPort: 43127,
        spawnProcess,
      }),
      /spawn unavailable/,
    )
    assert.equal(JSON.parse(readFileSync(receipt, 'utf8')).hotReload, undefined)
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

  it('accepts the authenticated Desktop proxy shape but rejects unmarked or foreign reports', async () => {
    let route, calls = 0
    installClientFailureRoute({webServer: {port: 43127, register(value) {route=value;return () => {}}}, effect(callback) {callback()}},
      {hostProfile: 'desktop', runClientFailureDshx: async () => {calls++;return {exitCode: 0, stdout: '{}'}}})
    for (const [extra, address, status] of [[{}, '127.0.0.1', 200], [{'x-dsh-creator-client': undefined}, '127.0.0.1', 403], [{origin: 'https://evil.example'}, '127.0.0.1', 403], [{}, '192.0.2.1', 403]]) {
      const req = new PassThrough();req.method='POST';req.headers={host:'127.0.0.1:43127','content-type':'application/json','x-dsh-creator-client':'1',...extra};req.socket={remoteAddress:address};req.end('{}')
      const res={writeHead(value) {this.status=value},end() {}};await route.handler(req,res);assert.equal(res.status,status)
    }
    assert.equal(calls,1)
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
      root: {},
      // Real Cordis creates distinct service proxies for each scoped lookup.
      get webServer() { return new Proxy(webServer, {}) },
      effect(callback) { releases.push(callback()) },
    }
    assert.notEqual(context.webServer, context.webServer)

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
    assert.equal(supportsDshxVersion('0.7.4'), false)
    assert.equal(supportsDshxVersion('0.7.5'), false)
    assert.equal(supportsDshxVersion('0.7.6'), false)
    assert.equal(supportsDshxVersion('0.7.7'), false)
    assert.equal(supportsDshxVersion('0.7.8'), false)
    assert.equal(supportsDshxVersion('0.7.9'), false)
    assert.equal(supportsDshxVersion('0.8.0'), false)
    assert.equal(supportsDshxVersion('0.9.0'), false)
    assert.equal(supportsDshxVersion('0.9.0-rc.1'), false)
    assert.equal(supportsDshxVersion('0.9.1'), true)
    assert.equal(supportsDshxVersion('0.9.1+build.4'), true)
    assert.equal(supportsDshxVersion('0.9.2'), true)
    assert.equal(supportsDshxVersion('0.10.0'), false)
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
    const compatible = harnessAt(temporaryDirectory('creator-mode-plus-compatible-'), '0.9.1')
    const runtime = resolveDshxRuntime({ harnessRoot: compatible, loaderPath: '/fake/tsx-loader.mjs' })
    assert.equal(runtime.dshxVersion, '0.9.1')
    assert.equal(runtime.bridgeVersion, 2)
    assert.equal(runtime.loader, '/fake/tsx-loader.mjs')
    assert.equal(runtime.contractId, 'dshx-v0.7/creator-bridge-v2')
    assert.equal(runtime.capabilities.includes('safe-profile-bundle-removal'), true)
    assert.equal(runtime.capabilities.includes('read-only-harness-update-plan'), true)
    assert.equal(runtime.capabilities.includes('single-home-web-host'), true)
    assert.equal(runtime.capabilities.includes('isolated-verify-home'), true)
    assert.equal(runtime.capabilities.includes('bounded-same-pid-server-hot-reload'), true)

    const incompatible = harnessAt(temporaryDirectory('creator-mode-plus-incompatible-'), '0.9.0')
    assert.throws(
      () => resolveDshxRuntime({ harnessRoot: incompatible, loaderPath: '/fake/tsx-loader.mjs' }),
      /dshx 0\.9\.0 is incompatible/,
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

  it('does not accept a version-only 0.9.1 checkout without hot-reload command, observer, and journal surfaces', () => {
    const legacy = harnessAt(temporaryDirectory('creator-mode-plus-legacy-'), '0.9.1')
    rmSync(join(legacy, 'tools/dshx/src/commands/hot-reload.ts'))
    rmSync(join(legacy, 'tools/dshx/src/runtime/hot-reload-observer.mjs'))
    rmSync(join(legacy, 'tools/dshx/src/internal/hot-reload-journal.ts'))
    assert.throws(
      () => resolveDshxRuntime({ harnessRoot: legacy, loaderPath: '/fake/tsx-loader.mjs' }),
      /missing required .*src\/commands\/hot-reload\.ts.*src\/internal\/hot-reload-journal\.ts.*src\/runtime\/hot-reload-observer\.mjs/,
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
      getWebStartupUrl: port => `http://127.0.0.1:${port}/?token=private-test-token`,
    })
    assert.equal(spawned.env.DSHX_WEB_STARTUP_URL, 'http://127.0.0.1:43127/?token=private-test-token')
    assert.doesNotMatch(spawned.env.DSHX_CREATOR_CONTEXT, /private-test-token/)
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
    assert.equal(messages[0].source.kind, 'plugin:dsh-creator-mode-plus')
    assert.equal(messages[0].source.plugin, undefined)
    assert.match(messages[0].content[0].text, /Attributed plugin: demo/)
    assert.deepEqual(calls[0], ['creator', 'watch', '--json'])
    assert.deepEqual(calls[2], ['creator', 'recovery', 'ack', incidentId, '--json'])

    await releaseCreatorClaim({ id: 'session-a' }, { runDshx: run, hostPort: 43127 })
    assert.deepEqual(calls[3], ['creator', 'release', '--json'])
  })

  it('arms recovery on agent/created and does not reject session creation when recovery fails', async () => {
    const events = []
    installCreatorRecovery({
      on(name, listener) { events.push({ name, listener }) },
      logger: { warn() {} },
    }, {
      runDshx: async () => { throw new Error('watch failed') },
    })
    assert.deepEqual(events.map(event => event.name), ['agent/created', 'agent/disposed'])
    const returned = events[0].listener({ agent: { id: 'session-a', steer() {} } })
    assert.equal(returned, undefined)
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})
