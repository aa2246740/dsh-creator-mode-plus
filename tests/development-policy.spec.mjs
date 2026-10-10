/**
 * Real Core mode/policy evidence, not production routing or authorization.
 * Current Cordis/AgentLoop/Session/Tools/Approval/PermissionPresets/SandboxPolicy
 * sources are used. Only LLM/reviewer transport and shell execution are inert.
 * The actual development-policy module observes native pre/dispatch lifetimes.
 * A is imported read-only; its apply/audit/UI are never mounted. No DSHX, Host or grant.
 */
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveSourceCheckout, resolveApproverSource } from './source-checkout.mjs'
import { createDevelopmentPolicyTracker, DevelopmentPolicyError } from '../src/development-policy.js'
import { createDevelopmentTaskTracker } from '../src/development-tasks.js'
const CHECKOUT = resolveSourceCheckout(), APPROVER = resolveApproverSource(CHECKOUT)
const url = path => pathToFileURL(resolve(CHECKOUT, path)).href
const { register } = await import(url('node_modules/tsx/dist/esm/api/index.mjs'))
const loaded = new Set()
const unregister = register({ tsconfig: resolve(CHECKOUT, 'tsconfig.json'), onImport: path => loaded.add(path) })
after(async () => { await unregister() })
const { Context, Service } = await import(url('vendor/cordis/src/index.ts'))
const { default: Sessions, SessionId } = await import(url('packages/core/session/src/index.ts'))
const { default: Agents } = await import(url('packages/core/agent/src/index.ts'))
const { default: AgentLoop } = await import(url('packages/core/agent-loop/src/index.ts'))
const { default: Projections } = await import(url('packages/session/session-projection/src/index.ts'))
const { default: SystemPrompt } = await import(url('packages/core/system-prompt/src/index.ts'))
const { default: Tools, defineContentToolFixture } = await import(url('packages/core/tools/src/index.ts'))
const { default: Approval } = await import(url('packages/interaction/user-approval/src/index.ts'))
const { default: Permissions, CUSTOM_PRESET } = await import(url('packages/interaction/permission-presets/src/index.ts'))
const { default: SandboxPolicy } = await import(url('packages/sandbox/sandbox-policy/src/index.ts'))
const { default: Shell } = await import(url('packages/shell/shell/src/index.ts'))
const { default: Llm, createUserMessage } = await import(url('packages/llm/llm/src/index.ts'))
const { MockAdapter, textResponse, toolCallResponse } = await import(url('packages/core/agent-loop/tests/mock-adapter.ts'))
const { reviewerModeActive, canRequestApproval } = await import(pathToFileURL(resolve(APPROVER, 'src/dsh-approve-for-me.ts')).href)
const { AutoReviewCoordinator } = await import(pathToFileURL(resolve(APPROVER, 'src/coordinator.ts')).href)
const options = { timeout: 5000 }
const user = () => createUserMessage({ content: [{ type: 'text', text: 'test policy' }], source: { kind: 'user' } })

class InertShell extends Shell {
  static inject = ['sandboxPolicy']
  get sandboxMode() { return this.ctx.sandboxPolicy.defaultMode }
  resolve() { throw new Error('no shell execution in policy source tests') }
  run() { throw new Error('no shell execution in policy source tests') }
  start() { throw new Error('no shell execution in policy source tests') }
}

// Read through the declared injected producer scope, not agent.ctx (which has
// not declared these dependencies). Context tracing may return a fresh service
// view on each read; public service wrapper === is NOT a generation proof.
function readPolicy(scope, agent) {
  scope.fiber.assertActive()
  const session = agent.session
  assert.equal(scope.root, agent.ctx.root)
  assert.equal(scope.agents.get(agent.id), agent)
  assert.equal(scope.sessions.get(session.id), session)
  const presets = scope.permissionPresets, approval = scope.approval, sandbox = scope.sandboxPolicy
  if (typeof presets?.current !== 'function' || typeof approval?.overrideOf !== 'function'
    || typeof sandbox?.resolve !== 'function') throw new Error('POLICY_SOURCE_UNAVAILABLE')
  const preset = presets.current(session)
  const files = sandbox.resolve({ session })
  return { scope, session, preset, sandbox: files.mode, approval: approval.overrideOf(session) ?? approval.config.policy ?? 'ask' }
}
function policyFence(binding, exec) {
  const tracker = binding.tracker, handle = tracker.capture(exec), initial = tracker.inspect(handle)
  return { initial, signal: initial.signal, handle,
    valid() { try { tracker.revalidate(handle); return true } catch (error) { assert.ok(error instanceof DevelopmentPolicyError); return false } },
    dispose() {}, // Actual tracker closes on the native dispatch/result boundary.
  }
}

