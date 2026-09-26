import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nativeCreatorHarness, call, done } from './native-creator-harness.mjs'
import { CREATOR_MODEL_TOOLS } from '../src/compatibility.js'
const options = { timeout: 10000 }

for (const preset of ['read-only', 'workspace-write', 'danger-full-access']) {
  test(`actual C closures keep all four legacy argv under the verified ${preset} bundle without executor service`, options, async t => {
    const h = await nativeCreatorHarness(t, { script: [call('dshx_check'), call('dshx_activation_plan', { name: 'demo', change: 'artifact' }, 'plan'), call('dshx_hot_reload', { name: 'demo' }, 'reload'), call('dshx_activate_new_client', { name: 'demo' }, 'client'), done()] })
    const agent = await h.agent()
    h.ctx.permissionPresets.set(agent.session, preset)
    assert.equal(h.ctx.creatorExecution, undefined)
    for (const name of CREATOR_MODEL_TOOLS) assert.equal(typeof h.ctx.tools.get(name, agent).execute, 'function')
    await h.run(agent)
    assert.deepEqual(h.results.map(event => event.result.isError), [false, false, false, false])
    assert.deepEqual(h.runs.map(run => run.args), [
      ['check', 'demo'], ['activation-plan', 'demo', '--change', 'artifact'],
      ['hot-reload', 'demo', '--profile', 'web', '--port', '43127', '--json'],
      ['activate-new-client', 'demo', '--profile', 'web', '--port', '43127'],
    ])
    for (let i = 0; i < h.runs.length; i++) {
      assert.notEqual(h.runs[i].exec, h.observed[i]) // Only the legacy runner gets a private signal copy.
      assert.equal(h.runs[i].exec.token, h.observed[i].token)
      assert.equal(h.runs[i].exec.arguments, h.observed[i].arguments)
    }
  })
}
for (const mode of ['approve-for-me', 'nonstandard', 'custom']) {
  test(`actual C ${mode} never falls through to the runner without an executor`, options, async t => {
    const h = await nativeCreatorHarness(t, { script: [call('dshx_hot_reload'), done()], extraPresets: { nonstandard: { sandbox: 'workspace-write', approval: 'ask' } } })
    const agent = await h.agent()
    h.ctx.permissionPresets.set(agent.session, mode === 'custom' ? 'approve-for-me' : mode)
    if (mode === 'custom') h.ctx.approval.setPolicy(agent, 'never')
    let requests = 0
    h.ctx.on('approval/request', () => { requests++; return 'allowed-once' })
    await h.run(agent)
    assert.equal(h.runs.length, 0)
    assert.equal(h.results[0].result.isError, true)
    assert.equal(requests, 0)
  })
}
test('actual C sealed open refuses a creatorExecution generation installed while native pre was waiting', options, async t => {
  const connects = []
  const peer = () => {
    const life = new AbortController()
    return { signal: life.signal, supportedOperations: ['hot-reload'], lookupTarget() {}, readRegisteredTarget() {},
      prepare() { return {} }, authorize: async () => ({}), dispatch: async () => ({ exitCode: 1 }), release() {}, dispose() { life.abort() } }
  }
  const facade = (ctx, label) => Object.freeze({ protocol: 'creator-owned-execution-v1', root: ctx.root,
    connectProducer() { connects.push(label); return peer() } })
  let first
  const h = await nativeCreatorHarness(t, {
    script: [call('dshx_hot_reload'), done()],
    async beforeCreator(ctx) {
      first = await ctx.plugin({ apply(inner) { inner.provide('creatorExecution', facade(inner, 'pre')) } })
    },
  })
  const agent = await h.agent()
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  h.ctx.on('tools/pre-execute', async (exec, next) => {
    const downstream = await next()
    if (exec.name === 'dshx_hot_reload' && first) {
      await first.dispose(); first = undefined
      await h.ctx.plugin({ apply(inner) { inner.provide('creatorExecution', facade(inner, 'post-wait')) } })
    }
    return downstream
  }, { prepend: true })
  await h.run(agent)
  assert.equal(h.runs.length, 0)
  assert.equal(h.results[0].result.isError, true)
  assert.deepEqual(connects, [])
})

test('actual C legacy runner signal is cancelled by a native preset transition, without aborting the Agent signal', options, async t => {
  let runnerSignal
  const h = await nativeCreatorHarness(t, { runLegacy: async (_args, exec) => {
    runnerSignal = exec.signal
    h.ctx.permissionPresets.set(exec.agent.session, 'approve-for-me')
    assert.equal(runnerSignal.aborted, true)
    return { exitCode: 1, stdout: '', stderr: 'cancelled fixture runner' }
  } })
  const agent = await h.agent()
  await h.run(agent)
  assert.equal(h.runs.length, 1)
  assert.equal(h.observed[0].signal.aborted, false)
})
