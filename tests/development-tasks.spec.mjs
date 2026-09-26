/**
 * Real current-checkout Session/AgentRegistry/AgentLoop/Tools lifecycle tests.
 * Only the LLM transport is scripted. No index/runner import, DSHX invocation,
 * browser, persistence backend, active Host change or actual human UI claim.
 * Run: TSX_DISABLE_CACHE=1 node --test tests/development-tasks.spec.mjs
 */
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDevelopmentTaskTracker, DevelopmentTaskError, DEVELOPMENT_TASK_SCOPE } from '../src/development-tasks.js'

import { resolveSourceCheckout } from './source-checkout.mjs'
const CHECKOUT = resolveSourceCheckout()
const url = path => pathToFileURL(resolve(CHECKOUT, path)).href
const { register } = await import(url('node_modules/tsx/dist/esm/api/index.mjs'))
const loaded = new Set()
const unregister = register({ tsconfig: resolve(CHECKOUT, 'tsconfig.json'), onImport: file => loaded.add(file) })
after(async () => { await unregister() })
const { Context, Service } = await import(url('vendor/cordis/src/index.ts'))
const { default: Sessions, SessionId, SessionSeq, SessionLogOffset } = await import(url('packages/core/session/src/index.ts'))
const { default: Agents } = await import(url('packages/core/agent/src/index.ts'))
const { default: AgentLoop } = await import(url('packages/core/agent-loop/src/index.ts'))
const { default: Projections } = await import(url('packages/session/session-projection/src/index.ts'))
const { default: SystemPrompt } = await import(url('packages/core/system-prompt/src/index.ts'))
const { default: Tools, defineContentToolFixture } = await import(url('packages/core/tools/src/index.ts'))
const { default: Approval, setApprovalPolicy } = await import(url('packages/interaction/user-approval/src/index.ts'))
const { default: Llm, createUserMessage, ToolCallId } = await import(url('packages/llm/llm/src/index.ts'))
const { MockAdapter, textResponse, toolCallResponse } = await import(url('packages/core/agent-loop/tests/mock-adapter.ts'))
const { Context: AliasContext } = await import('@deepseek-ai/cordis')

const opts = { timeout: 5000 }
const done = () => textResponse('done')
const call = (id = 'c1', args = {}) => toolCallResponse(id, 'probe', args)
const user = text => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const plugin = text => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'test-context' } })
const rejectsCode = (fn, codes) => assert.throws(fn, error => error instanceof DevelopmentTaskError
  && (Array.isArray(codes) ? codes : [codes]).includes(error.code))
const result = () => [{ type: 'text', text: 'ok' }]

async function harness(t, script, { tracker: mountTracker = true } = {}) {
  const ctx = new Context()
  const holds = []
  const failures = []
  const agentErrors = []
  const bodies = []
  t.after(async () => {
    for (const hold of holds) hold.resolve()
    for (const agent of ctx.agents.list()) agent.cancel({ kind: 'user' })
    await ctx.fiber.dispose()
  })
  await ctx.plugin(Llm)
  await ctx.plugin(Sessions)
  await ctx.plugin(Projections)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  await ctx.plugin(Approval)
  await ctx.plugin(Agents)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.on('agent/error', ({ error }) => agentErrors.push(error))
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  let tracker, producer
  async function mount(owner = ctx) {
    let value
    const fiber = await owner.plugin({
      name: 'task-tracker-fixture', inject: ['agents', 'sessions'],
      apply(inner) { value = createDevelopmentTaskTracker(inner) },
    })
    return { tracker: value, producer: fiber }
  }
  if (mountTracker) ({ tracker, producer } = await mount())
  const h = {
    ctx, tracker, producer, adapter, failures, agentErrors, bodies, mount,
    hold() { const item = Promise.withResolvers(); holds.push(item); return item },
    async agent(id = 'agent', options = {}) {
      return await ctx.agents.create({ sessionId: SessionId(id), agentOptions: { provider: 'mock', model: 'mock' }, ...options })
    },
    tool(fn, owner = ctx) {
      return owner.tools.register(defineContentToolFixture({
        name: 'probe', description: 'test lifecycle only', parameters: {},
        async execute(args, exec) {
          bodies.push(exec)
          try { await fn(exec, args); return result() }
          catch (error) { failures.push(error); throw error }
        },
      }))
    },
    async run(agent, input = user('work')) {
      agent.followup(input)
      await agent.whenIdle()
      assert.deepEqual(failures, [])
      assert.deepEqual(agentErrors, [])
    },
  }
  return h
}

