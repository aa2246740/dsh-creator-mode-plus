import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { apply } from '../src/index.js'
import {
  CREATOR_BRIDGE_VERSION,
  currentWebPort,
  resolveDshxRuntime,
  resolveHarnessRoot,
  runDshx,
  supportsDshxVersion,
} from '../src/runner.js'

const temporaryRoots = []

function temporaryDirectory(label) {
  const path = mkdtempSync(join(tmpdir(), label))
  temporaryRoots.push(path)
  return path
}

function harnessAt(root, version = '0.5.1') {
  mkdirSync(join(root, 'apps/cli/src'), { recursive: true })
  mkdirSync(join(root, 'tools/dshx/src'), { recursive: true })
  writeFileSync(join(root, 'apps/cli/src/bin.ts'), '')
  writeFileSync(join(root, 'tools/dshx/src/cli.ts'), '')
  writeFileSync(join(root, 'tools/dshx/package.json'), JSON.stringify({
    name: 'dsh-external-plugin-devkit',
    version,
  }))
  return root
}

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Creator Bridge v1', () => {
  it('registers only the five fixed tools and rejects process control', () => {
    const registered = []
    apply({ tools: { register(tool) { registered.push(tool) } } })

    assert.deepEqual(registered.map(tool => tool.name), [
      'dshx_scaffold',
      'dshx_check',
      'dshx_activation_plan',
      'dshx_activate_new_client',
      'dshx_status',
    ])
    assert.equal(registered.some(tool => /start|stop|restart|shell|command/.test(tool.name)), false)
    assert.throws(
      () => registered[1].execute({ name: '../escape' }, { signal: undefined }),
      /lower-case kebab-case/,
    )
    assert.throws(() => runDshx(['restart']), /outside bridge v1/)
    assert.throws(
      () => runDshx(['activate-new-client', 'demo', '--profile', 'web', '--port', 'not-a-port']),
      /outside bridge v1/,
    )
  })

  it('derives only the current official Web port', () => {
    assert.equal(currentWebPort(['node', 'bin.ts', 'web', '--port', '43127', '--no-open']), 43127)
    assert.equal(currentWebPort(['node', 'bin.ts', '--profile', 'web']), 3080)
    assert.throws(() => currentWebPort(['node', 'bin.ts', 'headless']), /current Web profile/)
    assert.throws(() => currentWebPort(['node', 'bin.ts', 'web', '--port', '0']), /valid TCP port/)
  })

  it('accepts only the declared DSHX compatibility range', () => {
    assert.equal(CREATOR_BRIDGE_VERSION, 1)
    assert.equal(supportsDshxVersion('0.5.0'), false)
    assert.equal(supportsDshxVersion('0.5.1'), true)
    assert.equal(supportsDshxVersion('0.5.99'), true)
    assert.equal(supportsDshxVersion('0.6.0'), false)
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
    const compatible = harnessAt(temporaryDirectory('creator-mode-plus-compatible-'), '0.5.1')
    const runtime = resolveDshxRuntime({ harnessRoot: compatible, loaderPath: '/fake/tsx-loader.mjs' })
    assert.equal(runtime.dshxVersion, '0.5.1')
    assert.equal(runtime.bridgeVersion, 1)
    assert.equal(runtime.loader, '/fake/tsx-loader.mjs')

    const incompatible = harnessAt(temporaryDirectory('creator-mode-plus-incompatible-'), '0.6.0')
    assert.throws(
      () => resolveDshxRuntime({ harnessRoot: incompatible, loaderPath: '/fake/tsx-loader.mjs' }),
      /dshx 0\.6\.0 is incompatible/,
    )
  })
})
