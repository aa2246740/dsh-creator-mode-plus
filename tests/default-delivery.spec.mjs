import assert from 'node:assert/strict'
import test from 'node:test'
import { nativeCreatorHarness, call, done } from './native-creator-harness.mjs'

test('the shipped Creator preset can check and activate under approve-for-me without an undeployed experimental executor', async t => {
  const h = await nativeCreatorHarness(t, { developmentExecution: false, script: [
    call('dshx_check'), call('dshx_activation_plan', { name: 'demo', change: 'server' }, 'plan'),
    call('dshx_hot_reload', { name: 'demo' }, 'reload'), done(),
  ] })
  const agent = await h.agent()
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  await h.run(agent)
  assert.deepEqual(h.results.map(event => event.result.isError), [false, false, false])
  assert.deepEqual(h.runs.map(run => run.args[0]), ['check', 'activation-plan', 'hot-reload'])
  assert.equal(h.ctx.permissionPresets.current(agent.session), 'approve-for-me')
})

test('native tool guards still reject a denied mutation in the shipped Creator preset', async t => {
  const h = await nativeCreatorHarness(t, { developmentExecution: false, script: [call('dshx_hot_reload'), done()] })
  const agent = await h.agent()
  h.ctx.permissionPresets.set(agent.session, 'approve-for-me')
  h.ctx.tools.guard(exec => exec.name === 'dshx_hot_reload' ? 'fixture: user denied this mutation' : undefined)
  await h.run(agent)
  assert.equal(h.runs.length, 0)
  assert.equal(h.results[0].result.isError, true)
})
