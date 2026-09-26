/**
 * Process-local task LIFETIME, never a permission or a human-consent detector.
 *
 * Producer integration: declare public Cordis inject ['agents', 'sessions'];
 * create this tracker in that producer's effect-owned context BEFORE a turn.
 * Only the real Creator execute closure may pass its native Tools execution.
 * The caller must separately prove that closure and obtain official human
 * once/task/remember consent. No event, source.kind, taskId, sessionId, token
 * copied into JSON, or successful capture() authorizes any operation.
 *
 * Supported scope: one observed AgentLoop turn, one freshly delivered direct
 * user input, one exact Agent + Session + producer lifetime. The first public
 * agent/turn-stopping ends it, even if a goal/Grok listener steers another step
 * before turn/end. Automatic continuation is NOT presumed to be the same task.
 * Any new inbox input or user/message AFTER capture revokes that handle; only
 * another fresh direct input can anchor a new handle. Ordinary tool results,
 * system prompt updates and uninterrupted tool steps do not renew or revoke it.
 *
 * A fresh input must be observed on Session's live committed inbox splice,
 * claimed by the real AgentLoop, admitted in its pre-step, and committed as an
 * append user/message. Constructor seed/fork/history and plugin inputs cannot
 * supply an anchor. FirstLiveSeq is a freshness boundary, NOT consent proof.
 * Starting/reloading this tracker mid-turn fails closed; no history adoption.
 *
 * Public seams used (current checkout): Session.firstLiveSeq/eventAt/seq/id;
 * Agent.session/ctx/status; agents.get/sessions.get/list; session/created,
 * session/event/disposed;
 * agent/inbox/claimed/discarded, agent/pre-step, agent/turn-stopping,
 * agent/status/disposed/error; tools/pre-execute and tools/execute waterfalls;
 * producer Context.effect and Fiber.assertActive. No AgentLoop private phase,
 * synthetic task id, polling, persistence, wall-clock task guessing or new tool.
 */

export const DEVELOPMENT_TASK_SCOPE = 'creator-host-turn-direct-input-v1'
const MAX_PENDING_INPUTS = 256
const MAX_CLAIMED_INPUTS = 256
const object = value => value !== null && typeof value === 'object'
const direct = message => object(message) && message.role === 'user' && message.source?.kind === 'user'
const signalLike = signal => object(signal) && typeof signal.aborted === 'boolean'
  && typeof signal.addEventListener === 'function' && typeof signal.removeEventListener === 'function'

export class DevelopmentTaskError extends Error {
  constructor(code) {
    super(code)
    this.name = 'DevelopmentTaskError'
    this.code = code
    this.eligible = false
  }
}
const fail = code => { throw new DevelopmentTaskError(code) }