test('uses one current-source Cordis and actual Session/AgentLoop/Tools implementations', opts, () => {
  assert.equal(Context, AliasContext)
  for (const service of [Sessions, Agents, AgentLoop, Tools, Approval]) assert.equal(Object.getPrototypeOf(service), Service)
  assert.ok(loaded.has(url('packages/core/agent-loop/src/agent.ts')))
  assert.ok(loaded.has(url('packages/core/session/src/index.ts')))
  assert.ok(loaded.has(url('packages/core/tools/src/index.ts')))
})

test('one live turn spans real tool steps, but a handle supplies no approval or grant', opts, async t => {
  const h = await harness(t, [call(), call('c2'), done()])
  const { agent } = await h.agent()
  const handles = []
  h.tool(exec => {
    const handle = h.tracker.capture(exec)
    handles.push(handle)
    assert.equal(h.tracker.revalidate(handle, exec), handle)
    assert.equal(handle.signal.aborted, false)
    assert.equal(handle.scope, DEVELOPMENT_TASK_SCOPE)
    assert.equal(handle.evidenceBoundary, 'lifecycle-only-no-authorization')
    assert.equal(handle.sessionId, agent.session.id)
    assert.equal(agent.session.eventAt(handle.turnStartSeq).type, 'turn/start')
    assert.equal(agent.session.eventAt(handle.userInputSeq).data.source.kind, 'user')
    assert.ok(handle.userInputSeq >= agent.session.firstLiveSeq)
    assert.equal(Object.isFrozen(handle), true)
  })
  await h.run(agent)
  assert.equal(handles.length, 2)
  assert.equal(handles[0], handles[1])
  assert.equal(handles[0].signal.aborted, true)
  assert.equal(handles[0].signal.reason.code, 'TASK_TURN_STOPPING')
  assert.deepEqual(Object.keys(h.tracker), ['capture', 'revalidate', 'dispose'])
  assert.equal(agent.session.snapshotEvents().some(e => e.type.startsWith('approval/')), false)
})

test('the same Session and callId get a different task on a fresh user turn', opts, async t => {
  const h = await harness(t, [call('same'), done(), call('same'), done()])
  const { agent } = await h.agent()
  const handles = []
  h.tool(exec => {
    const handle = h.tracker.capture(exec)
    if (handles.length) rejectsCode(() => h.tracker.revalidate(handles[0], exec), 'TASK_TURN_STOPPING')
    handles.push(handle)
  })
  await h.run(agent, user('first'))
  await h.run(agent, user('second'))
  assert.equal(handles.length, 2)
  assert.notEqual(handles[0], handles[1])
  assert.notEqual(handles[0].turnStartSeq, handles[1].turnStartSeq)
  assert.notEqual(handles[0].userInputSeq, handles[1].userInputSeq)
  assert.equal(handles[1].turn, handles[0].turn + 1)
  assert.notEqual(h.bodies[0].token, h.bodies[1].token)
})

test('cancellation revokes synchronously while the real Tools body is still draining', opts, async t => {
  const h = await harness(t, [call()])
  const { agent } = await h.agent()
  const entered = h.hold(), release = h.hold()
  let handle
  h.tool(async exec => { handle = h.tracker.capture(exec); entered.resolve(); await release.promise })
  agent.followup(user('wait'))
  await entered.promise
  agent.cancel({ kind: 'user' }, { keepInbox: true })
  assert.equal(handle.signal.aborted, true)
  assert.equal(handle.signal.reason.code, 'TASK_TURN_CANCELLED')
  assert.equal(agent.status, 'running')
  assert.equal(agent.session.snapshotEvents().some(e => e.type === 'turn/end'), false)
  release.resolve()
  await agent.whenIdle()
  assert.deepEqual(h.failures, [])
})

