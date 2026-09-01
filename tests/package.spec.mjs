import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  CREATOR_BRIDGE_VERSION,
  CREATOR_MODEL_TOOLS,
  DSHX_CONTRACT,
} from '../src/index.js'

const root = join(import.meta.dirname, '..')
const read = path => readFileSync(join(root, path), 'utf8')

describe('Creator Mode+ 0.3 package contract', () => {
  it('publishes the complete DSHX v0.7 contract and portable DSHX manifest', () => {
    const metadata = JSON.parse(read('package.json'))
    const manifest = read('dshx.yml')
    const verifier = read('scripts/verify-dshx.mjs')

    assert.equal(metadata.version, '0.3.3')
    assert.match(verifier, /DSHX_V074_COMPATIBILITY_PASS/)
    assert.doesNotMatch(verifier, /DSHX_V072_COMPATIBILITY_PASS/)
    assert.equal(metadata.files.includes('dshx.yml'), true)
    assert.equal(metadata.files.includes('scripts'), true)
    assert.equal(metadata.files.includes('docs'), false)
    assert.equal(metadata.files.includes('docs/screenshots/six-tools.png'), false)
    assert.equal(CREATOR_BRIDGE_VERSION, 2)
    assert.equal(DSHX_CONTRACT.id, 'dshx-v0.7/creator-bridge-v2')
    assert.deepEqual(CREATOR_MODEL_TOOLS, [
      'dshx_claim_plugin',
      'dshx_scaffold',
      'dshx_check',
      'dshx_activation_plan',
      'dshx_activate_new_client',
      'dshx_remove_plugin',
      'dshx_status',
    ])
    assert.match(manifest, /^id: dsh-creator-mode-plus$/m)
    assert.match(manifest, /^entry: src\/index\.js$/m)
    assert.match(manifest, /^kind: client$/m)
    assert.match(manifest, /\[dsh-creator-mode-plus\] loaded/)
  })

  it('ships one consistent v0.7 update-assistant authority boundary', () => {
    const currentDocs = [
      'README.md',
      'README.en.md',
      'docs/bridge-contract.md',
      'docs/dshx-v0.7-alignment.md',
      'preset/skills/creator-mode-plus/SKILL.md',
    ].map(path => [path, read(path)])

    for (const [path, source] of currentDocs) {
      assert.doesNotMatch(source, />=0\.6\.2 <0\.7\.0/, path)
      assert.match(source, /0\.7/, path)
    }
    const skill = read('preset/skills/creator-mode-plus/SKILL.md')
    assert.match(skill, /update plan → prepare → verify → apply/)
    assert.match(skill, /prepare.*verify.*apply.*rollback.*external DSHX supervisor/s)
    assert.match(skill, /seven fixed model tools/)
    assert.match(skill, /dshx_remove_plugin/)
    assert.match(skill, /dshx plugin remove/)
    assert.match(skill, /detached-orphan-symlink/)
    assert.doesNotMatch(skill, /Do not implement until the plan/)
    assert.doesNotMatch(skill, /activation_plan.*before implementation/)
    assert.match(skill, /fresh `new-client`.*before activation planning/s)
    assert.match(skill, /fresh `new-client`.*only after `dshx_check` exits `0`/s)
    const alignment = read('docs/dshx-v0.7-alignment.md')
    assert.match(alignment, /DSHX v0\.7\.3/)
    assert.match(alignment, /safe profile bundle removal|external bundle/i)
    assert.match(alignment, /seven tools|dshx_remove_plugin/i)
  })
})