/** Returns { capture(exec), revalidate(handle, exec), dispose() }; no grant API. */
export function createDevelopmentTaskTracker(ctx) {
  if (!ctx?.root || typeof ctx.on !== 'function' || typeof ctx.effect !== 'function'
    || typeof ctx.fiber?.assertActive !== 'function'
    || typeof ctx.agents?.get !== 'function' || typeof ctx.sessions?.get !== 'function'
    || typeof ctx.sessions?.list !== 'function') {
    fail('TASK_LIFECYCLE_UNAVAILABLE')
  }
  const root = ctx.root
  const states = new Map()
  const observed = new WeakMap()
  // Existing history is a baseline, not replayable live input. seq is a
  // public append offset; reading it does not adopt any historical task.
  for (const session of ctx.sessions.list()) observed.set(session, session.seq - 1)
  const pending = new WeakMap()
  const executions = new WeakMap()
  const issued = new WeakMap()
  const disposers = []
  let disposed = false

  function registered(agent, session = agent?.session) {
    return object(agent) && object(session) && agent.session === session
      && agent.id === session.id && agent.ctx?.root === root
      && ctx.agents.get(agent.id) === agent && ctx.sessions.get(session.id) === session
  }

  function revokeHandle(state, code) {
    const record = state.task
    state.task = undefined
    if (record && !record.controller.signal.aborted) record.controller.abort(new DevelopmentTaskError(code))
  }

  function close(state, code) {
    if (!state || state.closed) return
    state.closed = true
    state.anchor = undefined
    state.claimed.clear()
    state.admitted.clear()
    state.detachSignal?.()
    // Keep a closed turn tombstone until its turn/end: stopping listeners may
    // continue the SAME turn. No later pre-step can resurrect this lifetime.
    revokeHandle(state, code)
  }

  function inputChanged(state) {
    if (!state || state.closed) return
    if (state.task) {
      state.anchor = undefined // before abort observers can reenter capture()
      revokeHandle(state, 'TASK_NEW_INPUT')
    }
  }

  function pendingOf(session) {
    let inputs = pending.get(session)
    if (!inputs) pending.set(session, inputs = new Map())
    return inputs
  }

  function onSessionEvent(session, event) {
    if (disposed || !object(session) || !object(event)
      || !Number.isSafeInteger(event.seq) || event.seq < session.firstLiveSeq
      || event.seq !== session.seq - 1 || session.eventAt(event.seq) !== event) return
    const previous = observed.get(session)
    if (previous !== undefined && event.seq <= previous) return
    if (previous !== undefined && event.seq !== previous + 1) {
      close(states.get(session), 'TASK_EVENT_GAP')
      pending.delete(session)
      observed.set(session, event.seq)
      return
    }
    // Session publishes AFTER committing. An earlier listener may reenter the
    // consumer before this listener runs: current() refuses that unseen tail.
    try { applySessionEvent(session, event) }
    catch {
      close(states.get(session), 'TASK_EVENT_INVALID')
      pending.delete(session)
    } finally { observed.set(session, event.seq) }
  }

  function applySessionEvent(session, event) {
    const agent = ctx.agents.get(session.id)
    if (!registered(agent, session)) return
    let state = states.get(session)
    if (event.type === 'agent/inbox/spliced') {
      for (const message of event.data.inserted) {
        inputChanged(state)
        // A new direct input makes even an uncaptured previous anchor stale.
        if (direct(message) && state) state.anchor = undefined
        if (!direct(message) || typeof message.id !== 'string' || message.id.length > 4096) continue
        const inputs = pendingOf(session)
        if (inputs.size >= MAX_PENDING_INPUTS) inputs.delete(inputs.keys().next().value)
        inputs.set(message.id, event.seq)
      }
      return
    }
    if (event.type === 'turn/start') {
      close(state, 'TASK_TURN_REPLACED')
      if (agent.status !== 'running') return
      state = {
        agent, session, agentContext: agent.ctx, start: event, turn: event.data.turn,
        signal: undefined, detachSignal: undefined, closed: false, task: undefined,
        anchor: undefined, claimed: new Map(), admitted: new Set(), step: undefined,
      }
      states.set(session, state)
      return
    }
    if (!state || state.agent !== agent) return
    if (event.type === 'turn/end') {
      close(state, 'TASK_TURN_ENDED')
      states.delete(session)
    } else if (event.type === 'session/end-seed') {
      close(state, 'TASK_HISTORY_BOUNDARY')
    } else if (event.type === 'step/start') {
      state.step = event
    } else if (event.type === 'user/message') {
      inputChanged(state)
      if (direct(event.data)) state.anchor = undefined
      if (!state.closed && direct(event.data) && state.admitted.delete(event.data.id)
        && event.surfaceOp === 'append' && event.sourceEventSeqs === undefined
        && state.step?.data.turn === state.turn && state.step.seq < event.seq) {
        state.anchor = event
      }
    }
  }

  function onClaimed({ agent, message, turn }) {
    if (disposed || !registered(agent)) return
    const session = agent.session
    const inputs = pending.get(session)
    const insertionSeq = inputs?.get(message.id)
    inputs?.delete(message.id)
    const state = states.get(session)
    if (!state || state.closed || state.agent !== agent || state.turn !== turn
      || insertionSeq === undefined || !direct(message)) return
    if (state.claimed.size >= MAX_CLAIMED_INPUTS) {
      close(state, 'TASK_TRACKING_LIMIT')
      return
    }
    state.claimed.set(message.id, insertionSeq)
  }

  function onPreStep({ agent, turn, messages, signal }, next) {
    const state = object(agent) && states.get(agent.session)
    if (!disposed && state && !state.closed && registered(agent)
      && state.agent === agent && state.turn === turn && signalLike(signal)) {
      if (state.signal && state.signal !== signal) close(state, 'TASK_TURN_SIGNAL_CHANGED')
      if (!state.closed && !state.signal) {
        state.signal = signal
        const abort = () => close(state, 'TASK_TURN_CANCELLED')
        signal.addEventListener('abort', abort, { once: true })
        state.detachSignal = () => signal.removeEventListener('abort', abort)
      }
      if (signal.aborted) close(state, 'TASK_TURN_CANCELLED')
      if (!state.closed) {
        state.admitted = new Set(messages.filter(message => direct(message)
          && state.claimed.has(message.id)).map(message => message.id))
        state.claimed.clear()
      }
    }
    return next() // observation only; never return allow/enter ourselves
  }

  function onPreExecute(exec, next) {
    const state = object(exec.agent) && states.get(exec.agent.session)
    if (!disposed && state && !state.closed && registered(exec.agent)
      && state.agent === exec.agent && typeof exec.token === 'symbol'
      && exec.signal === state.signal && !state.signal?.aborted && state.anchor) {
      executions.set(exec, {
        state, token: exec.token, agent: exec.agent, input: state.anchor,
        callerSignal: exec.signal, phase: 'pre',
      })
    }
    return next() // preserve native deny/ask/guards and other listeners
  }

  async function onExecute(exec, next) {
    const observation = executions.get(exec)
    if (observation?.phase === 'pre') observation.phase = 'dispatch'
    try { return await next() }
    finally { if (observation) observation.phase = 'closed' }
  }

  function onDisposedAgent({ agent }) {
    if (!object(agent)) return
    close(states.get(agent.session), 'TASK_AGENT_DISPOSED')
    states.delete(agent.session)
    pending.delete(agent.session)
  }

  function dispose() {
    if (disposed) return
    disposed = true
    for (const state of states.values()) close(state, 'TASK_PRODUCER_DISPOSED')
    states.clear()
    for (const off of disposers.splice(0).reverse()) {
      try { off() } catch { /* revoked first; a stale queued listener is inert */ }
    }
  }

  function current(exec) {
    if (disposed) fail('TASK_PRODUCER_DISPOSED')
    try { ctx.fiber.assertActive() } catch { dispose(); fail('TASK_PRODUCER_DISPOSED') }
    const observation = object(exec) && executions.get(exec)
    if (!observation) fail('TASK_EXECUTION_UNOBSERVED')
    if (observation.phase !== 'dispatch') fail('TASK_EXECUTION_NOT_ACTIVE')
    const state = observation.state
    if (observed.get(state.session) !== state.session.seq - 1) fail('TASK_EVENT_PENDING')
    if (state.closed || states.get(state.session) !== state) fail('TASK_TURN_ENDED')
    if (exec.token !== observation.token || exec.agent !== observation.agent
      || !registered(state.agent, state.session) || state.agent.ctx !== state.agentContext
      || state.agent.status !== 'running') fail('TASK_AGENT_MISMATCH')
    if (state.signal?.aborted || observation.callerSignal.aborted || exec.signal?.aborted) {
      close(state, 'TASK_TURN_CANCELLED')
      fail('TASK_TURN_CANCELLED')
    }
    if (!state.anchor || state.anchor !== observation.input) fail('TASK_INPUT_CHANGED')
    if (state.session.eventAt(state.start.seq) !== state.start
      || state.session.eventAt(state.anchor.seq) !== state.anchor) fail('TASK_HISTORY_CHANGED')
    // New queued direct input already supersedes this task, even before the
    // next step consumes it. Do not guess that multiple queued prompts agree.
    if ([...state.agent.inbox.nextTurn, ...state.agent.inbox.nextStep].some(direct)) {
      state.anchor = undefined
      revokeHandle(state, 'TASK_NEW_INPUT')
      fail('TASK_INPUT_CHANGED')
    }
    return state
  }

  function capture(exec) {
    const state = current(exec)
    if (state.task) return state.task.handle
    const controller = new AbortController()
    const handle = Object.freeze({
      scope: DEVELOPMENT_TASK_SCOPE,
      sessionId: state.session.id,
      turn: state.turn,
      turnStartSeq: state.start.seq,
      userInputSeq: state.anchor.seq,
      signal: controller.signal,
      evidenceBoundary: 'lifecycle-only-no-authorization',
    })
    const record = { state, handle, input: state.anchor, controller }
    state.task = record
    issued.set(handle, record)
    return handle
  }

  function revalidate(handle, exec) {
    const record = object(handle) && issued.get(handle)
    if (!record) fail('TASK_HANDLE_UNISSUED')
    if (record.controller.signal.aborted) fail(record.controller.signal.reason.code)
    const state = current(exec)
    if (record.state !== state || state.task !== record || record.input !== state.anchor) {
      fail('TASK_HANDLE_MISMATCH')
    }
    return handle
  }

  try {
    disposers.push(ctx.on('session/created', session => {
      if (!disposed && !observed.has(session) && ctx.sessions.get(session.id) === session) {
        observed.set(session, session.seq - 1)
      }
    }))
    disposers.push(ctx.on('session/event', onSessionEvent))
    disposers.push(ctx.on('agent/inbox/claimed', onClaimed))
    disposers.push(ctx.on('agent/inbox/discarded', ({ agent, message }) => pending.get(agent.session)?.delete(message.id)))
    disposers.push(ctx.on('agent/pre-step', onPreStep, { prepend: true }))
    disposers.push(ctx.on('tools/pre-execute', onPreExecute, { prepend: true }))
    disposers.push(ctx.on('tools/execute', onExecute, { prepend: true }))
    disposers.push(ctx.on('agent/turn-stopping', ({ agent, turn }) => {
      const state = states.get(agent.session)
      if (state?.turn === turn) close(state, 'TASK_TURN_STOPPING')
    }, { prepend: true }))
    disposers.push(ctx.on('agent/status', ({ agent, status }) => {
      if (status !== 'running') close(states.get(agent.session), 'TASK_AGENT_IDLE')
    }))
    disposers.push(ctx.on('agent/error', ({ agent }) => close(states.get(agent.session), 'TASK_AGENT_ERROR')))
    disposers.push(ctx.on('agent/disposed', onDisposedAgent))
    disposers.push(ctx.on('session/disposed', session => {
      close(states.get(session), 'TASK_SESSION_DISPOSED')
      states.delete(session)
      pending.delete(session)
    }))
    ctx.effect(() => dispose, 'creator development task lifetime')
  } catch (error) {
    dispose()
    throw error
  }
  return Object.freeze({ capture, revalidate, dispose })
}