test('new queued input revokes before it is claimed and cannot renew the old call', opts, async t => {
  const h = await harness(t, [call(), done(), call('next'), done()])
  const { agent } = await h.agent()
  const entered = h.hold(), release = h.hold()
  let first, second
  h.tool(async exec => {
    if (!first) {
      first = h.tracker.capture(exec); entered.resolve(); await release.promise
      rejectsCode(() => h.tracker.revalidate(first, exec), 'TASK_NEW_INPUT')
      rejectsCode(() => h.tracker.capture(exec), 'TASK_INPUT_CHANGED')
    } else second = h.tracker.capture(exec)
  })
  agent.followup(user('old'))
  await entered.promise
  agent.followup(user('new'))
  assert.equal(first.signal.reason.code, 'TASK_NEW_INPUT')
  release.resolve()
  await agent.whenIdle()
  assert.deepEqual(h.failures, [])
  assert.ok(second)
  assert.notEqual(first, second)
  assert.ok(second.userInputSeq > first.userInputSeq)
})

test('plugin context after capture revokes; plugin-only continuation cannot supply another task', opts, async t => {
  const h = await harness(t, [call(), call('after-context'), done()])
  const { agent } = await h.agent()
  let handle, count = 0
  h.tool(exec => {
    count++
    if (count === 1) {
      handle = h.tracker.capture(exec)
      agent.inject(plugin('new context'))
      assert.equal(handle.signal.reason.code, 'TASK_NEW_INPUT')
    } else rejectsCode(() => h.tracker.capture(exec), 'TASK_EXECUTION_UNOBSERVED')
  })
  await h.run(agent)
  assert.equal(count, 2)
})

test('plugin-only and unknown-source turns cannot create a task candidate', opts, async t => {
  const h = await harness(t, [call(), done(), call('again'), done()])
  const { agent } = await h.agent()
  let checked = 0
  h.tool(exec => { checked++; rejectsCode(() => h.tracker.capture(exec), 'TASK_EXECUTION_UNOBSERVED') })
  await h.run(agent, plugin('not a human request'))
  await h.run(agent, createUserMessage({ content: [{ type: 'text', text: 'continuation' }], source: { kind: 'tool', tool: 'unknown' } }))
  assert.equal(checked, 2)
})

test('the first stopping event ends the task even when a listener continues the same turn', opts, async t => {
  const h = await harness(t, [call(), done(), call('continued'), done()])
  const { agent } = await h.agent()
  let first, continued = 0
  h.tool(exec => {
    if (!first) first = h.tracker.capture(exec)
    else { continued++; rejectsCode(() => h.tracker.capture(exec), 'TASK_EXECUTION_UNOBSERVED') }
  })
  let stops = 0
  h.ctx.on('agent/turn-stopping', ({ agent: subject }) => {
    if (subject === agent && stops++ === 0) {
      assert.equal(first.signal.aborted, true)
      agent.steer(plugin('goal continuation; not a new human permission'))
    }
  })
  await h.run(agent)
  assert.equal(continued, 1)
  assert.equal(agent.session.snapshotEvents().filter(e => e.type === 'turn/start').length, 1)
})

test('producer unload revokes held tasks and a replacement tracker cannot adopt the open turn', opts, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  const entered = h.hold(), release = h.hold()
  let handle, replacement
  h.tool(async exec => {
    handle = h.tracker.capture(exec); entered.resolve(); await release.promise
    rejectsCode(() => h.tracker.revalidate(handle, exec), 'TASK_PRODUCER_DISPOSED')
    rejectsCode(() => replacement.capture(exec), 'TASK_EXECUTION_UNOBSERVED')
  })
  agent.followup(user('wait'))
  await entered.promise
  await h.producer.dispose()
  assert.equal(handle.signal.reason.code, 'TASK_PRODUCER_DISPOSED')
  replacement = (await h.mount()).tracker
  release.resolve()
  await agent.whenIdle()
  assert.deepEqual(h.failures, [])
})

