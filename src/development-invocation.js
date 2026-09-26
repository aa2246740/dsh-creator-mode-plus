/** Private C execute composition. No model/HTTP owner enrollment, grant writer,
 * script runner, argv or automatic approval fallback. Optional creatorExecution
 * is the public Cordis seam; its captured peer is private to one C generation.
 */
import { types as utilTypes } from 'node:util'
import { createDevelopmentTargetResolver } from './development-target.js'
import { DevelopmentTaskError } from './development-tasks.js'

const object = value => value !== null && typeof value === 'object'
const signal = value => value instanceof AbortSignal
const PROTOCOL = 'creator-owned-execution-v1'
const SYNC = ['lookupTarget', 'readRegisteredTarget', 'prepare', 'release', 'dispose']
const METHODS = [...SYNC, 'authorize', 'dispatch']
export class DevelopmentInvocationError extends Error {
  constructor(code, cause) { super(code, cause ? { cause } : undefined); this.name = 'DevelopmentInvocationError'; this.code = code; this.eligible = false }
}
const fail = code => { throw new DevelopmentInvocationError(code) }
function synchronous(value) {
  if (utilTypes.isPromise(value)) { void Promise.prototype.then.call(value, undefined, () => {}); fail('INVOCATION_ASYNC_PRIVATE_READER') }
  if (typeof value?.then === 'function') fail('INVOCATION_ASYNC_PRIVATE_READER')
  return value
}
function waitFor(promise, lifetime) {
  if (lifetime.aborted) { void Promise.resolve(promise).catch(() => {}); return Promise.reject(new DevelopmentInvocationError('INVOCATION_CANCELLED')) }
  return new Promise((resolve, reject) => {
    const abort = () => { detach(); reject(new DevelopmentInvocationError('INVOCATION_CANCELLED')) }
    const detach = () => lifetime.removeEventListener('abort', abort)
    lifetime.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(value => { detach(); resolve(value) }, error => { detach(); reject(error) })
    if (lifetime.aborted) abort()
  })
}