async function harness(t, { beforeProjections, args = {}, extraPresets = {}, script } = {}) {
  const ctx = new Context(), holds = [], failures = [], errors = [], bodies = []
  t.after(async () => {
    for (const hold of holds) hold.resolve()
    for (const agent of ctx.agents.list()) agent.cancel({ kind: 'user' })
    await ctx.fiber.dispose()
  })
  await ctx.plugin(Llm); await ctx.plugin(Sessions)
  beforeProjections?.(ctx)
  for (const plugin of [Projections, SystemPrompt, Tools, Approval, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(SandboxPolicy, { mode: 'workspace-write' })
  await ctx.plugin(InertShell)
  // Exact bundles in A's cordis.patch.yml: approve-for-me and workspace-write
  // deliberately share the file-mode/approval pair, differing only in intent.
  const permissionFiber = await ctx.plugin(Permissions, { defaultPreset: 'workspace-write', presets: {
    'read-only': { sandbox: 'read-only', approval: 'ask' },
    'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
    'approve-for-me': { sandbox: 'workspace-write', approval: 'ask' },
    'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    ...extraPresets,
  } })
  let policyScope, tracker
  await ctx.plugin({ inject: ['permissionPresets', 'approval', 'sandboxPolicy', 'agents', 'sessions'], apply(inner) { policyScope = inner } })
  const policyProducer = await ctx.plugin({ inject: ['agents', 'sessions'], apply(inner) { tracker = createDevelopmentPolicyTracker(inner) } })
  const policyBinding = Object.freeze({ tracker })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.on('agent/error', ({ error }) => errors.push(error))
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script ?? [toolCallResponse('mode-call', 'mode_probe', args), textResponse('done')]))
  const h = {
    ctx, policyScope, policyBinding, policyProducer, tracker, permissionFiber, failures, bodies,
    hold() { const hold = Promise.withResolvers(); holds.push(hold); return hold },
    async agent(id = 'agent') { const { agent } = await ctx.agents.create({ sessionId: SessionId(id), agentOptions: { provider: 'mock', model: 'mock' } }); return agent },
    tool(fn) { ctx.tools.register(defineContentToolFixture({ name: 'mode_probe', description: 'test only', parameters: {}, async execute(args, exec) {
      bodies.push(exec)
      try { await fn(exec, args); return [{ type: 'text', text: 'done' }] }
      catch (error) { failures.push(error); throw error }
    } })) },
    async run(agent) { agent.followup(user()); await agent.whenIdle(); assert.deepEqual(failures, []); assert.deepEqual(errors, []) },
  }
  return h
}