test('late installation cannot promote already-queued or already-entered input', opts, async t => {
  const h = await harness(t, [call(), done()], { tracker: false })
  const { agent } = await h.agent()
  let tracker, checked = 0
  h.ctx.on('agent/pre-step', async (_payload, next) => {
    tracker ??= (await h.mount()).tracker
    return next()
  }, { prepend: true })
  h.tool(exec => { checked++; rejectsCode(() => tracker.capture(exec), 'TASK_EXECUTION_UNOBSERVED') })
  await h.run(agent)
  assert.equal(checked, 1)
})

test('real Agent/Session disposal aborts a pending task without granting successors', opts, async t => {
  const h = await harness(t, [call()])
  const owned = await h.agent()
  const entered = h.hold(), release = h.hold()
  let handle
  h.tool(async exec => { handle = h.tracker.capture(exec); entered.resolve(); await release.promise })
  owned.agent.followup(user('wait'))
  await entered.promise
  const disposing = owned.dispose()
  assert.equal(handle.signal.aborted, true)
  release.resolve()
  await disposing
  assert.equal(h.ctx.agents.get(owned.agent.id), undefined)
  assert.equal(h.ctx.sessions.get(owned.agent.id), undefined)
  assert.deepEqual(h.failures, [])
})

test('copied handles, JSON task fields, copied executions and invented tokens carry no task authority', opts, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  let checked = false
  h.tool(exec => {
    const handle = h.tracker.capture(exec)
    rejectsCode(() => h.tracker.revalidate({ ...handle }, exec), 'TASK_HANDLE_UNISSUED')
    rejectsCode(() => h.tracker.revalidate(JSON.parse(JSON.stringify(handle)), exec), 'TASK_HANDLE_UNISSUED')
    rejectsCode(() => h.tracker.capture({ ...exec }), 'TASK_EXECUTION_UNOBSERVED')
    rejectsCode(() => h.tracker.capture({ agent, token: Symbol(), taskId: 'human-approved', signal: exec.signal }), 'TASK_EXECUTION_UNOBSERVED')
    assert.equal('taskId' in handle, false)
    checked = true
  })
  await h.run(agent)
  assert.equal(checked, true)
})

test('a completed tool execution is not a reusable live execution even within one open turn', opts, async t => {
  const h = await harness(t, [call(), call('second'), done()])
  const { agent } = await h.agent()
  let firstExec, handle
  h.tool(exec => {
    if (!firstExec) { firstExec = exec; handle = h.tracker.capture(exec) }
    else {
      assert.equal(handle.signal.aborted, false)
      rejectsCode(() => h.tracker.revalidate(handle, firstExec), 'TASK_EXECUTION_NOT_ACTIVE')
      assert.equal(h.tracker.revalidate(handle, exec), handle)
    }
  })
  await h.run(agent)
})

test('real Tools wrappers may replace the signal without detaching task cancellation', opts, async t => {
  const h = await harness(t, [call()])
  const { agent } = await h.agent()
  const entered = h.hold(), release = h.hold()
  let handle, bodySignal
  h.ctx.on('tools/execute', async (exec, next) => {
    const prior = exec.signal
    exec.signal = new AbortController().signal
    try { return await next() } finally { exec.signal = prior }
  }, { prepend: true })
  h.tool(async exec => { handle = h.tracker.capture(exec); bodySignal = exec.signal; entered.resolve(); await release.promise })
  agent.followup(user('wait'))
  await entered.promise
  agent.cancel({ kind: 'user' }, { keepInbox: true })
  assert.equal(handle.signal.aborted, true)
  assert.equal(bodySignal.aborted, true)
  release.resolve()
  await agent.whenIdle()
  assert.deepEqual(h.failures, [])
})

test('native never still rejects an independent official approval despite a valid lifetime', opts, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  setApprovalPolicy(agent.session, 'never')
  let outcome, answers = 0
  h.ctx.on('approval/request', async () => { answers++; return 'allowed-once' }, { prepend: true })
  h.tool(async exec => {
    const handle = h.tracker.capture(exec)
    assert.equal(handle.signal.aborted, false)
    outcome = await h.ctx.approval.request({ agent, toolName: exec.name, callId: exec.callId, signal: exec.signal })
  })
  await h.run(agent)
  assert.equal(outcome, 'rejected')
  assert.equal(answers, 0)
  assert.equal(agent.session.snapshotEvents().filter(e => e.type === 'approval/asked').length, 1)
})

