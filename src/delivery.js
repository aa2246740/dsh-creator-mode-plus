import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function receiptPath(root, sessionId) {
  return join(root, '.dshx', 'creator-plus', 'deliveries', `${createHash('sha256').update(sessionId).digest('hex')}.json`)
}
export function readDelivery(root, sessionId) {
  const file = receiptPath(root, sessionId)
  if (!existsSync(file)) return undefined
  const row = JSON.parse(readFileSync(file, 'utf8'))
  if (row.version !== 1 || row.sessionId !== sessionId || !/^[a-z][a-z0-9-]*$/.test(row.pluginId)) throw new Error('Invalid Creator+ delivery receipt')
  return row
}
function save(root, row) {
  const file = receiptPath(root, row.sessionId)
  mkdirSync(join(root, '.dshx', 'creator-plus', 'deliveries'), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(row), { mode: 0o600, flag: 'wx' })
  renameSync(temporary, file)
  return row
}

// Conservative package identity: content, not build timestamps. Never follow
// dependency or external symlinks. An unchanged re-check keeps its boot baseline.
export function deliveryFingerprint(directory) {
  const hash = createHash('sha256')
  function visit(relative = '') {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || ['node_modules', 'coverage'].includes(entry.name)) continue
      const name = join(relative, entry.name)
      if (entry.isDirectory()) visit(name)
      else {
        hash.update(JSON.stringify(name))
        hash.update(entry.isSymbolicLink() ? readlinkSync(join(directory, name)) : readFileSync(join(directory, name)))
      }
    }
  }
  visit()
  return hash.digest('hex')
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function boundedGenerationIds(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128
    || value.some(id => typeof id !== 'string' || !/^generation-[1-9][0-9]*$/.test(id))
    || new Set(value).size !== value.length) {
    throw new Error(`DSHX hot-reload ${label} is invalid`)
  }
  return value
}

function isoTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`DSHX hot-reload ${label} is invalid`)
  }
  return value
}

