/** Fixed-argument bridge from DSH tools to the external dshx CLI. */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CREATOR_BRIDGE_VERSION,
  DSHX_CONTRACT,
  inspectDshxCompatibility,
} from './compatibility.js'
import { forgetCreatorClaim, rememberCreatorClaim } from './safety.js'

export {
  CREATOR_BRIDGE_VERSION,
  DSHX_CONTRACT,
  inspectDshxCompatibility,
  SUPPORTED_DSHX,
  supportsDshxVersion,
} from './compatibility.js'

const MAX_CAPTURE_BYTES = 64 * 1024
const CLIENT_FAILURE_TIMEOUT_MS = 15_000
const PLUGIN_ID = /^[a-z][a-z0-9-]*$/
const KINDS = new Set(['function', 'tool', 'client', 'object', 'class'])
const CHANGES = new Set(['patch', 'manifest', 'preset', 'client', 'new-client', 'server', 'artifact'])

function isAllowedArgs(args) {
  if (args.length === 1) return args[0] === 'status'
  if (args.length === 2) return args[0] === 'check' && PLUGIN_ID.test(args[1])
  if (args.length === 3) {
    return args[0] === 'creator'
      && (((args[1] === 'claim' || args[1] === 'remove') && PLUGIN_ID.test(args[2]))
        || ((args[1] === 'watch' || args[1] === 'release') && args[2] === '--json'))
  }
  if (args.length === 4) {
    if (args[0] === 'creator') {
      return (args[1] === 'recovery'
          && args[2] === 'pull'
          && args[3] === '--json')
        || (args[1] === 'scaffold'
          && PLUGIN_ID.test(args[2])
          && KINDS.has(args[3]))
    }
    if (!PLUGIN_ID.test(args[1])) return false
    return args[0] === 'activation-plan'
      && args[2] === '--change'
      && CHANGES.has(args[3])
  }
  if (args.length === 5) {
    return args[0] === 'creator'
      && args[1] === 'recovery'
      && args[2] === 'ack'
      && /^[0-9a-f-]{36}$/.test(args[3])
      && args[4] === '--json'
  }
  if (args.length === 6 && args[0] === 'activate-new-client' && PLUGIN_ID.test(args[1])) {
    return args[2] === '--profile'
      && args[3] === 'web'
      && args[4] === '--port'
      && /^\d{1,5}$/.test(args[5])
      && Number(args[5]) >= 1
      && Number(args[5]) <= 65_535
  }
  return false
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

function contextFromExecution(exec, hostPort) {
  const sessionId = exec?.agent?.id
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('dsh-creator-mode-plus: bridge v2 requires the calling DSH session identity')
  }
  const callId = typeof exec.callId === 'string' ? exec.callId : undefined
  const rootCallId = typeof exec.rootCallId === 'string' ? exec.rootCallId : callId
  const workspaceRoot = exec?.agent?.session?.header?.cwd
  if (workspaceRoot !== undefined && (
    typeof workspaceRoot !== 'string'
    || workspaceRoot.length === 0
    || workspaceRoot.length > 4_096
    || !isAbsolute(workspaceRoot)
  )) {
    throw new Error('dsh-creator-mode-plus: bridge v2 requires an absolute bounded session workspace')
  }
  return {
    sessionId,
    ...callId ? { callId } : {},
    ...rootCallId ? { rootCallId } : {},
    hostPid: process.pid,
    hostParentPid: process.ppid,
    hostPort,
    bridgeVersion: CREATOR_BRIDGE_VERSION,
    ...workspaceRoot === undefined ? {} : { workspaceRoot: resolve(workspaceRoot) },
  }
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
  const compatibility = inspectDshxCompatibility(root)

  const cli = join(root, 'tools/dshx/src/cli.ts')
  const loader = options.loaderPath
    || createRequire(compatibility.packagePath).resolve('tsx/esm')
  return {
    root,
    cli,
    loader,
    dshxVersion: compatibility.dshxVersion,
    bridgeVersion: CREATOR_BRIDGE_VERSION,
    contractId: compatibility.contractId,
    capabilities: compatibility.capabilities,
  }
}

function appendBounded(current, chunk) {
  const combined = Buffer.concat([Buffer.from(current, 'utf8'), chunk])
  if (combined.byteLength <= MAX_CAPTURE_BYTES) return combined.toString('utf8')
  return `[earlier output truncated]\n${combined.subarray(-MAX_CAPTURE_BYTES).toString('utf8')}`
}

/** Execute one allowlisted dshx operation with structured session provenance. */
export function runDshx(args, exec, options = {}) {
  if (!Array.isArray(args) || !args.every(value => typeof value === 'string') || !isAllowedArgs(args)) {
    throw new Error('dsh-creator-mode-plus: refusing an operation outside bridge v2')
  }
  const runtime = resolveDshxRuntime(options)
  const argv = ['--import', runtime.loader, runtime.cli, ...args]
  const spawnProcess = options.spawnProcess ?? spawn
  const hostPort = options.hostPort ?? currentWebPort()
  const creatorContext = contextFromExecution(exec, hostPort)
  const signal = exec?.signal
  return new Promise((resolveResult, reject) => {
    const child = spawnProcess(process.execPath, argv, {
      cwd: runtime.root,
      env: {
        ...process.env,
        DSHX_HARNESS: runtime.root,
        DSHX_CREATOR_CONTEXT: JSON.stringify(creatorContext),
      },
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
        dshxContract: runtime.contractId,
        dshxCapabilities: runtime.capabilities,
        ...args[0] === 'activate-new-client'
          ? { hostPid: process.pid, hostPort: Number(args[5]) }
          : {},
      })
    })
  })
}