test('task tracking does not override native pre-execute deny', opts, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  h.tool(() => assert.fail('denied body must not run'))
  h.ctx.on('tools/pre-execute', async () => ({ kind: 'deny', reason: 'fixture outer deny' }))
  await h.run(agent)
  assert.equal(h.bodies.length, 0)
})

test('a fabricated idle session turn and a native manual Tools call do not become an AgentLoop task', opts, async t => {
  const h = await harness(t, [])
  const { agent } = await h.agent()
  let checked = false
  h.tool(exec => { checked = true; rejectsCode(() => h.tracker.capture(exec), 'TASK_EXECUTION_UNOBSERVED') })
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('user/message', user('not driven by AgentLoop'), { surfaceOp: 'append' })
  await h.ctx.tools.execute({ name: 'probe', arguments: {}, callId: ToolCallId('manual'), agent, signal: new AbortController().signal })
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.equal(checked, true)
  assert.deepEqual(h.failures, [])
})

test('seeded pending direct input is not a new live user delivery', opts, async t => {
  const h = await harness(t, [call(), done(), done()])
  const seedInput = user('old queued input')
  const { agent } = await h.agent('seeded', { seed: [{
    type: 'agent/inbox/spliced', seq: SessionSeq(0), time: 1,
    data: { target: 'next-turn', start: 0, inserted: [seedInput] },
  }] })
  let checked = false
  h.tool(exec => { checked = true; rejectsCode(() => h.tracker.capture(exec), 'TASK_EXECUTION_UNOBSERVED') })
  // A plugin wake releases the persisted queued user, but never re-delivers it
  // as a new live direct-human inbox insertion.
  await h.run(agent, plugin('wake old queue'))
  assert.equal(checked, true)
  assert.ok(agent.session.firstLiveSeq > 0)
})

test('fork history cannot anchor a plugin continuation; a fresh direct input gets its own lifetime', opts, async t => {
  const h = await harness(t, [call(), done(), call('fork-plugin'), done(), call('fork-user'), done()])
  const { agent: parent } = await h.agent('parent')
  let parentTask, childTask, mode = 'parent'
  h.tool(exec => {
    if (mode === 'parent') parentTask = h.tracker.capture(exec)
    else if (mode === 'plugin') rejectsCode(() => h.tracker.capture(exec), 'TASK_EXECUTION_UNOBSERVED')
    else {
      childTask = h.tracker.capture(exec)
      rejectsCode(() => h.tracker.revalidate(parentTask, exec), 'TASK_TURN_STOPPING')
    }
  })
  await h.run(parent)
  const seed = parent.session.snapshotEvents()
  const ownedChild = await parent.ctx.agents.create({
    sessionId: SessionId('child'), parentAgent: parent,
    agentOptions: { provider: 'mock', model: 'mock' }, seed,
    meta: { parentSession: parent.id, isSeeded: true, origin: 'subagent' },
    inheritedEventCount: SessionLogOffset(seed.length),
  })
  assert.equal(h.ctx.agents.isOwnedBy(ownedChild.agent.id, parent), true)
  mode = 'plugin'
  await h.run(ownedChild.agent, plugin('delegation is not human consent'))
  mode = 'user'
  await h.run(ownedChild.agent, user('independent new input'))
  assert.ok(childTask)
  assert.notEqual(parentTask, childTask)
  assert.ok(childTask.userInputSeq >= ownedChild.agent.session.firstLiveSeq)
})

test('another Host with the same session id and copied history cannot use old handles', opts, async t => {
  const h1 = await harness(t, [call(), done()])
  const { agent: a1 } = await h1.agent('same-id')
  let oldTask
  h1.tool(exec => { oldTask = h1.tracker.capture(exec) })
  await h1.run(a1)
  const h2 = await harness(t, [call(), done()])
  const { agent: a2 } = await h2.agent('same-id', { seed: a1.session.snapshotEvents() })
  let newTask
  h2.tool(exec => {
    rejectsCode(() => h2.tracker.revalidate(oldTask, exec), 'TASK_HANDLE_UNISSUED')
    newTask = h2.tracker.capture(exec)
  })
  await h2.run(a2)
  assert.notEqual(oldTask, newTask)
  assert.equal(oldTask.sessionId, newTask.sessionId)
})

