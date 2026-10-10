/**
 * Current real Cordis/AgentLoop/Session/Tools/Approval + timeout policy.
 * Private owned-definition fixtures exercise the authority factory's identity,
 * cancellation and one-use contracts. They deliberately are NOT C provenance.
 * Actual current C apply/execute closures are separately covered by native
 * development-invocation and the real three-package sealed interop suite.
 * No real DSHX, Host, browser, profile heal or persisted permission is invoked.
 * Run: TSX_DISABLE_CACHE=1 node --experimental-vm-modules --test tests/development-execution.spec.mjs
 */
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as compatibility from '../src/compatibility.js'
import { createDevelopmentExecutionAuthority, DevelopmentExecutionError } from '../src/development-execution.js'
import { resolveSourceCheckout } from './source-checkout.mjs'
const CHECKOUT = resolveSourceCheckout()
const url = path => pathToFileURL(resolve(CHECKOUT, path)).href
const { register } = await import(url('node_modules/tsx/dist/esm/api/index.mjs'))
const loaded = new Set()
const unregister = register({ tsconfig: resolve(CHECKOUT, 'tsconfig.json'), onImport: file => loaded.add(file) })
after(async () => { await unregister() })
const { Context, Service } = await import(url('vendor/cordis/src/index.ts'))
const { default: Sessions, SessionId } = await import(url('packages/core/session/src/index.ts'))
const { default: Agents } = await import(url('packages/core/agent/src/index.ts'))
const { default: AgentLoop } = await import(url('packages/core/agent-loop/src/index.ts'))
const { default: Projections } = await import(url('packages/session/session-projection/src/index.ts'))
const { default: SystemPrompt } = await import(url('packages/core/system-prompt/src/index.ts'))
const { default: Tools } = await import(url('packages/core/tools/src/index.ts'))
const { default: Approval, setApprovalPolicy } = await import(url('packages/interaction/user-approval/src/index.ts'))
const { default: Llm, createUserMessage } = await import(url('packages/llm/llm/src/index.ts'))
const TimeoutPolicy = await import(url('packages/guard/timeout-policy/src/index.ts'))
const { MockAdapter, textResponse, toolCallResponse } = await import(url('packages/core/agent-loop/tests/mock-adapter.ts'))
const names = ['dshx_check', 'dshx_activation_plan', 'dshx_hot_reload', 'dshx_activate_new_client']
const options = { timeout: 5000 }
const call = (name = 'dshx_check', args = { name: 'demo' }, id = 'call') => toolCallResponse(id, name, args)
const done = () => textResponse('done')
const user = text => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const reject = (fn, codes) => assert.throws(fn, error => error instanceof DevelopmentExecutionError
  && (Array.isArray(codes) ? codes : [codes]).includes(error.code))

function ownedFixtureDefinitions(runs) {
  return compatibility.CREATOR_MODEL_TOOLS.map(name => {
    const fields = name === 'dshx_activation_plan' ? ['name', 'change'] : ['name']
    return { name, description: 'private authority unit fixture; not a C source claim',
      parameters: { type: 'object', properties: Object.fromEntries(fields.map(key => [key, { type: 'string' }])), required: fields, additionalProperties: false },
      timeoutMs: 60000,
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) { runs.push({ args, exec }); return { exitCode: 0 } },
    }
  })
}