test('mode tests use native services and the actual read-only A sources', options, () => {
  for (const type of [Permissions, SandboxPolicy, Shell, Approval, Tools]) assert.ok(Service.prototype.isPrototypeOf(type.prototype))
  for (const path of ['packages/interaction/permission-presets/src/index.ts', 'packages/sandbox/sandbox-policy/src/index.ts']) assert.ok(loaded.has(url(path)))
  assert.ok(loaded.has(pathToFileURL(resolve(APPROVER, 'src/coordinator.ts')).href))
})
test('current preset, actual file sandbox, and approval policy are distinct public facts; model/meta fields do not select them', options, async t => {
  const h = await harness(t, { args: { fileMode: 'danger-full-access', mode: 'danger-full-access' } })
  const agent = await h.agent()
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  h.tool(exec => {
    assert.equal('meta' in exec, false)
    assert.throws(() => agent.ctx.permissionPresets, /without inject/)
    assert.notEqual(h.policyScope.permissionPresets, h.policyScope.permissionPresets)
    exec.meta = { fileMode: 'danger-full-access' } // Deliberately ignored test poison.
    const state = readPolicy(h.policyScope, agent)
    assert.equal(state.preset, 'approve-for-me')
    assert.equal(state.sandbox, 'workspace-write')
    assert.equal(state.approval, 'ask')
    assert.equal(reviewerModeActive(h.policyScope, agent, { enabled: true }), true)
    assert.equal(canRequestApproval(h.policyScope, agent), true)
  })
  await h.run(agent)
})
test('switching between identical bundles changes only native preset events and cannot revive the old fence', options, async t => {
  const h = await harness(t), agent = await h.agent()
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  h.tool(exec => {
    const fence = policyFence(h.policyBinding, exec), floor = agent.session.seq
    assert.equal(fence.valid(), true)
    h.ctx.permissionPresets.set(agent.session, 'workspace-write')
    h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
    assert.deepEqual(agent.session.snapshotEvents().slice(floor).map(event => event.type), ['permission/preset', 'permission/preset'])
    assert.equal(readPolicy(h.policyScope, agent).preset, fence.initial.preset)
    assert.equal(fence.valid(), false)
    assert.throws(() => policyFence(h.policyBinding, exec), /POLICY_EPOCH_CHANGED/)
    fence.dispose()
  })
  await h.run(agent)
})
test('never override produces custom, not a safe legacy branch; switching back does not renew the old epoch', options, async t => {
  const h = await harness(t), agent = await h.agent()
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  h.tool(exec => {
    const fence = policyFence(h.policyBinding, exec)
    h.ctx.approval.setPolicy(agent, 'never')
    assert.equal(readPolicy(h.policyScope, agent).preset, CUSTOM_PRESET)
    assert.equal(readPolicy(h.policyScope, agent).approval, 'never')
    assert.equal(canRequestApproval(h.policyScope, agent), false)
    h.ctx.approval.setPolicy(agent, 'ask')
    assert.equal(readPolicy(h.policyScope, agent).preset, 'approve-for-me')
    assert.equal(fence.valid(), false)
    fence.dispose()
  })
  await h.run(agent)
})
test('native Approval alone does not revoke a pending answer across never→ask', options, async t => {
  const h = await harness(t), agent = await h.agent(), asked = h.hold(), answer = h.hold()
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  let outcome
  h.ctx.on('approval/request', async () => { asked.resolve(); await answer.promise; return 'allowed-once' })
  h.tool(async exec => { outcome = await h.ctx.approval.request({ agent, toolName: exec.name, callId: exec.callId, signal: exec.signal }) })
  const running = h.run(agent)
  await asked.promise
  h.ctx.approval.setPolicy(agent, 'never'); h.ctx.approval.setPolicy(agent, 'ask')
  answer.resolve(); await running
  assert.equal(outcome, 'allowed-once') // Evidence of missing epoch cancellation, NOT permission to execute.
})
for (const change of ['preset', 'policy']) {
  test(`current A coordinator cancels stale review after ${change} ABA`,  options, async t => {
    const h = await harness(t), agent = await h.agent(), asked = h.hold(), answer = h.hold()
    h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
    const reviewer = {
      subject: (exec, downstream) => ({ stage: 'pre-execute', toolName: exec.name, arguments: exec.arguments, agent: exec.agent, downstream,
        recentUserRequests: [], trustedDeveloperInstructions: [], trustedUserResponses: [], recentAssistantMessages: [], recentExecutionEvidence: [] }),
      async review() { asked.resolve(); await answer.promise; return { source: 'llm', decision: 'allow', reason: 'test transport only' } }, log() {},
    }
    const coordinator = new AutoReviewCoordinator(reviewer, a => reviewerModeActive(h.policyScope, a, { enabled: true }), { canAsk: a => canRequestApproval(h.policyScope, a) })
    t.after(() => coordinator.dispose())
    let decision
    h.ctx.on('tools/pre-execute', async exec => { decision = await coordinator.preExecute(exec, { kind: 'ask', reason: 'test policy' }); return decision })
    h.tool(() => {})
    const running = h.run(agent)
    await asked.promise
    if (change === 'preset') { h.ctx.permissionPresets.set(agent.session, 'workspace-write'); h.ctx.permissionPresets.set(agent.session, 'approve-for-me') }
    else { h.ctx.approval.setPolicy(agent, 'never'); h.ctx.approval.setPolicy(agent, 'ask') }
    answer.resolve(); await running
    assert.equal(decision.kind, 'deny') // A now checks the committed policy epoch; do not preserve the historical vulnerability.
  })
  test(`a native-event fence cancels the official request across ${change} ABA and discards the late answer`, options, async t => {
    const h = await harness(t), agent = await h.agent(), asked = h.hold(), answer = h.hold()
    h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
    let outcome, fence
    h.ctx.on('approval/request', async () => { asked.resolve(); await answer.promise; return 'allowed-once' })
    h.tool(async exec => {
      fence = policyFence(h.policyBinding, exec)
      outcome = await h.ctx.approval.request({ agent, toolName: exec.name, callId: exec.callId, signal: fence.signal })
      assert.equal(fence.valid(), false); fence.dispose()
    })
    const running = h.run(agent)
    await asked.promise
    if (change === 'preset') { h.ctx.permissionPresets.set(agent.session, 'workspace-write'); h.ctx.permissionPresets.set(agent.session, 'approve-for-me') }
    else { h.ctx.approval.setPolicy(agent, 'never'); h.ctx.approval.setPolicy(agent, 'ask') }
    assert.equal(fence.signal.aborted, true)
    assert.equal(h.bodies[0].signal.aborted, false) // Never abort the shared Agent/body signal.
    answer.resolve(); await running
    assert.equal(outcome, 'cancelled')
  })
}
test('native never rejects before any answerer and stays independent of preset labels', options, async t => {
  const h = await harness(t), agent = await h.agent()
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me'); h.ctx.approval.setPolicy(agent, 'never')
  h.ctx.on('approval/request', async () => assert.fail('never must not ask'))
  h.tool(async exec => assert.equal(await h.ctx.approval.request({ agent, toolName: exec.name, signal: exec.signal }), 'rejected'))
  await h.run(agent)
})
test('another native Session changing policy cannot change this session or its fence', options, async t => {
  const h = await harness(t), a = await h.agent('a'), b = await h.agent('b')
  h.ctx.permissionPresets.set(a.session, 'approve-for-me')
  h.tool(exec => {
    const fence = policyFence(h.policyBinding, exec)
    h.ctx.permissionPresets.set(b.session, 'danger-full-access')
    assert.equal(readPolicy(h.policyScope, a).preset, 'approve-for-me')
    assert.equal(readPolicy(h.policyScope, b).preset, 'danger-full-access')
    assert.equal(fence.valid(), true); fence.dispose()
  })
  await h.run(a)
})
test('an earlier observer cannot revalidate against the projection cache before it receives the committed event', options, async t => {
  let fence, target, observed = false
  const h = await harness(t, { beforeProjections(ctx) {
    ctx.on('session/event', (session, event) => {
      if (fence && session === target.session && event.type === 'permission/preset') {
        try {
          assert.equal(readPolicy(h.policyScope, target).preset, 'workspace-write')
          assert.equal(fence.valid(), false)
          observed = true
        } catch (error) { h.failures.push(error) }
      }
    })
  } })
  target = await h.agent(); h.ctx.permissionPresets.set(target.session, 'approve-for-me')
  h.tool(exec => {
    fence = policyFence(h.policyBinding, exec)
    h.ctx.permissionPresets.set(target.session, 'workspace-write')
    assert.equal(observed, true); assert.equal(fence.valid(), false); fence.dispose()
  })
  await h.run(target)
})
test('missing/unloaded public policy service closes an existing fence rather than reading another latest source', options, async t => {
  const h = await harness(t), agent = await h.agent()
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  h.tool(async exec => {
    const fence = policyFence(h.policyBinding, exec)
    await h.permissionFiber.dispose()
    assert.equal(fence.valid(), false)
    assert.throws(() => readPolicy(h.policyScope, agent))
    assert.equal(fence.signal.aborted, true)
    fence.dispose()
  })
  await h.run(agent)
})