test('a commit observed by an earlier listener cannot revalidate against a stale task view', opts, async t => {
  const h = await harness(t, [call(), done()], { tracker: false })
  const { agent } = await h.agent()
  let handle, currentExec, checked = 0
  h.ctx.on('session/event', (session, event) => {
    if (session === agent.session && handle && event.type === 'agent/inbox/spliced' && event.data.inserted.length) {
      rejectsCode(() => h.tracker.revalidate(handle, currentExec), 'TASK_EVENT_PENDING')
      checked++
    }
  })
  Object.assign(h, await h.mount())
  h.tool(exec => {
    currentExec = exec
    handle = h.tracker.capture(exec)
    agent.inject(plugin('arrives during body'))
    assert.equal(handle.signal.reason.code, 'TASK_NEW_INPUT')
  })
  await h.run(agent)
  assert.equal(checked, 1)
})

test('forged and re-emitted session events cannot rewrite the observed live boundary', opts, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  let checked = false
  h.tool(exec => {
    const handle = h.tracker.capture(exec)
    const session = agent.session
    const last = session.eventAt(session.seq - 1)
    h.ctx.emit('session/event', session, { ...last, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    h.ctx.emit('session/event', session, session.eventAt(handle.turnStartSeq))
    h.ctx.emit('session/event', session, last)
    assert.equal(h.tracker.revalidate(handle, exec), handle)
    checked = true
  })
  await h.run(agent)
  assert.equal(checked, true)
})

test('a direct-kind user/message without a fresh live claimed input only invalidates', opts, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  let checked = false
  h.tool(exec => {
    const handle = h.tracker.capture(exec)
    agent.session.append('user/message', user('claimed human in a plugin append'), { surfaceOp: 'append' })
    assert.equal(handle.signal.reason.code, 'TASK_NEW_INPUT')
    rejectsCode(() => h.tracker.capture(exec), 'TASK_INPUT_CHANGED')
    checked = true
  })
  await h.run(agent)
  assert.equal(checked, true)
})

test('pre-step plugin rewriting cannot promote an invented direct-kind message to an input anchor', opts, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  h.ctx.on('agent/pre-step', async (_payload, next) => {
    const decision = await next()
    return { ...decision, messages: [user('not the input claimed by this turn')] }
  }, { prepend: true })
  let checked = false
  h.tool(exec => { checked = true; rejectsCode(() => h.tracker.capture(exec), 'TASK_EXECUTION_UNOBSERVED') })
  await h.run(agent)
  assert.equal(checked, true)
})

