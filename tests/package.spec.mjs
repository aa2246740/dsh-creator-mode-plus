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
  it('advertises all nine fixed tools and bounded same-PID hot reload in preset metadata', () => {
    const preset = read('preset/preset.yml')
    assert.match(preset, /九工具固定桥/)
    assert.match(preset, /受限同 PID 服务器模块热重载/)
    assert.doesNotMatch(preset, /七工具固定桥/)
  })

  it('does not teach agents to convert missing server HMR evidence into a restart', () => {
    const paths = ['README.md', 'README.en.md', 'docs/bridge-contract.md',
      'docs/dshx-v0.7-alignment.md', 'preset/skills/creator-mode-plus/SKILL.md']
    for (const path of paths) {
      const source = read(path)
      assert.doesNotMatch(source, /because the profile changed|A profile dependency is a manifest change|因为加了 profile 依赖|still (?:needs|requires) one controlled/i, path)
    }
    const skill = read('preset/skills/creator-mode-plus/SKILL.md')
    assert.match(skill, /ACTIVATION_DECISION_REQUIRED/)
    assert.match(skill, /not that a restart is required/)
    assert.match(skill, /Root Loader module replacement does not prove preset-private/)
    assert.doesNotMatch(skill, /`manifest` or `server`:/)
  })

  it('publishes the complete DSHX v0.7 contract and portable DSHX manifest', () => {
    const metadata = JSON.parse(read('package.json'))
    const manifest = read('dshx.yml')
    const verifier = read('scripts/verify-dshx.mjs')

    assert.equal(metadata.version, '0.3.4')
    assert.match(verifier, /DSHX_V075_COMPATIBILITY_PASS/)
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
      'dshx_hot_reload',
      'dshx_browser_open',
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
    assert.match(skill, /nine fixed model tools/)
    assert.match(skill, /dshx_hot_reload/)
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

  it('declares only the exact server module set for external self-upgrade', () => {
    const files = [...read('dshx.yml').matchAll(/^    - (.+)$/gm)].map(match => match[1])
    assert.deepEqual(files, ['src/index.js', 'src/runner.js', 'src/auth.js', 'src/delivery.js', 'src/compatibility.js', 'src/safety.js'])
    for (const file of files) {
      assert.doesNotThrow(() => read(file))
      for (const match of read(file).matchAll(/from ['"]\.\/([^'"]+)['"]/g)) {
        assert(files.includes(`src/${match[1]}`), `${file} imports an undeclared server artifact`)
      }
    }
    assert(!files.includes('src/client.js'))
  })
})
