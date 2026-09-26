/**
 * Private Creator execute/request provenance, NOT execution permission.
 *
 * TRUSTED WIRING REQUIRED: only reviewed C apply code constructs this object
 * from its own four definition objects and keeps the authority private. Only
 * those real execute closures call enter(exec, args). A receives reader only,
 * through reviewed private wiring, not an arbitrary sourceVerified callback.
 * This public factory cannot prove who called it; same-process plugin code is
 * not sandboxed. Tool names merely select the fixed operation vocabulary.
 * Definition/execute identity, native exec/token identity and closure ownership
 * are the premises. No name, callId, JSON marker or allowed-once proves them.
 *
 * Public seams: ctx.root/fiber.assertActive/effect/on; tools.get(name, agent),
 * agents.get and sessions.get; Agent.ctx/session; tools/pre-execute, execute,
 * result/change; agent/disposed and session/disposed. Inject tools/agents/sessions.
 * Native pre signal is the caller signal. Tools may fuse a wrapper/timeout
 * signal before the body. We retain BOTH and construct a request signal from
 * them plus the private owner lifetime; no arbitrary supplied signal is bound.
 *
 * enter is single-use per native token. Owners are frozen empty objects, all
 * state is private. makeApprovalRequest is single-use per owner and binds the
 * exact frozen request, never its callId. inspect/revalidate/reader lookups are
 * live reads, not transferable grants; repeat lookup immediately before use.
 * Native Approval does NOT deduplicate repeated calls with the same request:
 * question deduplication and one-use grant/ticket consumption belong elsewhere.
 * Task/target binding is also a separate private C composition, not this API.
 * Closing dispatch, cancellation, definition replacement or producer disposal
 * invalidates the owner/request. No rules, approvals, execution method, disk,
 * CLI or activation here. Even activate-new-client provenance says NOTHING
 * about sealed-byte support or whether an operation can skip human review.
 */

const OPERATIONS = Object.freeze({
  dshx_check: 'check',
  dshx_activation_plan: 'activation-plan',
  dshx_hot_reload: 'hot-reload',
  dshx_activate_new_client: 'activate-new-client',
})
const CHANGES = new Set(['patch', 'manifest', 'preset', 'client', 'new-client', 'server', 'artifact'])
const object = value => value !== null && typeof value === 'object'
const signal = value => value instanceof AbortSignal

export class DevelopmentExecutionError extends Error {
  constructor(code) { super(code); this.name = 'DevelopmentExecutionError'; this.code = code; this.eligible = false }
}
const fail = code => { throw new DevelopmentExecutionError(code) }