test('simultaneously live parent and child Agents have independent task handles', opts, async t => {
  const h = await harness(t, [call('parent'), call('child'), done(), done()])
  const { agent: parent } = await h.agent('live-parent')
  let parentTask, childTask
  h.tool(async exec => {
    if (exec.agent === parent) {
      parentTask = h.tracker.capture(exec)
      const child = await parent.ctx.agents.create({
        sessionId: SessionId('live-child'), parentAgent: parent,
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      child.agent.followup(user('independent input; still no consent grant'))
      await child.agent.whenIdle()
      assert.equal(h.tracker.revalidate(parentTask, exec), parentTask)
      assert.equal(parentTask.signal.aborted, false)
    } else {
      assert.equal(parentTask.signal.aborted, false)
      rejectsCode(() => h.tracker.revalidate(parentTask, exec), 'TASK_HANDLE_MISMATCH')
      childTask = h.tracker.capture(exec)
    }
  })
  await h.run(parent)
  assert.ok(childTask)
  assert.notEqual(parentTask, childTask)
})

test('root and scoped producers coexist without sharing handles or disposal effects', opts, async t => {
  const h = await harness(t, [call('other'), done(), call('scoped'), done()])
  const { agent: a } = await h.agent('scoped-agent')
  const { agent: b } = await h.agent('other-agent')
  const scoped = await h.mount(a.ctx)
  let checked = 0
  h.tool(async exec => {
    const rootTask = h.tracker.capture(exec)
    if (exec.agent === b) rejectsCode(() => scoped.tracker.capture(exec), 'TASK_EXECUTION_UNOBSERVED')
    else {
      const scopedTask = scoped.tracker.capture(exec)
      assert.notEqual(rootTask, scopedTask)
      rejectsCode(() => scoped.tracker.revalidate(rootTask, exec), 'TASK_HANDLE_UNISSUED')
      await scoped.producer.dispose()
      assert.equal(scopedTask.signal.reason.code, 'TASK_PRODUCER_DISPOSED')
      assert.equal(rootTask.signal.aborted, false)
      assert.equal(h.tracker.revalidate(rootTask, exec), rootTask)
    }
    checked++
  })
  await h.run(b)
  await h.run(a)
  assert.equal(checked, 2)
})

test('new input cancels a separately requested official decision and discards its late answer', opts, async t => {
  const h = await harness(t, [call(), done(), done()])
  const { agent } = await h.agent()
  const asked = h.hold(), answer = h.hold(), decided = h.hold()
  let outcome, handle
  h.ctx.on('approval/request', async () => { asked.resolve(); await answer.promise; return 'allowed-once' })
  h.tool(async exec => {
    handle = h.tracker.capture(exec)
    assert.equal(agent.session.snapshotEvents().some(e => e.type === 'approval/asked'), false)
    outcome = await h.ctx.approval.request({
      agent, toolName: exec.name, callId: exec.callId,
      signal: AbortSignal.any([exec.signal, handle.signal]),
    })
    rejectsCode(() => h.tracker.revalidate(handle, exec), 'TASK_NEW_INPUT')
    decided.resolve()
  })
  agent.followup(user('old task'))
  await asked.promise
  agent.followup(user('new input supersedes it'))
  await decided.promise
  assert.equal(outcome, 'cancelled')
  answer.resolve()
  await agent.whenIdle()
  assert.deepEqual(h.failures, [])
  assert.deepEqual(h.agentErrors, [])
  assert.deepEqual(agent.session.snapshotEvents().filter(e => e.type === 'approval/decided').map(e => e.data.outcome), ['cancelled'])
})

test('fresh direct steering in one native turn makes a new input-bound lifetime, never renews the old one', opts, async t => {
  const h = await harness(t, [call('first'), call('steered'), done()])
  const { agent } = await h.agent()
  const tasks = []
  h.tool(exec => {
    const task = h.tracker.capture(exec)
    tasks.push(task)
    if (tasks.length === 1) {
      agent.steer(user('a different current instruction'))
      assert.equal(task.signal.reason.code, 'TASK_NEW_INPUT')
    } else rejectsCode(() => h.tracker.revalidate(tasks[0], exec), 'TASK_NEW_INPUT')
  })
  await h.run(agent)
  assert.equal(tasks.length, 2)
  assert.equal(tasks[0].turnStartSeq, tasks[1].turnStartSeq)
  assert.notEqual(tasks[0].userInputSeq, tasks[1].userInputSeq)
  assert.notEqual(tasks[0], tasks[1])
  assert.equal(agent.session.snapshotEvents().some(e => e.type.startsWith('approval/')), false)
})

test('a lifetime alone never asks or decides; independent explicit official confirmation is still necessary', opts, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  let answers = 0, outcome
  h.ctx.on('approval/request', async () => { answers++; return 'allowed-once' })
  h.tool(async exec => {
    h.tracker.capture(exec)
    assert.equal(answers, 0)
    assert.equal(agent.session.snapshotEvents().some(e => e.type === 'approval/asked'), false)
    // This test answerer simulates a human; the module never calls this seam.
    outcome = await h.ctx.approval.request({ agent, toolName: exec.name, callId: exec.callId, signal: exec.signal })
  })
  await h.run(agent)
  assert.equal(answers, 1)
  assert.equal(outcome, 'allowed-once')
})

test('missing public lifecycle services fail closed rather than manufacture a taskId', opts, () => {
  rejectsCode(() => createDevelopmentTaskTracker(undefined), 'TASK_LIFECYCLE_UNAVAILABLE')
  rejectsCode(() => createDevelopmentTaskTracker({ root: {}, taskId: 'trusted-looking' }), 'TASK_LIFECYCLE_UNAVAILABLE')
})