for (const change of ['preset', 'policy']) {
  test(`policy witness is revoked before the real A pre-review unwind denies ${change} ABA`,  options, async t => {
    const h = await harness(t), agent = await h.agent(), asked = h.hold(), answer = h.hold()
    h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
    const reviewer = {
      subject: (exec, downstream) => ({ stage: 'pre-execute', toolName: exec.name, arguments: exec.arguments, agent: exec.agent, downstream,
        recentUserRequests: [], trustedDeveloperInstructions: [], trustedUserResponses: [], recentAssistantMessages: [], recentExecutionEvidence: [] }),
      async review() { asked.resolve(); await answer.promise; return { source: 'llm', decision: 'allow', reason: 'transport stub' } }, log() {},
    }
    const coordinator = new AutoReviewCoordinator(reviewer, a => reviewerModeActive(h.policyScope, a, { enabled: true }), { canAsk: a => canRequestApproval(h.policyScope, a) })
    t.after(() => coordinator.dispose())
    h.ctx.on('tools/pre-execute', async () => ({ kind: 'ask', reason: 'native downstream policy' }))
    // The actual A apply order: prepend, await next(), then review the result.
    let original, entered = false
    h.ctx.on('tools/pre-execute', async (exec, next) => { original = exec; return coordinator.preExecute(exec, await next()) }, { prepend: true })
    h.tool(() => { entered = true })
    const running = h.run(agent)
    await asked.promise
    if (change === 'preset') { h.ctx.permissionPresets.set(agent.session, 'workspace-write'); h.ctx.permissionPresets.set(agent.session, 'approve-for-me') }
    else { h.ctx.approval.setPolicy(agent, 'never'); h.ctx.approval.setPolicy(agent, 'ask') }
    answer.resolve(); await running
    assert.equal(entered, false)
    assert.equal(original.signal.aborted, false)
    assert.throws(() => h.tracker.capture(original), /POLICY_EPOCH_CHANGED/)
  })
}

