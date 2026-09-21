/** Human-confirmed ownership handoff, using public DSH services only. */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { currentWebPort, resolveHarnessRoot, runDshx } from './runner.js'
import { rememberCreatorClaim } from './safety.js'
const BROKERS = Symbol.for('dshx.creator-ownership-fence.v1')
const passive = new Set(['dshx_status', 'dshx_request_takeover'])
const liveJob = job => job.status === 'running' || job.status === 'stopping'
const get = (ctx, name) => typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]
function registry() {
  if (!globalThis[BROKERS]) Object.defineProperty(globalThis, BROKERS, { value: new WeakMap() })
  return globalThis[BROKERS]
}
async function backend(options) {
  const root = resolveHarnessRoot(options)
  const path = join(root, 'tools/dshx/src/internal/creator-claims.mjs')
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
  return { root, store: await import(`${pathToFileURL(path).href}?sha256=${digest}`) }
}
function descendants(agents, owner) {
  if (!owner) return []
  const result = [owner]
  for (let i = 0; i < result.length; i++) for (const agent of agents.list()) {
    if (!result.includes(agent) && agents.isOwnedBy(agent.id, result[i])) result.push(agent)
  }
  return result
}
function fenced(broker, agent) {
  const state = broker.store.readClaimState(broker.root)
  if (broker.store.sessionFence(state, agent.id)) return true
  const agents = get(broker.ctx, 'agents')
  return agents.list().some(owner => broker.store.sessionFence(state, owner.id) && descendants(agents, owner).includes(agent))
}
function reason(broker, exec) {
  if (!exec.agent || passive.has(exec.name)) return undefined
  try { if (!fenced(broker, exec.agent)) return undefined }
  catch { return 'CREATOR_STATE_UNREADABLE: 无法核验开发权限，请先修复认领记录。' }
  return 'CREATOR_OWNERSHIP_REVOKED: 此开发对话已被接管或正在移交，工具执行已停止。请在接管后的对话继续；重新接手需调用 dshx_request_takeover 并请用户确认。'
}
/** Root-lifetime fence intentionally survives preset disposal/HMR. It protects
 * already-loaded old sessions, and is disposed only with the Host's root. */