async function harness(t, script) {
  const ctx = new Context()
  const holds = [], failures = [], agentErrors = [], runs = [], executions = [], owners = []
  t.after(async () => {
    for (const hold of holds) hold.resolve()
    for (const agent of ctx.agents.list()) agent.cancel({ kind: 'user' })
    await ctx.fiber.dispose()
  })
  for (const service of [Llm, Sessions, Projections, SystemPrompt, Tools, Approval, Agents]) await ctx.plugin(service)
  await ctx.plugin(TimeoutPolicy)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.on('agent/error', ({ error }) => agentErrors.push(error))
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  const h = {
    ctx, runs, failures, agentErrors, executions, owners,
    guard(fn) { try { return fn() } catch (error) { failures.push(error); throw error } },
    hold() { const hold = Promise.withResolvers(); holds.push(hold); return hold },
    async agent(id = 'agent') { return await ctx.agents.create({ sessionId: SessionId(id), agentOptions: { provider: 'mock', model: 'mock' } }) },
    async mount(scope = ctx, behavior) {
      const definitions = ownedFixtureDefinitions(runs)
      const disposers = new Map()
      let authority
      const producer = await scope.plugin({ inject: ['tools', 'agents', 'sessions'], apply(inner) {
        for (const definition of definitions) {
          const original = definition.execute
          if (names.includes(definition.name)) definition.execute = async (args, exec) => {
            executions.push(exec)
            const enter = () => { const owner = authority.enter(exec, args); owners.push(owner); return owner }
            try {
              if (behavior) return await behavior({ authority, args, exec, enter, original, definition })
              enter()
              return await original(args, exec)
            } catch (error) { failures.push(error); throw error }
          }
          disposers.set(definition.name, inner.tools.register(definition))
        }
        authority = createDevelopmentExecutionAuthority(inner, new Map(definitions.filter(def => names.includes(def.name)).map(def => [def.name, def])))
      } })
      return { authority, producer, definitions, disposers }
    },
    async run(agent, text = 'work') {
      agent.followup(user(text))
      await agent.whenIdle()
      assert.deepEqual(failures, [])
      assert.deepEqual(agentErrors, [])
    },
  }
  return h
}

test('source regressions use current native services and the official timeout wrapper', options, () => {
  for (const type of [Agents, Sessions, Tools, Approval, AgentLoop]) assert.equal(Object.getPrototypeOf(type), Service)
  for (const path of ['packages/core/tools/src/index.ts', 'packages/interaction/user-approval/src/index.ts', 'packages/guard/timeout-policy/src/index.ts']) assert.ok(loaded.has(url(path)))
})

test('four owned fixture definitions derive fixed operations, never permission or claim authority', options, async t => {
  const h = await harness(t, [call(), call('dshx_activation_plan', { name: 'demo', change: 'server' }, 'p'), call('dshx_hot_reload', { name: 'demo' }, 'h'), call('dshx_activate_new_client', { name: 'demo' }, 'n'), done()])
  const { agent } = await h.agent()
  const seen = []
  const c = await h.mount(h.ctx, async ({ authority, exec, args, enter, original }) => {
    const owner = enter()
    assert.deepEqual(Reflect.ownKeys(owner), [])
    assert.equal(Object.isFrozen(owner), true)
    assert.equal(authority.revalidate(owner), owner)
    const view = authority.inspect(owner)
    seen.push(view.operation)
    assert.equal(view.pluginId, 'demo')
    assert.equal(view.evidenceBoundary, 'owned-execution-only-no-authorization')
    assert.equal(view.agent, agent)
    assert.equal(view.session, agent.session)
    assert.equal('execute' in view, false)
    assert.notEqual(view.bodySignal, view.callerSignal) // Actual timeout-policy.
    assert.equal(view.bodySignal, exec.signal)
    assert.deepEqual(Object.keys(authority.reader), ['lookupRequest'])
    return original(args, exec)
  })
  await h.run(agent)
  assert.deepEqual(seen, ['check', 'activation-plan', 'hot-reload', 'activate-new-client'])
  assert.equal(c.definitions.length, 10)
  assert.equal(h.runs.length, 4)
  assert.equal(agent.session.snapshotEvents().some(e => e.type.startsWith('approval/')), false)
  for (const owner of h.owners) reject(() => c.authority.inspect(owner), 'EXECUTION_ENDED')
})

test('official Approval preserves the exact request; clones and matching callId are not bound', options, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  let request, owner, answererCalls = 0
  const c = await h.mount(h.ctx, async ({ authority, args, exec, enter, original }) => {
    owner = enter()
    request = authority.makeApprovalRequest(owner, 'independent human confirmation')
    assert.equal(Object.isFrozen(request), true)
    assert.equal(request.signal, authority.inspect(owner).signal)
    assert.equal(authority.reader.lookupRequest(request).owner, owner)
    assert.equal(authority.reader.lookupRequest({ ...request }), undefined)
    const wire = JSON.parse(JSON.stringify({ agentId: agent.id, toolName: exec.name, callId: exec.callId, sourceVerified: true }))
    assert.equal(authority.reader.lookupRequest(wire), undefined)
    assert.equal(authority.reader.lookupRequest({ ...wire, agent: h.ctx.agents.get(wire.agentId), signal: request.signal }), undefined)
    assert.equal(authority.reader.lookupRequest({ agent, toolName: exec.name, callId: exec.callId, signal: exec.signal }), undefined)
    assert.equal(await h.ctx.approval.request(request), 'allowed-once')
    // Native Approval asks again for the same object; binding is not question
    // deduplication or an execution permit. Neither call mints another owner.
    assert.equal(await h.ctx.approval.request(request), 'allowed-once')
    reject(() => authority.makeApprovalRequest(owner), 'EXECUTION_REQUEST_ALREADY_BOUND')
    return original(args, exec)
  })
  h.ctx.on('approval/request', async exact => {
    answererCalls++
    assert.equal(exact, request)
    assert.equal(c.authority.reader.lookupRequest(exact).owner, owner)
    return 'allowed-once'
  })
  await h.run(agent)
  assert.equal(answererCalls, 2)
  assert.equal(h.owners.length, 1)
  assert.equal(c.authority.reader.lookupRequest(request), undefined)
  await assert.rejects(h.ctx.approval.request(request), /outside an open turn/)
  assert.equal(c.authority.reader.lookupRequest(request), undefined)
})

