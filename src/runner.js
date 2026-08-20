/** Fixed-argument bridge from DSH tools to the external dshx CLI. */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_CAPTURE_BYTES = 64 * 1024
const PLUGIN_ID = /^[a-z][a-z0-9-]*$/
const KINDS = new Set(['function', 'tool', 'client', 'object', 'class'])
const CHANGES = new Set(['patch', 'manifest', 'preset', 'client', 'new-client', 'server', 'artifact'])

export const CREATOR_BRIDGE_VERSION = 1
export const SUPPORTED_DSHX = Object.freeze({
  minimum: '0.5.1',
  maximumExclusive: '0.6.0',
})

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value)
  return match ? match.slice(1, 4).map(Number) : undefined
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

/** Return whether a dshx release implements this bridge's v1 command contract. */
export function supportsDshxVersion(version) {
  const parsed = parseVersion(version)
  const minimum = parseVersion(SUPPORTED_DSHX.minimum)
  const maximum = parseVersion(SUPPORTED_DSHX.maximumExclusive)
  return Boolean(parsed)
    && compareVersions(parsed, minimum) >= 0
    && compareVersions(parsed, maximum) < 0
}

function isAllowedArgs(args) {
  if (args.length === 1) return args[0] === 'status'
  if (args.length === 2) return args[0] === 'check' && PLUGIN_ID.test(args[1])
  if (args.length === 6 && args[0] === 'activate-new-client' && PLUGIN_ID.test(args[1])) {
    return args[2] === '--profile'
      && args[3] === 'web'
      && args[4] === '--port'
      && /^\d{1,5}$/.test(args[5])
      && Number(args[5]) >= 1
      && Number(args[5]) <= 65_535
  }
  if (args.length !== 4 || !PLUGIN_ID.test(args[1])) return false
  if (args[0] === 'init') return args[2] === '--kind' && KINDS.has(args[3])
  return args[0] === 'activation-plan' && args[2] === '--change' && CHANGES.has(args[3])
}

/** Resolve the current official Web profile's loopback port without model input. */
export function currentWebPort(argv = process.argv) {
  const webAlias = argv.includes('web')
  const profileIndex = argv.lastIndexOf('--profile')
  const webProfile = profileIndex >= 0 && argv[profileIndex + 1] === 'web'
  if (!webAlias && !webProfile) {
    throw new Error('dsh-creator-mode-plus: activation requires the current Web profile')
  }
  const portIndex = argv.lastIndexOf('--port')
  const value = portIndex >= 0 ? Number(argv[portIndex + 1]) : 3080
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('dsh-creator-mode-plus: current Web profile does not expose a valid TCP port')
  }
  return value
}

function isHarnessRoot(path) {
  return existsSync(join(path, 'apps/cli/src/bin.ts'))
    && existsSync(join(path, 'tools/dshx/src/cli.ts'))
    && existsSync(join(path, 'tools/dshx/package.json'))
}

function walkForHarness(start) {
  let cursor = resolve(start)
  while (true) {
    if (isHarnessRoot(cursor)) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) return undefined
    cursor = parent
  }
}