export async function ensureTakeoverFence(ctx, options = {}) {
  const host = ctx.root ?? ctx, { root, store } = await backend(options)
  let broker = registry().get(host)
  if (broker) {
    if (broker.root !== root) throw new Error('CREATOR_HOST_ROOT_CHANGED')
    broker.store = store
    broker.evaluate = reason
    return broker
  }
  if (typeof host.tools?.guard !== 'function' || !get(host, 'agents')) throw new Error('CREATOR_TAKEOVER_GUARD_UNAVAILABLE')
  broker = { ctx: host, root, store, active: new Map(), evaluate: reason }
  registry().set(host, broker)
  host.effect(() => {
    const guard = host.tools.guard(exec => broker.evaluate(broker, exec))
    const wrapper = host.on('tools/execute', async (exec, next) => {
      const denied = broker.evaluate(broker, exec)
      if (denied) throw new Error(denied)
      if (!exec.agent) return next()
      const id = exec.agent.id
      broker.active.set(id, (broker.active.get(id) ?? 0) + 1)
      try { return await next() }
      finally { const n = broker.active.get(id) - 1; if (n) broker.active.set(id, n); else broker.active.delete(id) }
    })
    return () => { guard(); wrapper(); registry().delete(host) }
  }, 'Creator ownership fence (Host lifetime)')
  return broker
}
export function installTakeoverFence(ctx, options = {}) {
  ctx.effect(async () => { await ensureTakeoverFence(ctx, options) }, 'Creator takeover fence setup')
}
function titleOf(session) {
  const events = session?.snapshotEvents?.() ?? []
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'session/title' && typeof events[i].data?.title === 'string') return events[i].data.title
  return '未命名对话'
}
function ownedJobs(jobs, agent) { return jobs?.list(agent).filter(job => job.ownerSession === agent.id && liveJob(job)) ?? [] }
function busy(ctx, agents, broker) {
  const jobs = get(ctx, 'jobs'), terminals = get(ctx, 'terminals')
  return agents.some(agent => agent.status !== 'idle' || broker.active.has(agent.id) || ownedJobs(jobs, agent).length || terminals?.hasOwned(agent))
}
async function bounded(promise, signal, ms, timeoutMessage = 'CREATOR_STOP_TIMEOUT: 旧任务尚未停止，原认领保留。') {
  let timer, listener
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)
      listener = () => reject(new Error('CREATOR_TAKEOVER_CANCELLED'))
      if (signal?.aborted) listener(); else signal?.addEventListener('abort', listener, { once: true })
    })])
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', listener) }
}
async function drain(ctx, owner, broker, signal) {
  const agents = get(ctx, 'agents'), jobs = get(ctx, 'jobs'), terminals = get(ctx, 'terminals')
  const seen = new Set()
  for (let pass = 0; pass < 4; pass++) {
    const group = descendants(agents, owner)
    for (const agent of group) { seen.add(agent.id); agent.cancel({ kind: 'user' }) }
    const waits = []
    for (const agent of group) {
      for (const job of ownedJobs(jobs, agent)) {
        jobs.kill(job.id, agent, 'Creator+ user-confirmed takeover')
        waits.push(jobs.wait(job.id, 20_000, agent, signal).then(result => { if (liveJob(result)) throw new Error('CREATOR_BACKGROUND_JOB_STILL_RUNNING') }))
      }
      for (const terminal of terminals?.list(agent) ?? []) waits.push(terminals.kill(agent, terminal.id, 'Creator+ user-confirmed takeover'))
      waits.push(agent.whenIdle())
    }
    await bounded(Promise.all(waits), signal, 25_000)
    const current = descendants(agents, owner)
    if (current.every(agent => seen.has(agent.id)) && !busy(ctx, current, broker)) return [...seen]
  }
  throw new Error('CREATOR_OWNER_NOT_QUIESCENT: 原认领保留，请稍后重试。')
}
export async function requestTakeover(ctx, pluginId, exec, options = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(pluginId)) throw new Error('invalid plugin id')
  const agent = exec?.agent, agents = get(ctx, 'agents'), questions = get(ctx, 'userQuestions')
  if (!agent || agents?.get(agent.id) !== agent || !agents.roots().includes(agent) || typeof questions?.ask !== 'function') throw new Error('CREATOR_HUMAN_CONFIRMATION_UNAVAILABLE')
  const broker = await ensureTakeoverFence(ctx, options), { root, store } = broker
  const priorFence = store.sessionFence(store.readClaimState(root), agent.id)
  if (priorFence && priorFence.pluginId !== pluginId) throw new Error(`CREATOR_SESSION_REVOKED: 此旧对话只能重新申请接管 ${priorFence.pluginId}；开发其他插件请使用新对话。`)
  const run = options.runDshx ?? runDshx, hostPort = options.hostPort ?? currentWebPort()
  // External supervisor verifies this exact unique Host before any handoff.
  const watch = await run(['creator', 'watch', '--json'], exec, { ...options, hostPort })
  if (watch.exitCode !== 0) return watch
  const snapshot = store.inspectClaim(root, pluginId)
  if (snapshot.claim?.sessionId === agent.id && !store.sessionFence(store.readClaimState(root), agent.id)) return { exitCode: 0, state: 'ALREADY_OWNED', pluginId }
  const owner = snapshot.claim ? agents.get(snapshot.claim.sessionId) : undefined
  if (snapshot.claim && !owner && (!snapshot.claim.hostPid || store.processAlive(snapshot.claim.hostPid))) throw new Error('CREATOR_OWNER_STATE_UNKNOWN: 无法核实旧持有者已停止。请用外部 dshx creator inspect 查看持有者；未更改认领。')
  if (owner && descendants(agents, owner).includes(agent)) throw new Error('CREATOR_DELEGATED_TAKEOVER_FORBIDDEN')
  const previous = owner?.session ?? get(ctx, 'sessions')?.get(snapshot.claim?.sessionId)
  const group = descendants(agents, owner), running = busy(ctx, group, broker)
  const approve = running ? '停止旧任务并接管' : '接管到当前对话'
  const id = randomUUID(), createdAt = Date.now()
  const questionSignal = exec.signal ? AbortSignal.any([exec.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000)
  const answer = await bounded(questions.ask({ agent, signal: questionSignal, questions: [{
    id, header: '插件接管', question: `将 ${pluginId} 的开发权限移交到当前对话？`,
    detail: `原对话：${snapshot.claim ? titleOf(previous) : '当前无持有者'}\n会话：${snapshot.claim?.sessionId ?? '无'}\n工作区：${previous?.header?.cwd ?? '未记录'}\n最后刷新：${snapshot.claim?.lastSeenAt ?? '无'}\n状态：${running ? '仍有运行中的任务' : '已空闲'}\n\n接管会停止原开发对话及其子任务、后台命令和终端，并阻止该对话继续调用工具。源码和对话记录保留。`,
    options: [{ label: '取消', description: '保持现有认领' }, { label: approve, description: '停止旧开发任务后移交权限' }], multiSelect: false,
  }] }), questionSignal, 300_000, 'CREATOR_CONFIRMATION_EXPIRED: 请重新申请接管。')
  const selected = answer?.answers
  if (!Array.isArray(selected) || selected.length !== 1 || selected[0].id !== id || selected[0].custom || selected[0].selected?.length !== 1 || selected[0].selected[0] !== approve) return { exitCode: 1, state: 'TAKEOVER_CANCELLED', pluginId }
  if (exec.signal?.aborted || Date.now() - createdAt > 300_000) throw new Error('CREATOR_CONFIRMATION_EXPIRED: 请重新申请接管。')
  if (owner && agents.get(owner.id) !== owner) throw new Error('CREATOR_OWNER_CHANGED')
  if (!running && busy(ctx, descendants(agents, owner), broker)) throw new Error('CREATOR_OWNER_STARTED: 旧对话已开始运行，请重新确认停止并接管。')
  const context = { sessionId: agent.id, hostPid: process.pid, hostPort }
  const fencedSessions = [...new Set([...(snapshot.claim ? [snapshot.claim.sessionId] : []), ...descendants(agents, owner).map(item => item.id)])].filter(value => value !== agent.id)
  const grant = store.beginTakeover(root, snapshot, context, fencedSessions, id)
  try {
    const stopped = owner ? await drain(ctx, owner, broker, exec.signal) : fencedSessions
    if (exec.signal?.aborted) throw new Error('CREATOR_TAKEOVER_CANCELLED')
    store.markTakeoverReady(root, grant.id, grant.grant, stopped)
    const result = await run(['creator', 'takeover', pluginId, '--json'], exec, { ...options, hostPort, takeoverGrant: grant })
    if (result.exitCode === 0) rememberCreatorClaim(exec, pluginId)
    return result
  } finally { store.abortTakeover(root, grant.id, grant.grant, 'handoff did not commit') }
}