function validatedHotReload(result, pluginId, expectedPid, expectedPort) {
  const report = object(JSON.parse(result.stdout))
  const data = object(report?.data)
  const value = object(data?.result)
  const proof = object(value?.proof)
  const ready = object(proof?.ready)
  const reloadedReport = object(proof?.moduleReloaded)
  const reloaded = object(reloadedReport?.moduleReloaded)
  const hmrDisposedReport = object(proof?.hmrDisposed)
  const hmrDisposed = object(hmrDisposedReport?.hmrDisposed)
  const observerDisposedReport = object(proof?.observerDisposed)
  const observerDisposed = object(observerDisposedReport?.observerDisposed)
  const journal = object(value?.journal)
  const evidence = Array.isArray(data?.evidence) ? data.evidence : []
  const hash = proof?.hashBefore
  const artifacts = proof?.artifactHashes
  if (value?.targetScope !== 'root' || !Array.isArray(artifacts) || artifacts.length < 1 || artifacts.length > 32
    || artifacts.some(item => {
      const artifact = object(item)
      return typeof artifact?.path !== 'string' || artifact.path.startsWith('/')
        || artifact.path.includes('\\') || artifact.path.split('/').some(part => !part || part === '.' || part === '..' || part === 'node_modules')
        || typeof artifact.before !== 'string' || !/^[0-9a-f]{64}$/.test(artifact.before)
        || artifact.after !== artifact.before
    })
    || new Set(artifacts.map(item => item.path)).size !== artifacts.length
    || JSON.stringify(value.watchRoots) !== JSON.stringify(artifacts.map(item => item.path))) {
    throw new Error('DSHX hot-reload artifact-set or root-scope evidence is invalid')
  }
  if (report?.command !== 'hot-reload' || report?.ok !== true
    || !evidence.includes('HOST_MODULE_RELOADED') || data?.hostRestart !== false || data?.behaviorVerified !== false
    || value?.pluginId !== pluginId || value?.profile !== 'web'
    || value?.hostPid !== expectedPid || value?.hostPort !== expectedPort || value?.hostRestart !== false
    || typeof value?.transactionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.transactionId)
    || typeof value?.hmrEntryId !== 'string' || !/^dshx-hot-reload-hmr-[a-z0-9-]+$/.test(value.hmrEntryId)
    || proof?.sameHost !== true || proof?.bytesUnchanged !== true
    || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || proof?.hashAfter !== hash
    || journal?.status !== 'succeeded' || journal?.automaticRecovery !== false || journal?.cleanupProved !== true) {
    throw new Error('DSHX hot-reload did not return complete same-PID module evidence')
  }
  const identity = reportValue => reportValue?.transactionId === value.transactionId
    && reportValue?.pluginId === pluginId
    && reportValue?.hmrEntryId === value.hmrEntryId
    && reportValue?.expectedPid === expectedPid
    && reportValue?.pid === expectedPid
    && reportValue?.samePid === true
  if (!identity(ready) || ready.phase !== 'READY'
    || !identity(reloadedReport) || reloadedReport.phase !== 'MODULE_RELOADED'
    || !identity(hmrDisposedReport) || hmrDisposedReport.phase !== 'HMR_DISPOSED'
    || !identity(observerDisposedReport) || observerDisposedReport.phase !== 'OBSERVER_DISPOSED'
    || reloaded?.samePid !== true) {
    throw new Error('DSHX hot-reload observer identity or phase evidence is invalid')
  }
  const oldGenerationIds = boundedGenerationIds(reloaded.oldGenerationIds, 'oldGenerationIds')
  const targetGenerationIds = boundedGenerationIds(ready.targetGenerationIds, 'targetGenerationIds')
  const newGenerationIds = boundedGenerationIds(reloaded.newGenerationIds, 'newGenerationIds')
  const matchedGenerationIds = boundedGenerationIds(reloaded.hmrEventMatchedGenerationIds, 'hmrEventMatchedGenerationIds')
  if (!Array.isArray(ready.targetGenerationStates)
    || ready.targetGenerationStates.length !== targetGenerationIds.length
    || ready.targetGenerationStates.some((state, index) => {
      const target = object(state)
      return target?.generationId !== targetGenerationIds[index]
        || (target.state !== 'ACTIVE' && target.state !== 'FAILED')
    })) {
    throw new Error('DSHX hot-reload original generation states are invalid')
  }
  if (JSON.stringify(oldGenerationIds) !== JSON.stringify(targetGenerationIds)
    || JSON.stringify(matchedGenerationIds) !== JSON.stringify(targetGenerationIds)
    || newGenerationIds.length !== targetGenerationIds.length
    || newGenerationIds.some(id => targetGenerationIds.includes(id))
    || typeof ready.hmrGenerationId !== 'string'
    || hmrDisposed.generationId !== ready.hmrGenerationId
    || !Number.isFinite(proof.mtimeBeforeMs) || !Number.isFinite(proof.mtimeAfterMs)
    || proof.mtimeAfterMs <= proof.mtimeBeforeMs) {
    throw new Error('DSHX hot-reload generation evidence is inconsistent')
  }
  return {
    transactionId: value.transactionId,
    hostPid: expectedPid,
    hostPort: expectedPort,
    samePid: true,
    bytesUnchanged: true,
    entryHash: hash,
    artifactHashes: artifacts,
    targetScope: 'root',
    targetGenerationIds,
    targetGenerationStates: ready.targetGenerationStates,
    newGenerationIds,
    hmrEventAt: isoTimestamp(reloaded.hmrEventAt, 'hmrEventAt'),
    hmrDisposedAt: isoTimestamp(hmrDisposed.at, 'hmrDisposedAt'),
    observerDisposedAt: isoTimestamp(observerDisposed.at, 'observerDisposedAt'),
    cleanupProved: true,
    behavior: 'UNVERIFIED',
    recordedAt: Date.now(),
  }
}

