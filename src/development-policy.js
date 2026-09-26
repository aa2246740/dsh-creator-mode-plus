/**
 * Execution-bound policy lifetime, NEVER source provenance or execution permission.
 * A reviewed C producer owns this tracker privately. Source ownership is proved
 * separately by development-execution's exact definitions/real execute closure.
 *
 * Observe BEFORE next(): an old A review can await on the pre-execute unwind.
 * Never mutate exec.signal or abort the shared Agent signal. Every invalidation
 * closes only our signal, which C must combine into its owned request/executor.
 *
 * Reads use an explicitly injected producer dependency scope, not undeclared
 * agent.ctx services. Cordis service proxies are not stable identity objects;
 * each actual inject activation gets a private binding + effect lifetime.
 * Canonical policy switches are native committed Session events. Arbitrary
 * same-process mutation outside those contracts is not a sandboxed threat model.
 */
const EVENTS = new Set(['permission/preset', 'sandbox/mode', 'approval/policy'])
const MODES = new Set(['read-only', 'workspace-write', 'danger-full-access'])
const LEGACY = Object.freeze({
  'read-only': ['read-only', 'ask'],
  'workspace-write': ['workspace-write', 'ask'],
  'danger-full-access': ['danger-full-access', 'never'],
})
const object = value => value !== null && typeof value === 'object'
const isSignal = value => value instanceof AbortSignal
export class DevelopmentPolicyError extends Error {
  constructor(code) { super(code); this.name = 'DevelopmentPolicyError'; this.code = code; this.eligible = false }
}
const fail = code => { throw new DevelopmentPolicyError(code) }