for (const preset of ['read-only', 'workspace-write', 'danger-full-access']) {
  test(`only the actual standard ${preset} bundle yields a legacy classification, not permission`, options, async t => {
    const h = await harness(t), agent = await h.agent()
    h.ctx.permissionPresets.set(agent.session, preset)
    h.tool(exec => {
      const owner = h.tracker.capture(exec), state = h.tracker.inspect(owner)
      assert.equal(state.route, 'legacy')
      assert.equal(state.preset, preset)
      assert.equal(state.evidenceBoundary, 'policy-lifetime-only-no-authorization')
      assert.deepEqual(Reflect.ownKeys(owner), [])
      assert.equal(Object.isFrozen(owner), true)
      assert.throws(() => h.tracker.capture({ ...exec }), /POLICY_EXECUTION_UNOBSERVED/)
      assert.throws(() => h.tracker.revalidate({ ...owner }), /POLICY_HANDLE_UNISSUED/)
      assert.throws(() => h.tracker.capture(exec), /POLICY_ALREADY_CAPTURED/)
    })
    await h.run(agent)
  })
}
for (const [label, extraPresets, selected] of [
  ['nonstandard named preset', { nonstandard: { sandbox: 'workspace-write', approval: 'ask' } }, 'nonstandard'],
  ['standard name with modified bundle', { 'workspace-write': { sandbox: 'read-only', approval: 'ask' } }, 'workspace-write'],
]) {
  test(`${label} never becomes a legacy permission`, options, async t => {
    const h = await harness(t, { extraPresets }), agent = await h.agent()
    h.ctx.permissionPresets.set(agent.session, selected)
    h.tool(exec => assert.throws(() => h.tracker.capture(exec), /POLICY_PRESET_UNSUPPORTED/))
    await h.run(agent)
  })
}

test('custom caused by never at pre is closed and cannot become legacy after a later ask reset', options, async t => {
  const h = await harness(t), agent = await h.agent()
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me'); h.ctx.approval.setPolicy(agent, 'never')
  h.tool(exec => {
    assert.throws(() => h.tracker.capture(exec), /POLICY_PRESET_UNSUPPORTED/)
    h.ctx.approval.setPolicy(agent, 'ask')
    assert.throws(() => h.tracker.capture(exec), /POLICY_PRESET_UNSUPPORTED/)
  })
  await h.run(agent)
})

