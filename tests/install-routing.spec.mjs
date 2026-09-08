import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordDelivery, deliveryStatus } from '../src/delivery.js'

test('watcher trial: old-source plan without check requests the exact target check, not UI verification', () => {
  const root = mkdtempSync(join(tmpdir(), 'creator-install-routing-'))
  try {
    // Minimal public facts from session-5eab8f44: the candidate built elsewhere,
    // but the fixed ID resolved to the installed source and no fixed check ran.
    const plan = { data: { change: 'client', facts: {
      packageDir: '/installed/dsh-watcher', hasClient: true,
      handoff: { port: 43127, launcher: 'app' },
    }, decision: { hostRestart: 'not-required' } } }
    const row = recordDelivery(root, ['activation-plan', 'dsh-watcher', '--change', 'client'],
      { exitCode: 0, stdout: JSON.stringify(plan) }, 'trial-session', 42)
    const status = deliveryStatus(row, { pid: 42, port: 43127 })
    assert.equal(status.state, 'SOURCE_BUILD_REQUIRED')
    assert.match(status.next, /dshx_check/)
    assert.match(status.next, /sourcePath/)
    assert.match(status.targetScope, /another directory/)
    assert.doesNotMatch(status.next, /Use the authenticated current WebUI/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('checked undecided server directs the bounded hot reload tool, not an inferred restart', () => {
  const status = deliveryStatus({ pluginId: 'demo', sourceBuilt: true,
    plan: { change: 'server', packageDir: '/installed/demo', hostRestart: 'not-decided' },
  }, { pid: 42, port: 43127 })
  assert.match(status.next, /dshx_hot_reload/)
  assert.doesNotMatch(status.next, /decides between.*restart/)
})

test('wrong Host cannot receive an activation or UI-verification instruction', () => {
  const status = deliveryStatus({ pluginId: 'demo', sourceBuilt: true,
    plan: { change: 'client', packageDir: '/installed/demo', handoff: { port: 1234 } },
  }, { pid: 42, port: 43127 })
  assert.equal(status.state, 'TARGET_MISMATCH')
  assert.match(status.next, /target/i)
  assert.doesNotMatch(status.next, /Use the authenticated current WebUI/)
})


test('server HMR exception never waives an unrelated failed plan gate', () => {
  const root = mkdtempSync(join(tmpdir(), 'creator-install-gates-'))
  try {
    for (const extraError of [false, true]) {
      const report = { findings: [{ level: 'error', code: 'activation-blocker' },
        ...(extraError ? [{ level: 'error', code: 'offline-composition' }] : [])],
        data: { change: 'server', facts: { packageDir: '/installed/demo' },
          decision: { hostRestart: 'not-decided' } } }
      const row = recordDelivery(root, ['activation-plan', 'demo'],
        { exitCode: 1, stdout: JSON.stringify(report) }, 'session-gate', 42)
      row.sourceBuilt = true
      const status = deliveryStatus(row, { pid: 42, port: 43127 })
      assert.equal(status.state, extraError ? 'ACTIVATION_PLAN_REQUIRED' : 'ACTIVATION_DECISION_REQUIRED')
      if (extraError) assert.doesNotMatch(status.next, /call dshx_hot_reload/)
      else assert.match(status.next, /call dshx_hot_reload/)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