/** Session-local journal only; this never activates a plugin or controls the Host. */
export function recordDelivery(root, args, result, sessionId, hostPid = process.pid) {
  if (!['activation-plan', 'check', 'hot-reload'].includes(args[0])) return undefined
  const previous = readDelivery(root, sessionId)
  const row = previous?.pluginId === args[1] ? previous : { version: 1, sessionId, pluginId: args[1], sourceBuilt: false }
  if (args[0] === 'hot-reload') {
    delete row.hotReload
    const port = Number(args[5])
    if (result.exitCode !== 0) {
      if (previous?.pluginId !== args[1]) return undefined
      row.hotReloadFailed = { at: Date.now(), hostPid, hostPort: port }
      return save(root, row)
    }
    try {
      row.hotReload = validatedHotReload(result, args[1], hostPid, port)
      delete row.hotReloadFailed
    } catch (error) {
      row.hotReloadFailed = { at: Date.now(), hostPid, hostPort: port }
      save(root, row)
      throw error
    }
    return save(root, row)
  }
  if (args[0] === 'activation-plan') {
    delete row.hotReload
    delete row.hotReloadFailed
    const report = JSON.parse(result.stdout)
    const data = report.data
    if (data?.facts && data?.decision) {
      row.plan = { change: data.change, packageDir: data.facts.packageDir, hasClient: data.facts.hasClient, handoff: data.facts.handoff, hostRestart: data.decision.hostRestart }
      row.plan.boundedHotReloadEligible = data.change === 'server'
        && data.decision.hostRestart === 'not-decided'
        && (result.exitCode === 0 || (Array.isArray(report.findings)
          && report.findings.some(item => item.level === 'error' && item.code === 'activation-blocker')
          && report.findings.filter(item => item.level === 'error').every(item => item.code === 'activation-blocker')))
      if (result.exitCode === 0) delete row.planFailed
      else row.planFailed = true
    } else if (result.exitCode !== 0) {
      delete row.plan
      row.planFailed = true
    } else {
      throw new Error('DSHX activation plan has no structured delivery facts')
    }
  } else {
    const fingerprint = result.exitCode === 0 && row.plan?.packageDir ? deliveryFingerprint(row.plan.packageDir) : undefined
    const unchanged = row.sourceBuilt && fingerprint !== undefined && fingerprint === row.fingerprint
    row.sourceBuilt = result.exitCode === 0
    if (!unchanged) {
      delete row.hotReload
      delete row.hotReloadFailed
      row.builtAt = Date.now()
      row.buildHostPid = hostPid
      row.fingerprint = fingerprint
    }
  }
  return save(root, row)
}