/** ownedDefinitions is a trusted, private Map<fixed tool name, exact definition>. */
export function createDevelopmentExecutionAuthority(ctx, ownedDefinitions) {
  if (!ctx?.root || typeof ctx.on !== 'function' || typeof ctx.effect !== 'function'
    || typeof ctx.fiber?.assertActive !== 'function' || typeof ctx.tools?.get !== 'function'
    || typeof ctx.agents?.get !== 'function' || typeof ctx.sessions?.get !== 'function') fail('EXECUTION_SERVICES_UNAVAILABLE')
  if (!(ownedDefinitions instanceof Map) || ownedDefinitions.size !== 4) fail('EXECUTION_DEFINITIONS_INVALID')
  const definitions = new Map()
  for (const [name, definition] of ownedDefinitions) {
    if (!Object.hasOwn(OPERATIONS, name) || !object(definition)
      || definition.name !== name || typeof definition.execute !== 'function') fail('EXECUTION_DEFINITIONS_INVALID')
    definitions.set(name, { definition, execute: definition.execute, operation: OPERATIONS[name] })
  }
  const root = ctx.root
  const observations = new WeakMap()
  const owners = new WeakMap()
  const requests = new WeakMap()
  const active = new Set()
  // Native Tools tokens are non-registered Symbols, valid weak keys in the
  // current Host. Remember replay without retaining every completed call.
  const usedTokens = new WeakSet()
  const disposers = []
  let disposed = false

  function live(agent, session, agentCtx) {
    return object(agent) && object(session) && agent.ctx === agentCtx && agentCtx?.root === root
      && agent.session === session && ctx.agents.get(agent.id) === agent
      && ctx.sessions.get(session.id) === session && agent.id === session.id
  }
  function close(record, code) {
    if (!record || record.closed) return
    record.closed = code
    record.phase = 'closed'
    active.delete(record)
    record.callerSignal.removeEventListener('abort', record.onAbort)
    record.bodySignal?.removeEventListener('abort', record.onAbort)
    record.controller?.abort(new DevelopmentExecutionError(code))
  }
  function current(record) {
    if (disposed) fail('EXECUTION_PRODUCER_DISPOSED')
    try { ctx.fiber.assertActive() } catch { dispose(); fail('EXECUTION_PRODUCER_DISPOSED') }
    if (!record) fail('EXECUTION_UNOBSERVED')
    if (record.closed) fail(record.closed)
    const { exec, definition, execute, agent, session, agentCtx } = record
    let code
    if (record.phase !== 'dispatch') code = 'EXECUTION_NOT_ACTIVE'
    else if (!live(agent, session, agentCtx)) code = 'EXECUTION_AGENT_CHANGED'
    else if (exec.token !== record.token || exec.agent !== agent || exec.name !== record.name
      || exec.callId !== record.callId || exec.rootCallId !== record.rootCallId || exec.parent !== record.parent
      || exec.arguments !== record.args) code = 'EXECUTION_IDENTITY_CHANGED'
    else if (ctx.tools.get(record.name, agent) !== definition || definition.name !== record.name
      || definition.execute !== execute) code = 'EXECUTION_DEFINITION_CHANGED'
    else if (record.callerSignal.aborted || !signal(exec.signal) || exec.signal.aborted
      || record.bodySignal?.aborted || record.controller?.signal.aborted) code = 'EXECUTION_CANCELLED'
    else if (record.bodySignal && exec.signal !== record.bodySignal) code = 'EXECUTION_BODY_SIGNAL_CHANGED'
    if (code) { close(record, code); fail(code) }
    return record
  }
  function owned(owner) {
    const record = object(owner) ? owners.get(owner) : undefined
    if (!record) fail('EXECUTION_OWNER_UNISSUED')
    return current(record)
  }
  function argumentsFor(record, args) {
    if (args !== record.args || !object(args) || Array.isArray(args) || !Object.isFrozen(args)) fail('EXECUTION_ARGUMENTS_INVALID')
    const keys = Reflect.ownKeys(args)
    const expected = record.operation === 'activation-plan' ? ['name', 'change'] : ['name']
    if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) fail('EXECUTION_ARGUMENTS_INVALID')
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(args, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') fail('EXECUTION_ARGUMENTS_INVALID')
    }
    if (!/^[a-z][a-z0-9-]*$/.test(args.name)
      || (record.operation === 'activation-plan' && !CHANGES.has(args.change))) fail('EXECUTION_ARGUMENTS_INVALID')
    return Object.freeze({ operation: record.operation, pluginId: args.name,
      ...(record.operation === 'activation-plan' ? { change: args.change } : {}),
    })
  }

  function enter(exec, args) {
    const record = current(object(exec) ? observations.get(exec) : undefined)
    if (record.owner || usedTokens.has(record.token)) fail('EXECUTION_ALREADY_ENTERED')
    // Burn the native token even if an attempted closure entry has bad args.
    usedTokens.add(record.token)
    let operation
    try { operation = argumentsFor(record, args) }
    catch (error) { close(record, 'EXECUTION_ARGUMENTS_INVALID'); throw error }
    record.bodySignal = exec.signal
    record.bodySignal.addEventListener('abort', record.onAbort, { once: true })
    record.controller = new AbortController()
    const owner = Object.freeze(Object.create(null))
    record.owner = owner
    record.signal = AbortSignal.any([record.callerSignal, record.bodySignal, record.controller.signal])
    record.view = Object.freeze({
      ...operation, owner, agent: record.agent, session: record.session,
      toolName: record.name, callId: record.callId, rootCallId: record.rootCallId,
      token: record.token, callerSignal: record.callerSignal, bodySignal: record.bodySignal,
      signal: record.signal, evidenceBoundary: 'owned-execution-only-no-authorization',
    })
    owners.set(owner, record)
    current(record)
    return owner
  }
  function inspect(owner) { return owned(owner).view }
  function revalidate(owner) { owned(owner); return owner }
  // Revoke-only private composition: policy/peer loss can cancel the exact
  // already-issued request.signal. It cannot mint a new owner or reopen one.
  function revoke(owner) {
    const record = object(owner) ? owners.get(owner) : undefined
    if (!record) fail('EXECUTION_OWNER_UNISSUED')
    const wasLive = !record.closed
    close(record, 'EXECUTION_REVOKED')
    return wasLive
  }
  function makeApprovalRequest(owner, reason) {
    const record = owned(owner)
    if (record.request) fail('EXECUTION_REQUEST_ALREADY_BOUND')
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 4096)) fail('EXECUTION_REQUEST_REASON_INVALID')
    const request = Object.freeze({
      agent: record.agent, toolName: record.name, callId: record.callId,
      signal: record.signal, ...(reason === undefined ? {} : { reason }),
    })
    record.request = request
    requests.set(request, record)
    return request
  }
  function lookupRequest(request) {
    const record = object(request) ? requests.get(request) : undefined
    if (!record || record.request !== request) return undefined
    try {
      current(record)
      if (request.agent !== record.agent || request.toolName !== record.name
        || request.callId !== record.callId || request.signal !== record.signal) return undefined
      return record.view
    } catch { return undefined }
  }
  function dispose() {
    if (disposed) return
    disposed = true
    for (const record of [...active]) close(record, 'EXECUTION_PRODUCER_DISPOSED')
    for (const remove of disposers.splice(0).reverse()) remove()
  }

  try {
    disposers.push(ctx.on('tools/pre-execute', async (exec, next) => {
      const selected = definitions.get(exec.name)
      if (!disposed && selected && object(exec) && !observations.has(exec) && !usedTokens.has(exec.token)
        && typeof exec.token === 'symbol' && Symbol.keyFor(exec.token) === undefined
        && signal(exec.signal) && !exec.signal.aborted
        && live(exec.agent, exec.agent?.session, exec.agent?.ctx)
        && ctx.tools.get(exec.name, exec.agent) === selected.definition
        && selected.definition.execute === selected.execute) {
        const record = {
          ...selected, exec, name: exec.name, token: exec.token, args: exec.arguments,
          callId: exec.callId, rootCallId: exec.rootCallId, parent: exec.parent,
          agent: exec.agent, session: exec.agent.session, agentCtx: exec.agent.ctx,
          callerSignal: exec.signal, phase: 'pre', closed: undefined,
        }
        record.onAbort = () => close(record, 'EXECUTION_CANCELLED')
        exec.signal.addEventListener('abort', record.onAbort, { once: true })
        observations.set(exec, record)
        active.add(record)
      }
      return next() // Observation only: never return allow/ask or alter policy.
    }))
    disposers.push(ctx.on('tools/execute', async (exec, next) => {
      const record = observations.get(exec)
      if (!record || record.closed || record.phase !== 'pre') return next()
      record.phase = 'dispatch'
      try { return await next() }
      finally { close(record, 'EXECUTION_ENDED') }
    }))
    disposers.push(ctx.on('tools/result', exec => close(observations.get(exec), 'EXECUTION_ENDED')))
    disposers.push(ctx.on('tools/change', () => {
      for (const record of [...active]) {
        if (ctx.tools.get(record.name, record.agent) !== record.definition
          || record.definition.execute !== record.execute) close(record, 'EXECUTION_DEFINITION_CHANGED')
      }
    }, { global: true }))
    disposers.push(ctx.on('agent/disposed', ({ agent }) => {
      for (const record of [...active]) if (record.agent === agent) close(record, 'EXECUTION_AGENT_DISPOSED')
    }))
    disposers.push(ctx.on('session/disposed', session => {
      for (const record of [...active]) if (record.session === session) close(record, 'EXECUTION_SESSION_DISPOSED')
    }))
    ctx.effect(() => dispose)
  } catch (error) { dispose(); throw error }
  return Object.freeze({ enter, inspect, revalidate, revoke, makeApprovalRequest, lookupRequest,
    reader: Object.freeze({ lookupRequest }), dispose,
  })
}
