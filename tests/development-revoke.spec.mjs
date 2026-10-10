/** Revoke-only authority unit assertion on native executions. This auxiliary
 * authority is NOT the private C producer and is never connected to a peer. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nativeCreatorHarness } from './native-creator-harness.mjs'
import { createDevelopmentExecutionAuthority, DevelopmentExecutionError } from '../src/development-execution.js'
const names = ['dshx_check', 'dshx_activation_plan', 'dshx_hot_reload', 'dshx_activate_new_client']

test('private revoke cancels its exact request once, exposes no mutation on reader and leaves the original C invocation live', { timeout: 10000 }, async t => {
  let auxiliary, owner, request, before, runnerWasLive
  const h = await nativeCreatorHarness(t, { runLegacy: async (_args, exec) => {
    runnerWasLive = !exec.signal.aborted
    return { exitCode: 0, stdout: '', stderr: '' }
  } })
  const agent = await h.agent()
  await h.ctx.plugin({ inject: ['tools', 'agents', 'sessions'], apply(inner) {
    auxiliary = createDevelopmentExecutionAuthority(inner, new Map(names.map(name => [name, inner.tools.get(name, agent)])))
    inner.on('tools/execute', async (exec, next) => {
      owner = auxiliary.enter(exec, exec.arguments)
      request = auxiliary.makeApprovalRequest(owner)
      before = request.signal
      assert.deepEqual(Object.keys(auxiliary.reader), ['lookupRequest'])
      assert.equal(auxiliary.revoke(owner), true)
      assert.equal(auxiliary.revoke(owner), false)
      assert.equal(request.signal, before)
      assert.equal(request.signal.aborted, true)
      assert.equal(exec.signal.aborted, false)
      assert.equal(auxiliary.lookupRequest(request), undefined)
      assert.throws(() => auxiliary.revalidate(owner), /EXECUTION_REVOKED/)
      assert.throws(() => auxiliary.makeApprovalRequest(owner), /EXECUTION_REVOKED/)
      assert.throws(() => auxiliary.revoke({ ...owner }), value => value instanceof DevelopmentExecutionError && value.code === 'EXECUTION_OWNER_UNISSUED')
      return await next()
    })
  } })
  await h.run(agent)
  assert.ok(owner)
  assert.equal(runnerWasLive, true)
  assert.equal(h.runs.length, 1)
  assert.equal(h.results[0].result.isError, false)
})
