import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { healCreatorPlusPresets, migratePersona015 } from '../src/preset-015.js'

describe('0.1.5 persona heal', () => {
  it('rewrites a leftover text field to prefix', () => {
    const next = migratePersona015('  config:\n    suffix: cwd\n    text: |-\n      You are Creator Mode+\n')
    assert.match(next, /prefix: \|-/)
    assert.doesNotMatch(next, /text: \|-/)
  })

  it('heals both legacy and current preset ids in DSH_HOME', () => {
    const home = mkdtempSync(join(tmpdir(), 'creator-plus-heal-'))
    for (const id of ['creator-plus', 'creator-mode-plus']) {
      const dir = join(home, '.agent-presets', id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(dir + '/agent.cordis.yml', '- id: persona\n  config:\n    text: |-\n      stale\n')
    }
    const healed = healCreatorPlusPresets(home)
    assert.equal(healed.length, 2)
    for (const path of healed) {
      assert.match(readFileSync(path, 'utf8'), /prefix: \|-/)
    }
  })
})