test('root and scoped trackers have separate handles and producer lifetimes', options, async t => {
  const h = await harness(t), agent = await h.agent()
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  let scoped
  const producer = await agent.ctx.plugin({ inject: ['agents', 'sessions'], apply(inner) { scoped = createDevelopmentPolicyTracker(inner) } })
  h.tool(async exec => {
    const rootOwner = h.tracker.capture(exec), scopedOwner = scoped.capture(exec)
    const a = h.tracker.inspect(rootOwner), b = scoped.inspect(scopedOwner)
    assert.notEqual(a.policyEpoch, b.policyEpoch)
    assert.throws(() => h.tracker.inspect(scopedOwner), /POLICY_HANDLE_UNISSUED/)
    assert.throws(() => scoped.inspect(rootOwner), /POLICY_HANDLE_UNISSUED/)
    await producer.dispose()
    assert.equal(b.signal.aborted, true)
    assert.equal(a.signal.aborted, false)
    assert.equal(h.tracker.revalidate(rootOwner), rootOwner)
    assert.equal(exec.signal.aborted, false)
  })
  await h.run(agent)
})

test('a tracker loaded after pre has entered a pending review cannot capture that old native invocation', options, async t => {
  const h = await harness(t), agent = await h.agent(), waiting = h.hold(), release = h.hold()
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  await h.policyProducer.dispose()
  let late
  h.ctx.on('tools/pre-execute', async (exec, next) => { const result = await next(); waiting.resolve(); await release.promise; return result }, { prepend: true })
  h.tool(exec => assert.throws(() => late.capture(exec), /POLICY_EXECUTION_UNOBSERVED/))
  const running = h.run(agent)
  await waiting.promise
  await h.ctx.plugin({ inject: ['agents', 'sessions'], apply(inner) { late = createDevelopmentPolicyTracker(inner) } })
  release.resolve(); await running
})

test('a body cannot upgrade a pre observation made without policy dependencies', options, async t => {
  const h = await harness(t), agent = await h.agent()
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  await h.permissionFiber.dispose()
  h.tool(async exec => {
    assert.throws(() => h.tracker.capture(exec), /POLICY_BINDING_UNAVAILABLE/)
    await h.ctx.plugin(Permissions, { defaultPreset: 'approve-for-me', presets: { 'approve-for-me': { sandbox: 'workspace-write', approval: 'ask' } } })
    assert.equal(h.ctx.permissionPresets.current(agent.session), 'approve-for-me')
    assert.throws(() => h.tracker.capture(exec), /POLICY_BINDING_UNAVAILABLE/)
  })
  await h.run(agent)
})