/** Requires the C producer to declare agents/sessions; optional policy dependencies are declared below. */
export function createDevelopmentPolicyTracker(ctx) {
  if (!ctx?.root || typeof ctx.on !== 'function' || typeof ctx.inject !== 'function' || typeof ctx.effect !== 'function'
    || typeof ctx.fiber?.assertActive !== 'function' || typeof ctx.agents?.get !== 'function' || typeof ctx.sessions?.get !== 'function') fail('POLICY_SERVICES_UNAVAILABLE')
  const root = ctx.root, records = new WeakMap(), handles = new WeakMap(), active = new Set(), off = []
  let binding, disposed = false
  function close(record, code) {
    if (!record || record.closed) return
    record.closed = code
    active.delete(record)
    for (const detach of record.detach.splice(0)) detach()
    record.controller.abort(new DevelopmentPolicyError(code))
  }
  function liveAgent(agent, session = agent?.session) {
    return object(agent) && object(session) && agent.ctx?.root === root && agent.session === session
      && ctx.agents.get(agent.id) === agent && ctx.sessions.get(session.id) === session
  }
  function read(b, agent, session) {
    if (!b || !b.active || b.signal.aborted) fail('POLICY_BINDING_UNAVAILABLE')
    b.ctx.fiber.assertActive()
    if (!liveAgent(agent, session)) fail('POLICY_AGENT_CHANGED')
    const presets = b.ctx.permissionPresets, approval = b.ctx.approval, sandbox = b.ctx.sandboxPolicy
    if (typeof presets?.current !== 'function' || typeof presets?.resolve !== 'function'
      || typeof approval?.overrideOf !== 'function' || typeof sandbox?.resolve !== 'function') fail('POLICY_SERVICES_UNAVAILABLE')
    const preset = presets.current(session)
    const files = sandbox.resolve({ session })
    const policy = approval.overrideOf(session) ?? approval.config.policy ?? 'ask'
    if (!MODES.has(files.mode) || !['ask', 'never'].includes(policy)) fail('POLICY_STATE_UNSUPPORTED')
    if (preset === 'custom') fail('POLICY_PRESET_UNSUPPORTED')
    const spec = presets.resolve(preset) // Unknown presets never become legacy.
    if (spec.sandbox !== files.mode || spec.approval !== policy) fail('POLICY_STATE_MISMATCH')
    let route
    if (preset === 'approve-for-me') {
      if (policy !== 'ask') fail('POLICY_NEVER')
      route = 'sealed'
    } else {
      const expected = Object.hasOwn(LEGACY, preset) && LEGACY[preset]
      if (!expected || expected[0] !== files.mode || expected[1] !== policy) fail('POLICY_PRESET_UNSUPPORTED')
      route = 'legacy'
    }
    return Object.freeze({ preset, sandbox: files.mode, approval: policy, route })
  }
  // An unresolved pre observation remains unresolved for that invocation even
  // when a dependency appears later. Never adopt the newest binding on resume.
  const dependency = ctx.inject(['permissionPresets', 'approval', 'sandboxPolicy', 'agents', 'sessions'], scope => {
    if (disposed) return
    const controller = new AbortController()
    const b = { ctx: scope, active: true, signal: controller.signal, epochs: new WeakMap() }
    binding = b
    scope.effect(() => () => {
      b.active = false
      if (binding === b) binding = undefined
      controller.abort(new DevelopmentPolicyError('POLICY_BINDING_ENDED'))
      for (const record of [...active]) if (record.binding === b) close(record, 'POLICY_BINDING_ENDED')
    })
  })
  off.push(() => { void Promise.resolve(dependency.dispose()).catch(() => {}) }) // witnesses are revoked before async child cleanup
  function watch(record, signal, code) {
    if (signal.aborted) { close(record, code); return }
    const abort = () => close(record, code)
    signal.addEventListener('abort', abort, { once: true })
    record.detach.push(() => signal.removeEventListener('abort', abort))
  }
  // Epoch identity is per real Session + this exact dependency activation, not
  // per exec. Task rules may compare it across calls while each call still owns
  // its separate pre witness and non-revivable cancellation signal.
  function retireEpoch(b, session, epoch = b?.epochs.get(session)) {
    if (!epoch) return
    epoch.invalidated = true
    for (const record of [...active]) if (record.binding === b && record.session === session && record.policyEpoch === epoch.token) close(record, 'POLICY_EPOCH_CHANGED')
  }
  function epochFor(b, session, state) {
    const prior = b.epochs.get(session)
    if (prior && !prior.invalidated) {
      if (session.seq < prior.cursor || ['preset', 'sandbox', 'approval', 'route'].some(key => state[key] !== prior.state[key])) retireEpoch(b, session, prior)
      // This scan also covers changes with ZERO active executions and a pre
      // observer running before our session/event listener has received them.
      for (let seq = prior.cursor; !prior.invalidated && seq < session.seq; seq++) if (EVENTS.has(session.eventAt(seq)?.type)) retireEpoch(b, session, prior)
      if (!prior.invalidated) { prior.cursor = session.seq; return prior.token }
    }
    const epoch = { token: Object.freeze(Object.create(null)), cursor: session.seq, state, invalidated: false }
    b.epochs.set(session, epoch)
    return epoch.token
  }
  function current(record) {
    if (!record) fail('POLICY_EXECUTION_UNOBSERVED')
    if (record.closed) fail(record.closed)
    if (disposed) { close(record, 'POLICY_PRODUCER_ENDED'); fail(record.closed) }
    try { ctx.fiber.assertActive() } catch { close(record, 'POLICY_PRODUCER_ENDED'); fail(record.closed) }
    const exec = record.exec
    if (exec.token !== record.token || exec.agent !== record.agent || exec.name !== record.name
      || exec.arguments !== record.args || exec.callId !== record.callId || exec.rootCallId !== record.rootCallId
      || exec.parent !== record.parent || !liveAgent(record.agent, record.session)) close(record, 'POLICY_EXECUTION_CHANGED')
    if (!record.closed && (record.callerSignal.aborted || exec.signal?.aborted)) close(record, 'POLICY_CANCELLED')
    if (!record.closed && record.bodySignal && exec.signal !== record.bodySignal) close(record, 'POLICY_EXECUTION_CHANGED')
    const epoch = record.binding?.epochs.get(record.session)
    if (!record.closed && (epoch?.invalidated || epoch?.token !== record.policyEpoch || record.session.seq < record.floor)) close(record, 'POLICY_EPOCH_CHANGED')
    // Native log membership also catches revalidation from an earlier observer,
    // before our event callback has run. Endpoint equality cannot defeat ABA.
    for (let seq = record.floor; !record.closed && seq < record.session.seq; seq++) {
      if (EVENTS.has(record.session.eventAt(seq)?.type)) { retireEpoch(record.binding, record.session); close(record, 'POLICY_EPOCH_CHANGED') }
    }
    if (!record.closed) {
      try {
        const now = read(record.binding, record.agent, record.session)
        if (['preset', 'sandbox', 'approval', 'route'].some(key => now[key] !== record.initial[key])) retireEpoch(record.binding, record.session)
      } catch (error) { retireEpoch(record.binding, record.session); close(record, error instanceof DevelopmentPolicyError ? error.code : 'POLICY_BINDING_UNAVAILABLE') }
    }
    if (record.closed) fail(record.closed)
    return record
  }
  function pre(exec, next) {
    if (disposed || !object(exec) || records.has(exec) || !liveAgent(exec.agent)
      || typeof exec.token !== 'symbol' || !isSignal(exec.signal)) return next()
    const record = {
      exec, token: exec.token, agent: exec.agent, session: exec.agent.session, name: exec.name, args: exec.arguments,
      callId: exec.callId, rootCallId: exec.rootCallId, parent: exec.parent, callerSignal: exec.signal,
      binding, floor: exec.agent.session.seq, phase: 'pre', detach: [], controller: new AbortController(),
    }
    records.set(exec, record); active.add(record)
    try {
      record.initial = read(record.binding, record.agent, record.session)
      if (!record.closed) record.policyEpoch = epochFor(record.binding, record.session, record.initial)
    } catch (error) { retireEpoch(record.binding, record.session); close(record, error instanceof DevelopmentPolicyError ? error.code : 'POLICY_BINDING_UNAVAILABLE') }
    if (!record.closed) {
      watch(record, record.callerSignal, 'POLICY_CANCELLED')
      if (!record.closed) watch(record, record.binding.signal, 'POLICY_BINDING_ENDED')
    }
    return next() // no allow/deny/ask decision: capture must fail if this witness expired
  }
  function capture(exec) {
    const record = current(object(exec) && records.get(exec))
    if (record.phase !== 'dispatch') fail('POLICY_EXECUTION_NOT_ACTIVE')
    if (record.handle) fail('POLICY_ALREADY_CAPTURED')
    if (!isSignal(exec.signal)) { close(record, 'POLICY_CANCELLED'); fail(record.closed) }
    record.bodySignal = exec.signal
    watch(record, record.bodySignal, 'POLICY_CANCELLED')
    current(record)
    const handle = Object.freeze(Object.create(null))
    record.handle = handle; handles.set(handle, record)
    record.view = Object.freeze({ ...record.initial, policyEpoch: record.policyEpoch, agent: record.agent, session: record.session,
      signal: AbortSignal.any([record.callerSignal, record.bodySignal, record.controller.signal, record.binding.signal]),
      evidenceBoundary: 'policy-lifetime-only-no-authorization',
    })
    return handle
  }
  function owned(handle) {
    const record = object(handle) && handles.get(handle)
    if (!record) fail('POLICY_HANDLE_UNISSUED')
    current(record)
    if (record.phase !== 'dispatch') fail('POLICY_EXECUTION_NOT_ACTIVE')
    return record
  }
  function revalidateFor(handle, exec) {
    const record = object(handle) && handles.get(handle)
    if (!record) fail('POLICY_HANDLE_UNISSUED')
    if (record.exec !== exec || records.get(exec) !== record) fail('POLICY_EXECUTION_CHANGED')
    owned(handle)
    return handle
  }
  function dispose() {
    if (disposed) return
    disposed = true
    for (const record of [...active]) close(record, 'POLICY_PRODUCER_ENDED')
    for (const stop of off.splice(0).reverse()) stop()
  }
  off.push(ctx.on('tools/pre-execute', pre, { prepend: true }))
  off.push(ctx.on('tools/execute', async (exec, next) => {
    const record = records.get(exec)
    if (record && !record.closed) record.phase = 'dispatch'
    try { return await next() } finally { close(record, 'POLICY_EXECUTION_ENDED') }
  }))
  off.push(ctx.on('tools/result', exec => close(records.get(exec), 'POLICY_EXECUTION_ENDED')))
  off.push(ctx.on('session/event', (session, event) => {
    if (!EVENTS.has(event.type) || session.eventAt(event.seq) !== event) return
    const epoch = binding?.epochs.get(session)
    if (epoch && event.seq >= epoch.cursor) retireEpoch(binding, session, epoch)
    for (const record of [...active]) if (record.session === session && event.seq >= record.floor) close(record, 'POLICY_EPOCH_CHANGED')
  }, { global: true }))
  off.push(ctx.on('agent/disposed', ({ agent }) => { for (const record of [...active]) if (record.agent === agent) close(record, 'POLICY_AGENT_CHANGED') }, { global: true }))
  off.push(ctx.on('session/disposed', session => {
    retireEpoch(binding, session); binding?.epochs.delete(session)
    for (const record of [...active]) if (record.session === session) close(record, 'POLICY_AGENT_CHANGED')
  }, { global: true }))
  ctx.effect(() => dispose)
  return Object.freeze({ capture, inspect: handle => owned(handle).view, revalidate: handle => { owned(handle); return handle }, revalidateFor, dispose })
}