/** Called by real C apply only; exact owner/exec associations never leave here. */
export function createDevelopmentInvocations(ctx, { authority, tasks, policy, getHarnessRoot } = {}) {
  if (!ctx?.root || typeof ctx.inject !== 'function' || typeof ctx.effect !== 'function' || typeof ctx.on !== 'function'
    || typeof getHarnessRoot !== 'function' || typeof authority?.revoke !== 'function'
    || typeof tasks?.capture !== 'function' || typeof policy?.revalidateFor !== 'function') fail('INVOCATION_SERVICES_UNAVAILABLE')
  const root = ctx.root, producer = new AbortController(), byOwner = new WeakMap(), byExec = new WeakMap(), preBindings = new WeakMap(), opened = new WeakSet(), active = new Set(), connections = new Set()
  let binding, disposed = false

  function cleanup(frame) {
    // May run again if cancellation occurred synchronously INSIDE prepare and
    // its returned preparation was assigned only afterwards.
    if (frame.preparation && !frame.released) {
      frame.released = true
      try { synchronous(frame.connection.methods.release(frame.owner, frame.preparation)) }
      catch (error) { frame.cleanupError ??= error }
    }
    if (frame.compilation && !frame.inputReleased) {
      frame.inputReleased = true
      frame.targets.releaseCompilation(frame.compilation)
    }
    frame.targets?.dispose()
  }
  function close(frame) {
    if (!frame.closed) {
      frame.closed = true
      active.delete(frame); byOwner.delete(frame.owner); byExec.delete(frame.exec)
      for (const detach of frame.detach.splice(0)) detach()
      authority.revoke(frame.owner) // Never abort the shared Agent/body signal.
    }
    cleanup(frame)
  }
  function watch(frame, lifetime) {
    if (!signal(lifetime) || lifetime.aborted) { close(frame); fail('INVOCATION_CANCELLED') }
    const cancel = () => close(frame)
    lifetime.addEventListener('abort', cancel, { once: true })
    frame.detach.push(() => lifetime.removeEventListener('abort', cancel))
  }
  function connectionLive(connection) {
    if (!connection || !connection.active || disposed || producer.signal.aborted || !connection.binding.active
      || connection.signal.aborted || connection.peer.signal !== connection.signal) fail('INVOCATION_PEER_ENDED')
    connection.binding.scope.fiber.assertActive()
  }
  function check(frame, target = true) {
    if (!frame || frame.closed || disposed || producer.signal.aborted) fail('INVOCATION_CLOSED')
    ctx.fiber.assertActive()
    const source = authority.inspect(frame.owner), mode = policy.inspect(frame.policyHandle)
    // Read-only exact-exec validation consumes no new pre witness. capture
    // itself remains single-use, including for the same real native exec.
    if (policy.revalidateFor(frame.policyHandle, frame.exec) !== frame.policyHandle || source.token !== frame.exec.token
      || source.agent !== frame.exec.agent || source.session !== frame.exec.agent.session
      || source.operation !== frame.operation || source.pluginId !== frame.pluginId
      || mode.policyEpoch !== frame.policyEpoch || mode.route !== frame.route || mode.signal !== frame.policySignal
      || source.signal !== frame.signal || frame.signal.aborted) fail('INVOCATION_BINDING_CHANGED')
    if (frame.task) tasks.revalidate(frame.task, frame.exec)
    if (frame.connection) connectionLive(frame.connection)
    if (target && frame.snapshot) frame.targets.revalidate(frame.snapshot, frame.exec)
    return source
  }
  function inspectOwner(connection, owner) {
    const frame = object(owner) ? byOwner.get(owner) : undefined
    if (!frame || frame.connection !== connection || !frame.request || !frame.snapshot) return undefined
    try {
      check(frame)
      return Object.freeze({ exactNativeRequest: frame.request, binding: frame.snapshot.binding,
        operation: frame.operation, policyEpoch: frame.policyEpoch, signal: frame.signal,
        ...(frame.task ? { taskHandle: frame.task, taskSignal: frame.task.signal } : {}) })
    } catch { close(frame); return undefined }
  }
  function compilationInput(connection, owner, handle) {
    const frame = object(owner) ? byOwner.get(owner) : undefined
    if (!frame || frame.connection !== connection || frame.compilation !== handle || !frame.request) return undefined
    try { check(frame, false); return frame.targets.compilationInput(handle, frame.exec) }
    catch { close(frame); return undefined }
  }
  function endConnection(connection) {
    if (!connection.active) return
    connection.active = false
    connection.signal?.removeEventListener('abort', connection.cancel)
    for (const frame of [...active]) if (frame.connection === connection) close(frame)
    connections.delete(connection)
    try { synchronous(connection.methods?.dispose()) } catch { /* Its signal already prevents reuse. */ }
  }
  function connect(b) {
    if (!b || !b.active || !b.facade || disposed) fail('INVOCATION_EXECUTOR_UNAVAILABLE')
    b.scope.fiber.assertActive()
    if (b.connection?.active && !b.connection.signal.aborted) {
      connectionLive(b.connection)
      return b.connection
    }
    // Reconnection is allowed only while OPENING A NEW invocation. Existing
    // frames and their reader closures retain their original connection.
    const connection = { binding: b, active: true }
    const reader = Object.freeze({ root, signal: producer.signal,
      inspectOwner: owner => inspectOwner(connection, owner),
      compilationInput: (owner, handle) => compilationInput(connection, owner, handle) })
    let peer
    try {
      peer = synchronous(b.connect.call(b.facade, reader))
      if (!object(peer) || !signal(peer.signal) || peer.signal.aborted
        || !Array.isArray(peer.supportedOperations) || peer.supportedOperations.length !== 1
        || peer.supportedOperations[0] !== 'hot-reload') fail('INVOCATION_EXECUTOR_INVALID')
      const methods = Object.create(null)
      for (const name of METHODS) {
        const method = peer[name]
        if (typeof method !== 'function' || (SYNC.includes(name) && utilTypes.isAsyncFunction(method))) fail('INVOCATION_EXECUTOR_INVALID')
        methods[name] = (...args) => method.apply(peer, args)
      }
      Object.assign(connection, { peer, signal: peer.signal, methods, supportedOperations: Object.freeze([...peer.supportedOperations]) })
      connection.cancel = () => endConnection(connection)
      connections.add(connection); b.connection = connection
      connection.signal.addEventListener('abort', connection.cancel, { once: true })
      connectionLive(connection)
      return connection
    } catch (error) {
      connection.active = false
      connections.delete(connection)
      if (peer && typeof peer.dispose === 'function') { try { synchronous(peer.dispose()) } catch {} }
      throw error instanceof DevelopmentInvocationError ? error : new DevelopmentInvocationError('INVOCATION_EXECUTOR_UNAVAILABLE', error)
    }
  }
  const dependency = ctx.inject(['creatorExecution'], scope => {
    if (disposed) return
    const b = { scope, active: true }
    try {
      const facade = scope.creatorExecution
      if (facade?.protocol === PROTOCOL && facade.root === root && typeof facade.connectProducer === 'function'
        && !utilTypes.isAsyncFunction(facade.connectProducer)) Object.assign(b, { facade, connect: facade.connectProducer })
    } catch { /* Invalid optional service closes sealed only, never tool registration. */ }
    binding = b
    scope.effect(() => () => {
      b.active = false
      if (binding === b) binding = undefined
      for (const connection of [...connections]) if (connection.binding === b) endConnection(connection)
    })
  })
  // Observe, but never connect/prepare/request, before an earlier A reviewer
  // unwinds. A body may not borrow a service or existing peer installed while
  // its original native pre was waiting. These are private activation objects,
  // not repeatedly-created Cordis service proxies.
  const stopPre = ctx.on('tools/pre-execute', (exec, next) => {
    if (!disposed && !preBindings.has(exec)) {
      const b = binding, connection = b?.connection
      preBindings.set(exec, { binding: b,
        connection: connection?.active && !connection.signal.aborted ? connection : undefined })
    }
    return next()
  }, { prepend: true })

  function open(owner, exec, policyHandle) {
    if (disposed || opened.has(exec) || byOwner.has(owner)) fail('INVOCATION_ALREADY_OPENED')
    const source = authority.inspect(owner), mode = policy.inspect(policyHandle)
    if (policy.revalidateFor(policyHandle, exec) !== policyHandle || source.token !== exec.token || source.agent !== exec.agent
      || source.session !== exec.agent.session) fail('INVOCATION_BINDING_CHANGED')
    opened.add(exec)
    const frame = { owner, exec, policyHandle, route: mode.route, operation: source.operation, pluginId: source.pluginId,
      policyEpoch: mode.policyEpoch, policySignal: mode.signal, signal: source.signal, detach: [], phase: 'open', closed: false }
    byOwner.set(owner, frame); byExec.set(exec, frame); active.add(frame)
    try {
      watch(frame, mode.signal); watch(frame, producer.signal); watch(frame, source.signal)
      try { frame.task = tasks.capture(exec) }
      catch (error) { if (!(error instanceof DevelopmentTaskError)) throw error }
      if (frame.task) watch(frame, frame.task.signal)
      if (frame.route === 'sealed') {
        const before = preBindings.get(exec)
        if (!before || !before.binding || before.binding !== binding || !before.binding.active) fail('INVOCATION_PRE_BINDING_ENDED')
        frame.connection = before.connection ?? connect(before.binding)
        connectionLive(frame.connection)
        watch(frame, frame.connection.signal)
      } else if (frame.route !== 'legacy') fail('INVOCATION_POLICY_UNSUPPORTED')
      check(frame, false)
      return Object.freeze({ route: frame.route,
        legacyExecution() {
          check(frame, false)
          if (frame.route !== 'legacy' || frame.phase !== 'open') fail('INVOCATION_LEGACY_FORBIDDEN')
          frame.phase = 'legacy'
          // A signal-replaced exec copy is ONLY an input to the old runner.
          return Object.freeze({ ...exec, signal: frame.signal })
        },
        invokeSealed: () => invokeSealed(frame),
        close() {
          close(frame)
          if (frame.cleanupError) throw new DevelopmentInvocationError('INVOCATION_CLEANUP_FAILED', frame.cleanupError)
        },
      })
    } catch (error) { close(frame); throw error }
  }
  async function invokeSealed(frame) {
    check(frame, false)
    if (frame.route !== 'sealed' || frame.phase !== 'open') fail('INVOCATION_SEALED_REPLAY')
    frame.phase = 'preparing'
    const connection = frame.connection
    if (!connection.supportedOperations.includes(frame.operation)) fail('INVOCATION_OPERATION_UNSUPPORTED')
    frame.lease = synchronous(connection.methods.lookupTarget(frame.pluginId))
    if (!object(frame.lease)) fail('INVOCATION_TARGET_UNREGISTERED')
    check(frame, false)
    frame.targets = createDevelopmentTargetResolver({ getHarnessRoot,
      readRegisteredTarget: lease => {
        check(frame, false)
        if (lease !== frame.lease) return undefined
        return synchronous(connection.methods.readRegisteredTarget(lease))
      },
      readCompilationSignals: original => {
        if (original !== frame.exec || byExec.get(original) !== frame) return undefined
        const source = check(frame, false)
        return { ownerSignal: source.signal, policySignal: frame.policySignal }
      }, producerSignal: producer.signal })
    frame.compilation = frame.targets.captureCompilation(frame.exec, frame.lease)
    frame.snapshot = frame.targets.compilationSnapshot(frame.compilation, frame.exec)
    frame.request = authority.makeApprovalRequest(frame.owner, `Creator ${frame.operation}: ${frame.pluginId}; sealed in-process execution`)
    check(frame)
    frame.preparation = synchronous(connection.methods.prepare(frame.owner, frame.lease, frame.compilation))
    if (!object(frame.preparation)) fail('INVOCATION_PREPARATION_INVALID')
    check(frame)
    frame.phase = 'authorizing'
    const capability = await waitFor(connection.methods.authorize(frame.owner, frame.preparation), frame.signal)
    check(frame)
    if (!object(capability)) fail('INVOCATION_CAPABILITY_INVALID')
    frame.phase = 'dispatching'
    // The fixed peer performs its own final source/policy/capability consume.
    // Its result is an explicit in-process managed receipt, never a CLI claim.
    return await waitFor(connection.methods.dispatch(frame.owner, frame.preparation, capability), frame.signal)
  }
  function dispose() {
    if (disposed) return
    disposed = true
    stopPre()
    producer.abort(new DevelopmentInvocationError('INVOCATION_PRODUCER_DISPOSED'))
    for (const frame of [...active]) close(frame)
    for (const connection of [...connections]) endConnection(connection)
    void Promise.resolve(dependency.dispose()).catch(() => {})
  }
  ctx.effect(() => dispose)
  return Object.freeze({ open, dispose })
}