test('a native outer ask/allowed-once is not a C owner and passive observation never authorizes it', options, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  const c = await h.mount()
  let asks = 0
  h.ctx.on('tools/pre-execute', async () => ({ kind: 'ask', reason: 'ordinary outer policy' }))
  h.ctx.on('approval/request', async request => {
    asks++
    assert.equal(c.authority.lookupRequest(request), undefined)
    assert.equal(h.owners.length, 0)
    return 'allowed-once'
  })
  await h.run(agent)
  assert.equal(asks, 1)
  assert.equal(h.owners.length, 1)
})

test('native deny and never still prevent the real C body from entering', options, async t => {
  const h = await harness(t, [call(), done(), call('dshx_check', { name: 'demo' }, 'again'), done()])
  const { agent } = await h.agent()
  await h.mount()
  const deny = h.ctx.on('tools/pre-execute', async () => ({ kind: 'deny', reason: 'deny wins' }))
  await h.run(agent)
  deny()
  setApprovalPolicy(agent.session, 'never')
  h.ctx.on('tools/pre-execute', async () => ({ kind: 'ask', reason: 'never must reject' }))
  h.ctx.on('approval/request', async () => assert.fail('never cannot reach answerer'))
  await h.run(agent)
  assert.equal(h.owners.length, 0)
  assert.equal(h.runs.length, 0)
})

test('fake execs, empty owners, copied args and reentry cannot mint or reuse an owner', options, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  await h.mount(h.ctx, async ({ authority, args, exec, enter, original }) => {
    reject(() => authority.enter({ ...exec }, args), 'EXECUTION_UNOBSERVED')
    reject(() => authority.inspect(Object.freeze({})), 'EXECUTION_OWNER_UNISSUED')
    const owner = enter()
    reject(() => authority.enter(exec, args), 'EXECUTION_ALREADY_ENTERED')
    reject(() => authority.enter(owner, args), 'EXECUTION_UNOBSERVED')
    reject(() => authority.inspect({ ...owner }), 'EXECUTION_OWNER_UNISSUED')
    reject(() => authority.inspect(JSON.parse(JSON.stringify(owner))), 'EXECUTION_OWNER_UNISSUED')
    return original(args, exec)
  })
  await h.run(agent)
  assert.equal(h.owners.length, 1)
})

for (const args of [{ name: 'demo', operation: 'claim' }, { name: 'demo', sourceVerified: true }, { name: 'demo', taskId: 'approved' }]) {
  test(`extra model field ${Object.keys(args)[1]} cannot select authority`, options, async t => {
    const h = await harness(t, [call('dshx_check', args), done()])
    const { agent } = await h.agent()
    await h.mount(h.ctx, async ({ authority, args, exec }) => {
      reject(() => authority.enter(exec, args), 'EXECUTION_ARGUMENTS_INVALID')
      reject(() => authority.enter(exec, args), 'EXECUTION_ARGUMENTS_INVALID')
      return { exitCode: 1 }
    })
    await h.run(agent)
    assert.equal(h.runs.length, 0)
  })
}

test('a copy of the frozen native arguments burns that invocation instead of accepting matching JSON', options, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  await h.mount(h.ctx, async ({ authority, args, exec }) => {
    assert.equal(Object.isFrozen(args), true)
    reject(() => authority.enter(exec, Object.freeze({ ...args })), 'EXECUTION_ARGUMENTS_INVALID')
    reject(() => authority.enter(exec, args), 'EXECUTION_ARGUMENTS_INVALID')
    return { exitCode: 1 }
  })
  await h.run(agent)
})