/** Forward one browser-loader failure through fixed argv and Host-owned identity. */
export function runClientFailureDshx(report, options = {}) {
  const runtime = resolveDshxRuntime(options)
  const argv = ['--import', runtime.loader, runtime.cli, 'creator', 'client-failure', '--json']
  const spawnProcess = options.spawnProcess ?? spawn
  const { DSHX_CREATOR_CONTEXT: _discardContext, DSHX_CREATOR_CLIENT_FAILURE: _discardFailure, ...baseEnv } = process.env
  return new Promise((resolveResult, reject) => {
    const child = spawnProcess(process.execPath, argv, {
      cwd: runtime.root,
      env: {
        ...baseEnv,
        DSHX_HARNESS: runtime.root,
        DSHX_CREATOR_CLIENT_FAILURE: JSON.stringify(report),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, options.timeoutMs ?? CLIENT_FAILURE_TIMEOUT_MS)
    child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk) })
    child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk) })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolveResult({
        command: 'dshx creator client-failure',
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout: stdout.trim(),
        stderr: timedOut ? `${stderr.trim()}\nclient-failure recovery timed out`.trim() : stderr.trim(),
        dshxVersion: runtime.dshxVersion,
        creatorBridgeVersion: runtime.bridgeVersion,
        dshxContract: runtime.contractId,
        dshxCapabilities: runtime.capabilities,
      })
    })
  })
}

/** Refresh the session/plugin lease before every named plugin operation. */
export async function runClaimedDshx(pluginId, args, exec, options = {}) {
  const claim = await runDshx(['creator', 'claim', pluginId], exec, options)
  if (claim.exitCode !== 0) return claim
  rememberCreatorClaim(exec, pluginId)
  const result = await runDshx(args, exec, options)
  return { ...result, claim: { sessionId: exec.agent.id, pluginId } }
}

function recoveryText(incident) {
  const lines = [
    `[Creator+ Guardian incident ${incident.id}]`,
    incident.summary,
    incident.pluginId ? `Attributed plugin: ${incident.pluginId}` : 'Attributed plugin: ambiguous',
    `Rollback: ${incident.rollback}`,
    incident.previousPid ? `Previous Host pid: ${incident.previousPid}` : undefined,
    incident.recoveredPid ? `Recovered Host pid: ${incident.recoveredPid}` : undefined,
    incident.port ? `Recovered Web port: ${incident.port}` : undefined,
    incident.logExcerpt ? `Diagnostic excerpt:\n${incident.logExcerpt}` : undefined,
    'Inspect the preserved source and incident evidence, fix the plugin, run dshx_check, and only then retry the classified activation branch.',
  ]
  return lines.filter(Boolean).join('\n')
}

function pluginMessage(text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([{ type: 'text', text }]),
    source: Object.freeze({ kind: 'plugin', plugin: 'dsh-creator-mode-plus' }),
  })
}

/** Deliver pending external incidents when their exact Creator+ session starts or resumes. */
export async function deliverCreatorRecovery(agent, options = {}) {
  const callId = `creator-recovery-${randomUUID()}`
  const exec = {
    agent,
    callId,
    rootCallId: callId,
    signal: options.signal ?? AbortSignal.timeout(15_000),
  }
  const run = options.runDshx ?? runDshx
  const watch = await run(['creator', 'watch', '--json'], exec, options)
  if (watch.exitCode !== 0) throw new Error(watch.stderr || watch.stdout || 'Creator+ Guardian arm failed')
  const pull = await run(['creator', 'recovery', 'pull', '--json'], exec, options)
  if (pull.exitCode !== 0) throw new Error(pull.stderr || pull.stdout || 'Creator+ recovery pull failed')
  const decoded = JSON.parse(pull.stdout || '{}')
  const incidents = Array.isArray(decoded?.data?.incidents) ? decoded.data.incidents : []
  for (const incident of incidents) {
    agent.steer(pluginMessage(recoveryText(incident)))
    const ack = await run(['creator', 'recovery', 'ack', incident.id, '--json'], exec, options)
    if (ack.exitCode !== 0) throw new Error(ack.stderr || ack.stdout || `Creator+ recovery ack failed for ${incident.id}`)
  }
  return incidents
}

export async function releaseCreatorClaim(agent, options = {}) {
  const callId = `creator-release-${randomUUID()}`
  const result = await (options.runDshx ?? runDshx)(['creator', 'release', '--json'], {
    agent,
    callId,
    rootCallId: callId,
    signal: AbortSignal.timeout(5_000),
  }, options)
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout || 'Creator+ claim release failed')
  forgetCreatorClaim({ agent })
}

/** Register fail-contained recovery delivery on the preset-scoped Agent lifecycle. */
export function installCreatorRecovery(ctx, options = {}) {
  if (typeof ctx.on !== 'function') return
  ctx.on('agent/session-start', ({ agent }) => {
    void deliverCreatorRecovery(agent, options).catch((error) => {
      const message = `dsh-creator-mode-plus: recovery delivery failed: ${error instanceof Error ? error.message : String(error)}`
      if (ctx.logger?.warn) ctx.logger.warn(message)
      else console.warn(message)
    })
  })
  ctx.on('agent/disposed', ({ agent }) => {
    void releaseCreatorClaim(agent, options).catch((error) => {
      const message = `dsh-creator-mode-plus: claim release failed: ${error instanceof Error ? error.message : String(error)}`
      if (ctx.logger?.warn) ctx.logger.warn(message)
      else console.warn(message)
    })
  })
}