export function deliveryStatus(row, { pid = process.pid, startedAt = Date.now() - process.uptime() * 1000, port } = {}) {
  if (!row) return undefined
  const restart = row.plan?.hostRestart === 'required'
  const undecided = row.plan?.hostRestart === 'not-decided'
  const planFailed = row.planFailed === true
  const boundedHotReload = undecided && row.plan?.change === 'server'
    && (!planFailed || row.plan.boundedHotReloadEligible === true)
  const changed = row.sourceBuilt && pid !== row.buildHostPid && startedAt > row.builtAt
  const expectedPort = row.hotReload?.hostPort ?? row.hotReloadFailed?.hostPort ?? row.plan?.handoff?.port
  const wrongTarget = expectedPort !== undefined && expectedPort !== port
  const currentModuleProof = row.hotReload?.hostPid === pid
  const state = wrongTarget ? 'TARGET_MISMATCH' : row.hotReload ? 'RUNTIME_VERIFICATION_REQUIRED'
    : row.hotReloadFailed ? 'ACTIVATION_DECISION_REQUIRED'
      : !row.sourceBuilt ? 'SOURCE_BUILD_REQUIRED' : !row.plan ? 'ACTIVATION_PLAN_REQUIRED'
      : planFailed && !boundedHotReload ? 'ACTIVATION_PLAN_REQUIRED' : boundedHotReload ? 'HOT_RELOAD_READY' : undecided ? 'ACTIVATION_DECISION_REQUIRED'
      : restart && !changed ? 'AWAITING_LAUNCHER_RESTART' : 'RUNTIME_VERIFICATION_REQUIRED'
  const nextAction = state === 'HOT_RELOAD_READY'
    ? { tool: 'dshx_hot_reload', arguments: { name: row.pluginId } }
    : undefined
  return { pluginId: row.pluginId, state, currentPid: pid,
    ...nextAction ? { nextAction } : {},
    ...(row.plan?.packageDir !== undefined ? { sourcePath: row.plan.packageDir, targetScope: 'This plan and fixed ID refer only to sourcePath. A build in another directory does not check or activate this target. Read the existing-plugin trial workflow before promoting candidate changes.' } : {}),
    ...(row.buildHostPid !== undefined ? { previousPid: row.buildHostPid } : {}),
    ...(row.plan?.handoff !== undefined ? { handoff: row.plan.handoff } : {}),
    ...row.hotReload ? { moduleProof: {
      ...row.hotReload,
      evidenceState: currentModuleProof ? 'SAME_PID_AT_RELOAD_AND_CURRENT_PID_MATCHES' : 'HISTORICAL_HOST',
      currentHostPidMatches: currentModuleProof,
    } } : {},
    next: wrongTarget
      ? 'Resolve the Host target mismatch before activation or runtime verification. Preserve the source and report the exact target blocker.'
      : row.hotReload && !currentModuleProof
      ? 'The previous activation evidence belongs to an earlier runtime. Verify the requested behavior in the current session before marking the plugin complete.'
      : row.hotReload
      ? 'The implementation is active. Exercise the requested behavior before marking the plugin complete; activation alone is not functional acceptance.'
      : row.hotReloadFailed
        ? 'Activation failed or its evidence was incomplete. Resolve the failure, then obtain a new activation plan or changed-source check before retrying.'
      : !row.sourceBuilt
        ? 'Build the claimed sourcePath (resolve the claimed target first if no plan exists), then call dshx_check for this plugin id. A candidate built elsewhere does not satisfy this check. Keep delivery pending.'
      : boundedHotReload
        ? 'Call dshx_hot_reload now for this checked plugin, then exercise the changed feature. Browser-adapter readiness is independent.'
      : !row.plan || planFailed
        ? 'The activation plan remains pending. Obtain a successful plan before attempting activation or runtime verification.'
      : undecided
        ? 'Keep delivery pending: the changed component and activation method are unresolved. Call dshx_activation_plan for the claimed target.'
      : 'Exercise the requested plugin behavior in the current application. Mark it complete only when the requested features work; otherwise report the remaining work.' }
}