const modeCall = id => toolCallResponse(id, 'mode_probe', {})
test('two genuine tool steps in one native task share policyEpoch, not their per-exec handles/signals', options, async t => {
  const h = await harness(t, { script: [modeCall('first'), modeCall('second'), textResponse('done')] })
  let tasks
  await h.ctx.plugin({ inject: ['agents', 'sessions', 'tools'], apply(inner) { tasks = createDevelopmentTaskTracker(inner) } })
  const agent = await h.agent(), taskHandles = [], policyHandles = [], views = []
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  h.tool(exec => {
    const task = tasks.capture(exec), handle = h.tracker.capture(exec), view = h.tracker.inspect(handle)
    taskHandles.push(task); policyHandles.push(handle); views.push(view)
    assert.equal(tasks.revalidate(task, exec), task)
    assert.equal(Object.isFrozen(view.policyEpoch), true)
    assert.deepEqual(Reflect.ownKeys(view.policyEpoch), [])
    assert.equal(view.signal.aborted, false)
  })
  await h.run(agent)
  assert.equal(views.length, 2)
  assert.equal(taskHandles[0], taskHandles[1])
  assert.notEqual(policyHandles[0], policyHandles[1])
  assert.notEqual(views[0].signal, views[1].signal)
  assert.equal(views[0].policyEpoch, views[1].policyEpoch)
  assert.equal(views[0].signal.aborted, true)
  assert.equal(views[1].signal.aborted, true)
})
for (const change of ['preset', 'policy']) {
  test(`${change} ABA issues a new cross-exec epoch but never revives the old native pre witness`, options, async t => {
    const h = await harness(t, { script: [modeCall('first'), modeCall('second'), textResponse('done')] }), agent = await h.agent(), views = []
    h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
    h.tool(exec => {
      const handle = h.tracker.capture(exec), view = h.tracker.inspect(handle)
      views.push(view)
      if (views.length !== 1) return
      if (change === 'preset') { h.ctx.permissionPresets.set(agent.session, 'workspace-write'); h.ctx.permissionPresets.set(agent.session, 'approve-for-me') }
      else { h.ctx.approval.setPolicy(agent, 'never'); h.ctx.approval.setPolicy(agent, 'ask') }
      assert.equal(view.signal.aborted, true)
      assert.equal(exec.signal.aborted, false)
      assert.throws(() => h.tracker.revalidate(handle), /POLICY_EPOCH_CHANGED/)
      assert.throws(() => h.tracker.capture(exec), /POLICY_EPOCH_CHANGED/)
    })
    await h.run(agent)
    assert.equal(views.length, 2)
    assert.notEqual(views[0].policyEpoch, views[1].policyEpoch)
  })
}
test('policy changes with zero active executions retire the epoch before the next real pre', options, async t => {
  const h = await harness(t, { script: [modeCall('first'), textResponse('done'), modeCall('second'), textResponse('done')] }), agent = await h.agent(), views = []
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  h.tool(exec => views.push(h.tracker.inspect(h.tracker.capture(exec))))
  await h.run(agent)
  assert.equal(views.length, 1); assert.equal(views[0].signal.aborted, true)
  h.ctx.permissionPresets.set(agent.session, 'workspace-write'); h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  await h.run(agent)
  assert.equal(views.length, 2)
  assert.notEqual(views[0].policyEpoch, views[1].policyEpoch)
})
test('a dependency reinstall creates a new epoch even when the current native mode did not change', options, async t => {
  const h = await harness(t, { script: [modeCall('first'), modeCall('second'), textResponse('done')] }), agent = await h.agent(), views = []
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  h.tool(async exec => {
    const handle = h.tracker.capture(exec), view = h.tracker.inspect(handle)
    views.push(view)
    if (views.length !== 1) return
    await h.permissionFiber.dispose()
    assert.equal(view.signal.aborted, true)
    await h.ctx.plugin(Permissions, { defaultPreset: 'workspace-write', presets: {
      'read-only': { sandbox: 'read-only', approval: 'ask' }, 'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
      'approve-for-me': { sandbox: 'workspace-write', approval: 'ask' }, 'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    } })
    assert.equal(h.ctx.permissionPresets.current(agent.session), 'approve-for-me')
    assert.throws(() => h.tracker.revalidate(handle), /POLICY_BINDING_ENDED/)
  })
  await h.run(agent)
  assert.equal(views.length, 2)
  assert.notEqual(views[0].policyEpoch, views[1].policyEpoch)
})

test('revalidateFor reads only the exact original exec/handle and never makes capture replayable', options, async t => {
  const h = await harness(t, { script: [modeCall('first'), modeCall('second'), textResponse('done')] }), agent = await h.agent(), calls = []
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  h.tool(exec => {
    const handle = h.tracker.capture(exec)
    assert.equal(h.tracker.revalidateFor(handle, exec), handle)
    assert.equal(h.tracker.revalidateFor(handle, exec), handle)
    assert.throws(() => h.tracker.capture(exec), /POLICY_ALREADY_CAPTURED/)
    assert.throws(() => h.tracker.revalidateFor(handle, { ...exec }), /POLICY_EXECUTION_CHANGED/)
    assert.throws(() => h.tracker.revalidateFor({ ...handle }, exec), /POLICY_HANDLE_UNISSUED/)
    if (calls.length) assert.throws(() => h.tracker.revalidateFor(calls[0].handle, exec), /POLICY_EXECUTION_CHANGED/)
    calls.push({ exec, handle })
  })
  await h.run(agent)
  assert.equal(calls.length, 2)
  for (const { exec, handle } of calls) assert.throws(() => h.tracker.revalidateFor(handle, exec), /POLICY_EXECUTION_ENDED/)
})