test('same-name replacement after pre observation cannot enter the private source', options, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  const c = await h.mount()
  let checked = 0
  h.ctx.on('tools/pre-execute', async (exec, next) => {
    c.disposers.get(exec.name)()
    const fake = { ...c.definitions.find(def => def.name === exec.name), execute: async (args, bodyExec) => {
      checked++
      h.guard(() => reject(() => c.authority.enter(bodyExec, args), ['EXECUTION_DEFINITION_CHANGED', 'EXECUTION_NOT_ACTIVE']))
      return { exitCode: 1 }
    } }
    h.ctx.tools.register(fake)
    return next()
  })
  await h.run(agent)
  assert.equal(checked, 1)
  assert.equal(h.owners.length, 0)
})

test('same-name scoped shadow was never an owned definition, even on the same registered Agent', options, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  const c = await h.mount()
  let checked = false
  agent.ctx.tools.register({ ...c.definitions.find(def => def.name === 'dshx_check'), execute: async (args, exec) => {
    checked = true
    h.guard(() => reject(() => c.authority.enter(exec, args), 'EXECUTION_UNOBSERVED'))
    return { exitCode: 1 }
  } })
  await h.run(agent)
  assert.equal(checked, true)
})

test('in-place execute replacement invalidates an already-entered owner and request', options, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  await h.mount(h.ctx, async ({ authority, enter, definition }) => {
    const owner = enter(), request = authority.makeApprovalRequest(owner)
    definition.execute = async () => ({ exitCode: 0 })
    reject(() => authority.revalidate(owner), 'EXECUTION_DEFINITION_CHANGED')
    assert.equal(request.signal.aborted, true)
    assert.equal(authority.lookupRequest(request), undefined)
    return { exitCode: 1 }
  })
  await h.run(agent)
})

test('caller cancellation cancels the owned official request while the body is still pending', options, async t => {
  const h = await harness(t, [call()])
  const { agent } = await h.agent()
  const asked = h.hold(), answer = h.hold(), decided = h.hold(), release = h.hold()
  let request, outcome
  const c = await h.mount(h.ctx, async ({ authority, enter }) => {
    request = authority.makeApprovalRequest(enter())
    outcome = await h.ctx.approval.request(request)
    decided.resolve()
    await release.promise
    return { exitCode: 1 }
  })
  h.ctx.on('approval/request', async () => { asked.resolve(); await answer.promise; return 'allowed-once' })
  agent.followup(user('cancel me'))
  await asked.promise
  agent.cancel({ kind: 'user' }, { keepInbox: true })
  await decided.promise
  assert.equal(outcome, 'cancelled')
  assert.equal(request.signal.aborted, true)
  assert.equal(c.authority.lookupRequest(request), undefined)
  answer.resolve(); release.resolve()
  await agent.whenIdle()
  assert.deepEqual(h.failures, [])
})

test('actual timeout policy cancels body/request without pretending the caller signal changed', options, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  let view
  const c = await h.mount(h.ctx, async ({ authority, enter }) => {
    const owner = enter()
    view = authority.inspect(owner)
    const request = authority.makeApprovalRequest(owner)
    await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }))
    assert.equal(view.callerSignal.aborted, false)
    assert.equal(view.bodySignal.aborted, true)
    reject(() => authority.revalidate(owner), 'EXECUTION_CANCELLED')
    return { exitCode: 1 }
  })
  c.definitions.find(def => def.name === 'dshx_check').timeoutMs = 10
  await h.run(agent)
  assert.ok(view)
})

test('producer disposal cancels its request and late answers cannot restore its owner', options, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  const asked = h.hold(), answer = h.hold(), decided = h.hold()
  let request, outcome
  const c = await h.mount(h.ctx, async ({ authority, enter }) => {
    request = authority.makeApprovalRequest(enter())
    outcome = await h.ctx.approval.request(request)
    decided.resolve()
    return { exitCode: 1 }
  })
  h.ctx.on('approval/request', async () => { asked.resolve(); await answer.promise; return 'allowed-once' })
  agent.followup(user('wait'))
  await asked.promise
  const disposing = c.producer.dispose()
  await decided.promise
  assert.equal(outcome, 'cancelled')
  assert.equal(c.authority.lookupRequest(request), undefined)
  answer.resolve()
  await disposing
  await agent.whenIdle()
  assert.deepEqual(h.failures, [])
})