/** Bridge outcomes describe the next operation; raw CLI exit codes remain auditable. */
export function withOperationOutcome(args, result, delivery) {
  let report
  try { report = JSON.parse(result.stdout) } catch { /* Text commands have no JSON report. */ }
  const errors = Array.isArray(report?.findings) ? report.findings.filter(item => item.level === 'error') : []
  // DSHX 0.7.6 used exit 1 for an evidence request. Adapt only that exact
  // planning case; authentication, composition and contract errors stay errors.
  const evidenceRequest = args[0] === 'activation-plan' && report?.command === 'activation-plan'
    && report?.data?.change === 'server' && report?.data?.decision?.hostRestart === 'not-decided'
    && typeof report?.data?.facts?.packageDir === 'string'
    && result.exitCode === 1 && errors.length > 0 && errors.every(item => item.code === 'activation-blocker')
  const code = evidenceRequest ? 0 : result.exitCode
  const browser = args[0] === 'browser'
  const errorText = errors.map(item => String(item.message ?? '')).join('\n')
  const browserOnly = browser && /\bBROWSER_[A-Z_]+\b/.test(errorText) && !/\bWEB_[A-Z_]+\b/.test(errorText)
  const scope = browser ? (code !== 0 && !browserOnly ? 'host' : 'browser')
    : args[0] === 'check' ? 'source'
    : ['activation-plan', 'hot-reload', 'activate-new-client'].includes(args[0]) ? 'activation' : 'operation'
  const continueWith = delivery?.nextAction && (code === 0 || browserOnly) ? [delivery.nextAction] : []
  const outcome = {
    status: code !== 0 ? 'BLOCKED' : evidenceRequest || continueWith.length > 0 ? 'ACTION_REQUIRED' : 'SUCCEEDED',
    scope,
    continueWith,
    ...browserOnly ? { message: 'This browser adapter is unavailable. Continue independent build/check/activation work. Verify through an authorized, already-authenticated UI or the plugin service/tool when applicable; record only the verification that actually ran.' } : {},
  }
  return {
    outcome,
    ...result,
    ...evidenceRequest ? { exitCode: 0, commandExitCode: result.exitCode } : {},
    ...delivery ? { delivery } : {},
  }
}

/** Read-only, same-origin proof through Connection authentication; no credential leaves this function. */
export async function verifyDeliveryClient(row, port, startupUrl, request = fetch) {
  if (!row.plan?.hasClient) return { state: 'SERVER_BEHAVIOR_VERIFICATION_REQUIRED' }
  if (!startupUrl) return { state: 'WEB_AUTH_REQUIRED' }
  const origin = `http://127.0.0.1:${port}`
  const start = new URL(startupUrl)
  if (start.origin !== origin) return { state: 'TARGET_MISMATCH' }
  const get = (url, cookie) => request(url, { redirect: 'manual', headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(5_000) })
  let response = await get(start)
  let cookie = (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? '']).map(value => value.split(';')[0]).filter(Boolean).join('; ')
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location || !cookie) return { state: 'WEB_AUTH_REQUIRED' }
    const next = new URL(location, start)
    if (next.origin !== origin) return { state: 'TARGET_MISMATCH' }
    response = await get(next, cookie)
  }
  if ([401, 403].includes(response.status)) return { state: 'WEB_AUTH_REQUIRED' }
  if (response.status !== 200) return { state: 'WEB_PAGE_UNAVAILABLE', httpStatus: response.status }
  const html = await response.text()
  const match = /(?:window\s*\.\s*__DSH_BOOT__|globalThis(?:\s*\.\s*__DSH_BOOT__|\s*\[\s*["']__DSH_BOOT__["']\s*\]))\s*=\s*([\s\S]*?)<\/script>/.exec(html)
  if (!match) return { state: 'CLIENT_MANIFEST_MISSING' }
  const boot = JSON.parse(match[1].trim().replace(/;$/, ''))
  const entry = boot.entries?.find(entry => entry.id === row.pluginId)
  if (!entry || typeof entry.url !== 'string') return { state: 'CLIENT_ENTRY_MISSING' }
  const bundleUrl = new URL(entry.url, origin)
  if (bundleUrl.origin !== origin || !bundleUrl.pathname.startsWith('/plugins/')) return { state: 'TARGET_MISMATCH' }
  const bundle = await get(bundleUrl, cookie)
  if ([401, 403].includes(bundle.status)) return { state: 'WEB_AUTH_REQUIRED' }
  if (bundle.status !== 200) return { state: 'CLIENT_BUNDLE_UNAVAILABLE', httpStatus: bundle.status }
  const text = await bundle.text()
  if (!text.includes('__ModuleLoader__')) return { state: 'CLIENT_HANDOFF_INVALID' }
  return { state: 'CLIENT_MANIFEST_PRESENT', bundleServed: true, behavior: 'UNVERIFIED: exercise the changed feature in the authenticated current WebUI' }
}
