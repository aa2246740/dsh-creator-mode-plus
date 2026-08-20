import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { installCreatorModePlus } from '../scripts/install.mjs'

const temporaryRoots = []
const CURRENT_ROW = `- id: dsh-creator-mode-plus\n  name: dsh-creator-mode-plus`
const LEGACY_ROW = `- id: dshx-creator-plus\n  name: dsh-external-plugin-devkit/creator-plus`

function temporaryDirectory(label) {
  const path = mkdtempSync(join(tmpdir(), label))
  temporaryRoots.push(path)
  return path
}

function harnessAt(root) {
  mkdirSync(join(root, 'apps/cli/src'), { recursive: true })
  mkdirSync(join(root, 'apps/cli/config/agent-presets/standard'), { recursive: true })
  mkdirSync(join(root, 'tools/dshx/src'), { recursive: true })
  writeFileSync(join(root, 'apps/cli/src/bin.ts'), '')
  writeFileSync(join(root, 'tools/dshx/src/cli.ts'), '')
  writeFileSync(join(root, 'tools/dshx/package.json'), JSON.stringify({
    name: 'dsh-external-plugin-devkit',
    version: '0.5.1',
  }))
  writeFileSync(join(root, 'apps/cli/config/agent-presets/standard/preset.yml'), 'name: Standard\n')
  writeFileSync(join(root, 'apps/cli/config/agent-presets/standard/agent.cordis.yml'), `# The \`standard\` agent preset: the full coding agent, mounted once per process.
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
`)
  return root
}

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Creator Mode+ installer', () => {
  it('copies Standard into a new user preset without editing shipped files', () => {
    const harnessRoot = harnessAt(temporaryDirectory('creator-mode-plus-harness-'))
    const dshHome = temporaryDirectory('creator-mode-plus-home-')
    const source = join(harnessRoot, 'apps/cli/config/agent-presets/standard/agent.cordis.yml')
    const before = readFileSync(source, 'utf8')

    const result = installCreatorModePlus({ harnessRoot, dshHome })
    const composition = readFileSync(join(result.target, 'agent.cordis.yml'), 'utf8')

    assert.equal(result.action, 'installed')
    assert.match(result.target, /creator-mode-plus$/)
    assert.equal(readFileSync(source, 'utf8'), before)
    assert.match(composition, /You are Creator Mode\+/)
    assert.match(composition, /name: dsh-creator-mode-plus/)
    assert.equal(existsSync(join(result.target, 'skills/creator-mode-plus/SKILL.md')), true)
    assert.match(readFileSync(join(result.target, 'preset.yml'), 'utf8'), /Creator Mode\+/)
    assert.throws(() => installCreatorModePlus({ harnessRoot, dshHome }), /already exists/)
  })

  it('refreshes only managed assets and preserves user composition', () => {
    const harnessRoot = harnessAt(temporaryDirectory('creator-mode-plus-upgrade-harness-'))
    const dshHome = temporaryDirectory('creator-mode-plus-upgrade-home-')
    const installed = installCreatorModePlus({ harnessRoot, dshHome })
    const compositionPath = join(installed.target, 'agent.cordis.yml')
    const skillPath = join(installed.target, 'skills/creator-mode-plus/SKILL.md')
    writeFileSync(compositionPath, `${readFileSync(compositionPath, 'utf8')}\n# user-preserved\n`)
    writeFileSync(skillPath, '# stale managed skill\n')

    const updated = installCreatorModePlus({ harnessRoot, dshHome, upgrade: true })
    assert.equal(updated.action, 'updated')
    assert.match(readFileSync(compositionPath, 'utf8'), /# user-preserved/)
    assert.match(readFileSync(compositionPath, 'utf8'), /name: dsh-creator-mode-plus/)
    assert.match(readFileSync(skillPath, 'utf8'), /dshx_activate_new_client/)
  })

  it('transactionally migrates the one recognized bundled row', () => {
    const harnessRoot = harnessAt(temporaryDirectory('creator-mode-plus-migrate-harness-'))
    const dshHome = temporaryDirectory('creator-mode-plus-migrate-home-')
    const installed = installCreatorModePlus({ harnessRoot, dshHome })
    const legacyTarget = join(dshHome, '.agent-presets/creator-plus')
    renameSync(installed.target, legacyTarget)
    const compositionPath = join(legacyTarget, 'agent.cordis.yml')
    writeFileSync(
      compositionPath,
      `${readFileSync(compositionPath, 'utf8').replace(CURRENT_ROW, LEGACY_ROW)}\n# user-preserved\n`,
    )

    assert.throws(
      () => installCreatorModePlus({ harnessRoot, dshHome, upgrade: true }),
      /--migrate-legacy/,
    )
    const migrated = installCreatorModePlus({ harnessRoot, dshHome, migrateLegacy: true })
    const composition = readFileSync(compositionPath, 'utf8')
    assert.equal(migrated.action, 'migrated')
    assert.equal(migrated.target, legacyTarget)
    assert.match(composition, /# user-preserved/)
    assert.match(composition, /name: dsh-creator-mode-plus/)
    assert.doesNotMatch(composition, /dsh-external-plugin-devkit\/creator-plus/)
  })

  it('refuses an unrecognized managed row instead of guessing', () => {
    const harnessRoot = harnessAt(temporaryDirectory('creator-mode-plus-refuse-harness-'))
    const dshHome = temporaryDirectory('creator-mode-plus-refuse-home-')
    const installed = installCreatorModePlus({ harnessRoot, dshHome })
    const compositionPath = join(installed.target, 'agent.cordis.yml')
    writeFileSync(
      compositionPath,
      readFileSync(compositionPath, 'utf8').replace(CURRENT_ROW, '- id: user-edited\n  name: another-package'),
    )

    assert.throws(
      () => installCreatorModePlus({ harnessRoot, dshHome, upgrade: true }),
      /refusing an unsafe update/,
    )
  })
})