test('two live scopes share no owner/request identity and unloading one leaves the other valid', options, async t => {
  const h = await harness(t, [call(), call('dshx_check', { name: 'demo' }, 'child'), done(), done()])
  const { agent: a } = await h.agent('a')
  const { agent: b } = await h.agent('b')
  let requestA, requestB, ownerA, ownerB, scoped
  const root = await h.mount(h.ctx, async ({ authority, enter, args, exec, original }) => {
    ownerA = enter(); requestA = authority.makeApprovalRequest(ownerA)
    b.followup(user('other scope'))
    await b.whenIdle()
    assert.equal(authority.revalidate(ownerA), ownerA)
    assert.equal(authority.lookupRequest(requestB), undefined)
    await scoped.producer.dispose()
    assert.equal(authority.lookupRequest(requestA).owner, ownerA)
    return original(args, exec)
  })
  scoped = await h.mount(b.ctx, async ({ authority, enter, args, exec, original }) => {
    ownerB = enter(); requestB = authority.makeApprovalRequest(ownerB)
    assert.equal(authority.lookupRequest(requestA), undefined)
    assert.equal(root.authority.lookupRequest(requestB), undefined)
    reject(() => authority.inspect(ownerA), 'EXECUTION_OWNER_UNISSUED')
    return original(args, exec)
  })
  await h.run(a)
  assert.notEqual(ownerA, ownerB)
})

test('a completed exec/token and same callId on a later native call do not replay an owner', options, async t => {
  const h = await harness(t, [call(), call(), done()])
  const { agent } = await h.agent()
  let prior, priorOwner, priorRequest
  await h.mount(h.ctx, async ({ authority, enter, args, exec, original }) => {
    if (prior) {
      reject(() => authority.enter(prior, prior.arguments), 'EXECUTION_ENDED')
      reject(() => authority.inspect(priorOwner), 'EXECUTION_ENDED')
      assert.equal(authority.lookupRequest(priorRequest), undefined)
      assert.equal(prior.callId, exec.callId)
      assert.notEqual(prior.token, exec.token)
    }
    priorOwner = enter(); priorRequest = authority.makeApprovalRequest(priorOwner); prior = exec
    return original(args, exec)
  })
  await h.run(agent)
  assert.equal(h.owners.length, 2)
})

test('replacing body signal after enter cannot bind a newly detached request', options, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  await h.mount(h.ctx, async ({ authority, exec, enter }) => {
    const owner = enter(), request = authority.makeApprovalRequest(owner)
    exec.signal = new AbortController().signal
    reject(() => authority.revalidate(owner), 'EXECUTION_BODY_SIGNAL_CHANGED')
    assert.equal(request.signal.aborted, true)
    assert.equal(authority.lookupRequest(request), undefined)
    return { exitCode: 1 }
  })
  await h.run(agent)
})

test('invalid definition maps and claim cannot expand the fixed operation vocabulary', options, async t => {
  const h = await harness(t, [])
  const c = await h.mount()
  const all = new Map(c.definitions.map(def => [def.name, def]))
  reject(() => createDevelopmentExecutionAuthority(h.ctx, all), 'EXECUTION_DEFINITIONS_INVALID')
  const wrong = new Map(names.slice(1).map(name => [name, all.get(name)]))
  wrong.set('dshx_claim_plugin', all.get('dshx_claim_plugin'))
  reject(() => createDevelopmentExecutionAuthority(h.ctx, wrong), 'EXECUTION_DEFINITIONS_INVALID')
})

test('a detached around-wrapper still cannot detach caller cancellation from the body or request', options, async t => {
  const h = await harness(t, [call()])
  const { agent } = await h.agent()
  const entered = h.hold(), release = h.hold()
  let view, request
  const c = await h.mount(h.ctx, async ({ authority, enter }) => {
    const owner = enter(); view = authority.inspect(owner); request = authority.makeApprovalRequest(owner)
    entered.resolve(); await release.promise
    return { exitCode: 1 }
  })
  const detached = new AbortController()
  h.ctx.on('tools/execute', async (exec, next) => {
    const old = exec.signal
    exec.signal = detached.signal
    try { return await next() } finally { exec.signal = old }
  }, { prepend: true })
  agent.followup(user('wait'))
  await entered.promise
  agent.cancel({ kind: 'user' }, { keepInbox: true })
  assert.equal(detached.signal.aborted, false)
  assert.equal(view.callerSignal.aborted, true)
  assert.equal(view.bodySignal.aborted, true)
  assert.equal(request.signal.aborted, true)
  assert.equal(c.authority.lookupRequest(request), undefined)
  release.resolve(); await agent.whenIdle()
  assert.deepEqual(h.failures, [])
})