/** Resolve exactly one Harness checkout using the same authority rule as dshx. */
export function resolveHarnessRoot(options = {}) {
  if (options.harnessRoot) {
    const explicit = resolve(options.harnessRoot)
    if (!isHarnessRoot(explicit)) {
      throw new Error(`dsh-creator-mode-plus: --harness is not a checkout with tools/dshx: ${explicit}`)
    }
    return explicit
  }

  const candidates = []
  const addCandidate = (path, source) => {
    const root = resolve(path)
    const existing = candidates.find(candidate => candidate.root === root)
    if (existing) existing.sources.push(source)
    else candidates.push({ root, sources: [source] })
  }

  const configured = options.envRoot === undefined
    ? process.env.DSHX_HARNESS?.trim()
    : options.envRoot?.trim()
  if (configured) {
    if (!isHarnessRoot(configured)) {
      throw new Error(`dsh-creator-mode-plus: DSHX_HARNESS is not a Harness checkout with tools/dshx: ${resolve(configured)}`)
    }
    addCandidate(configured, 'env')
  }

  const configFile = options.configFile === undefined
    ? join(homedir(), '.config/dshx/harness')
    : options.configFile
  if (configFile && existsSync(configFile)) {
    const value = readFileSync(configFile, 'utf8').trim()
    if (value) {
      if (!isHarnessRoot(value)) {
        throw new Error(`dsh-creator-mode-plus: ${configFile} is not a Harness checkout with tools/dshx: ${resolve(value)}`)
      }
      addCandidate(value, 'config')
    }
  }

  const fromCwd = walkForHarness(options.cwd ?? process.cwd())
  if (fromCwd) addCandidate(fromCwd, 'cwd')

  const moduleDir = options.moduleDir ?? dirname(fileURLToPath(import.meta.url))
  const fromModule = walkForHarness(moduleDir)
  if (fromModule) addCandidate(fromModule, 'module')

  if (candidates.length === 0) {
    throw new Error('dsh-creator-mode-plus: no Harness checkout found; run dshx setup, pass --harness, or set DSHX_HARNESS')
  }
  if (candidates.length > 1) {
    const listed = candidates
      .map(candidate => `${candidate.sources.join('+')}: ${candidate.root}`)
      .join('; ')
    throw new Error(`dsh-creator-mode-plus: multiple Harness checkouts found (${listed}); pass an explicit --harness`)
  }
  return candidates[0].root
}

/** Resolve and version-gate the external dshx bridge implementation. */
export function resolveDshxRuntime(options = {}) {
  const root = resolveHarnessRoot(options)
  const packagePath = join(root, 'tools/dshx/package.json')
  const metadata = JSON.parse(readFileSync(packagePath, 'utf8'))
  if (metadata.name !== 'dsh-external-plugin-devkit') {
    throw new Error(`dsh-creator-mode-plus: unexpected package at ${packagePath}`)
  }
  if (!supportsDshxVersion(metadata.version)) {
    throw new Error(
      `dsh-creator-mode-plus: dshx ${metadata.version} is incompatible; `
      + `bridge v${CREATOR_BRIDGE_VERSION} requires >=${SUPPORTED_DSHX.minimum} <${SUPPORTED_DSHX.maximumExclusive}`,
    )
  }

  const cli = join(root, 'tools/dshx/src/cli.ts')
  const loader = options.loaderPath
    || createRequire(packagePath).resolve('tsx/esm')
  return {
    root,
    cli,
    loader,
    dshxVersion: metadata.version,
    bridgeVersion: CREATOR_BRIDGE_VERSION,
  }
}

function appendBounded(current, chunk) {
  const combined = Buffer.concat([Buffer.from(current, 'utf8'), chunk])
  if (combined.byteLength <= MAX_CAPTURE_BYTES) return combined.toString('utf8')
  return `[earlier output truncated]\n${combined.subarray(-MAX_CAPTURE_BYTES).toString('utf8')}`
}

/** Execute one allowlisted dshx operation without a shell or arbitrary argv. */
export function runDshx(args, signal, options = {}) {
  if (!Array.isArray(args) || !args.every(value => typeof value === 'string') || !isAllowedArgs(args)) {
    throw new Error('dsh-creator-mode-plus: refusing an operation outside bridge v1')
  }
  const runtime = resolveDshxRuntime(options)
  const argv = ['--import', runtime.loader, runtime.cli, ...args]
  const spawnProcess = options.spawnProcess ?? spawn
  return new Promise((resolveResult, reject) => {
    const child = spawnProcess(process.execPath, argv, {
      cwd: runtime.root,
      env: { ...process.env, DSHX_HARNESS: runtime.root },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk) })
    child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk) })

    const abort = () => { child.kill('SIGTERM') }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    child.once('error', reject)
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort)
      resolveResult({
        command: `dshx ${args.join(' ')}`,
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        dshxVersion: runtime.dshxVersion,
        creatorBridgeVersion: runtime.bridgeVersion,
        ...args[0] === 'activate-new-client'
          ? { hostPid: process.pid, hostPort: Number(args[5]) }
          : {},
      })
    })
  })
}