test('native tool removal cancels its already-bound official request', options, async t => {
  const h = await harness(t, [call(), done()])
  const { agent } = await h.agent()
  const asked = h.hold(), answer = h.hold(), decided = h.hold()
  let request, outcome
  const c = await h.mount(h.ctx, async ({ authority, enter }) => {
    request = authority.makeApprovalRequest(enter())
    outcome = await h.ctx.approval.request(request)
    decided.resolve()
    return { exitCode: 1 }
  })
  h.ctx.on('approval/request', async () => { asked.resolve(); await answer.promise; return 'allowed-once' })
  agent.followup(user('remove during ask'))
  await asked.promise
  c.disposers.get('dshx_check')()
  await decided.promise
  assert.equal(outcome, 'cancelled')
  assert.equal(c.authority.lookupRequest(request), undefined)
  answer.resolve(); await agent.whenIdle()
  assert.deepEqual(h.failures, [])
})

test('disposing the native Agent/Session cancels an owner before the draining body completes', options, async t => {
  const h = await harness(t, [call()])
  const ownedAgent = await h.agent()
  const entered = h.hold(), release = h.hold()
  let request
  const c = await h.mount(h.ctx, async ({ authority, enter }) => {
    request = authority.makeApprovalRequest(enter())
    entered.resolve(); await release.promise
    return { exitCode: 1 }
  })
  ownedAgent.agent.followup(user('dispose me'))
  await entered.promise
  const disposing = ownedAgent.dispose()
  assert.equal(request.signal.aborted, true)
  assert.equal(c.authority.lookupRequest(request), undefined)
  release.resolve(); await disposing
  assert.equal(h.ctx.agents.get(ownedAgent.agent.id), undefined)
  assert.equal(h.ctx.sessions.get(ownedAgent.agent.id), undefined)
  assert.deepEqual(h.failures, [])
})

test('same-id Agent and Session lookalikes cannot replace the exact registered objects', options, async t => {
  const h = await harness(t, [call(), call('dshx_check', { name: 'demo' }, 'session-copy'), done()])
  const { agent } = await h.agent()
  let count = 0
  await h.mount(h.ctx, async ({ authority, args, exec }) => {
    if (count++ === 0) {
      const real = exec.agent
      exec.agent = { id: real.id, ctx: real.ctx, session: real.session }
      try { reject(() => authority.enter(exec, args), 'EXECUTION_IDENTITY_CHANGED') }
      finally { exec.agent = real }
    } else {
      const real = agent.session
      agent.session = { id: real.id, header: real.header }
      try { reject(() => authority.enter(exec, args), 'EXECUTION_AGENT_CHANGED') }
      finally { agent.session = real }
    }
    return { exitCode: 1 }
  })
  await h.run(agent)
  assert.equal(count, 2)
})

test('another native Context root with the same session id cannot inspect or look up this owner', options, async t => {
  const h1 = await harness(t, [call(), done()])
  const h2 = await harness(t, [call(), done()])
  const { agent: a } = await h1.agent('same-id')
  const { agent: b } = await h2.agent('same-id')
  let owner, request
  const second = await h2.mount(h2.ctx, async ({ authority, enter, args, exec, original }) => {
    assert.equal(a.id, b.id)
    assert.notEqual(a.ctx.root, b.ctx.root)
    reject(() => authority.inspect(owner), 'EXECUTION_OWNER_UNISSUED')
    assert.equal(authority.lookupRequest(request), undefined)
    enter()
    return original(args, exec)
  })
  await h1.mount(h1.ctx, async ({ authority, enter, args, exec, original }) => {
    owner = enter(); request = authority.makeApprovalRequest(owner)
    await h2.run(b)
    assert.equal(authority.revalidate(owner), owner)
    assert.equal(second.authority.lookupRequest(request), undefined)
    return original(args, exec)
  })
  await h1.run(a)
})
