import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { installCreatorModePlus } from '../scripts/install.mjs'
import { DSHX_SURFACE_MARKERS, REQUIRED_DSHX_PATHS } from '../src/compatibility.js'

const temporaryRoots = []
const CURRENT_ROW = `- id: dsh-creator-mode-plus\n  name: dsh-creator-mode-plus`
const LEGACY_ROW = `- id: dshx-creator-plus\n  name: dsh-external-plugin-devkit/creator-plus`
const ROOT_LEGACY_ROW = `- id: dshx-creator-plus\n  name: dsh-external-plugin-devkit`
const LEGACY_SIX_TOOL_PERSONA = 'Create file-backed DeepSeek Harness plugins through the six-tool DSHX v0.7 fixed bridge. Treat the official browser WebUI and public Cordis/client extension points as the compatibility target. App-shell APIs and wrapper-specific behavior are outside the supported surface. Harness update planning is read-only inside this session; prepare, verify, apply, rollback, and process control belong to the external DSHX supervisor.'
const SEVEN_TOOL_PERSONA = 'Create and safely remove file-backed DeepSeek Harness plugins through the seven-tool DSHX v0.7 fixed bridge. Treat the official browser WebUI and public Cordis/client extension points as the compatibility target. App-shell APIs and wrapper-specific behavior are outside the supported surface. Whole-plugin teardown must use dshx_remove_plugin so the live Host deactivates first and source is preserved. Harness update planning is read-only inside this session; prepare, verify, apply, rollback, and process control belong to the external DSHX supervisor.'
const CURRENT_PERSONA = `${SEVEN_TOOL_PERSONA} DSH.app, direct dsh web, and dshx are launchers for one long-lived Web Host per DSH_HOME; never start a second same-Home Host or keep an isolated verifier alive.`

function temporaryDirectory(label) {
  const path = mkdtempSync(join(tmpdir(), label))
  temporaryRoots.push(path)
  return path
}

function harnessAt(root, version = '0.7.4') {
  mkdirSync(join(root, 'apps/cli/src'), { recursive: true })
  mkdirSync(join(root, 'apps/cli/config/agent-presets/standard'), { recursive: true })
  writeFileSync(join(root, 'apps/cli/src/bin.ts'), '')
  for (const path of REQUIRED_DSHX_PATHS) {
    const target = join(root, 'tools/dshx', path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, DSHX_SURFACE_MARKERS[path].join('\n'))
  }
  writeFileSync(join(root, 'tools/dshx/package.json'), JSON.stringify({
    name: 'dsh-external-plugin-devkit',
    version,
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
    assert.equal(result.dshxVersion, '0.7.4')
    assert.equal(result.creatorBridgeVersion, 2)
    assert.equal(result.dshxContract, 'dshx-v0.7/creator-bridge-v2')
    assert.match(result.target, /creator-mode-plus$/)
    assert.equal(readFileSync(source, 'utf8'), before)
    assert.match(composition, /You are Creator Mode\+/)
    assert.match(composition, /one long-lived Web Host per DSH_HOME/)
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
    writeFileSync(compositionPath, `${readFileSync(compositionPath, 'utf8')
      .replace(CURRENT_PERSONA, LEGACY_SIX_TOOL_PERSONA)
      .replace('# Bridge v2: seven fixed dshx tools plus external Guardian lifecycle hooks; no arbitrary argv, raw plugin teardown, or model process control.', '# Bridge v2: six fixed dshx tools plus external Guardian lifecycle hooks; no shell, arbitrary argv, or model process control.')}\n# user-preserved\n`)
    writeFileSync(skillPath, '# stale managed skill\n')

    const updated = installCreatorModePlus({ harnessRoot, dshHome, upgrade: true })
    assert.equal(updated.action, 'updated')
    assert.match(readFileSync(compositionPath, 'utf8'), /# user-preserved/)
    assert.match(readFileSync(compositionPath, 'utf8'), /name: dsh-creator-mode-plus/)
    assert.match(readFileSync(compositionPath, 'utf8'), /seven-tool DSHX v0\.7 fixed bridge/)
    assert.match(readFileSync(compositionPath, 'utf8'), /one long-lived Web Host per DSH_HOME/)
    assert.doesNotMatch(readFileSync(compositionPath, 'utf8'), /six-tool DSHX v0\.7 fixed bridge/)
    assert.match(readFileSync(skillPath, 'utf8'), /dshx_activate_new_client/)
  })

  it('keeps the composition stamp stable when an upgrade changes only managed assets', () => {
    const harnessRoot = harnessAt(temporaryDirectory('creator-mode-plus-idempotent-harness-'))
    const dshHome = temporaryDirectory('creator-mode-plus-idempotent-home-')
    const installed = installCreatorModePlus({ harnessRoot, dshHome })
    const compositionPath = join(installed.target, 'agent.cordis.yml')
    const before = statSync(compositionPath)

    installCreatorModePlus({ harnessRoot, dshHome, upgrade: true })

    const after = statSync(compositionPath)
    assert.equal(after.size, before.size)
    assert.equal(after.mtimeMs, before.mtimeMs)
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

  it('also migrates the DSHX 0.6 package-root bundled row', () => {
    const harnessRoot = harnessAt(temporaryDirectory('creator-mode-plus-root-migrate-harness-'))
    const dshHome = temporaryDirectory('creator-mode-plus-root-migrate-home-')
    const installed = installCreatorModePlus({ harnessRoot, dshHome })
    const legacyTarget = join(dshHome, '.agent-presets/creator-plus')
    renameSync(installed.target, legacyTarget)
    const compositionPath = join(legacyTarget, 'agent.cordis.yml')
    writeFileSync(compositionPath, readFileSync(compositionPath, 'utf8').replace(CURRENT_ROW, ROOT_LEGACY_ROW))

    const migrated = installCreatorModePlus({ harnessRoot, dshHome, migrateLegacy: true })
    assert.equal(migrated.action, 'migrated')
    assert.match(readFileSync(compositionPath, 'utf8'), /name: dsh-creator-mode-plus/)
  })

  it('fails before preset mutation when DSHX is older than the complete v0.7 contract', () => {
    const harnessRoot = harnessAt(temporaryDirectory('creator-mode-plus-old-dshx-harness-'), '0.6.2')
    const dshHome = temporaryDirectory('creator-mode-plus-old-dshx-home-')
    assert.throws(
      () => installCreatorModePlus({ harnessRoot, dshHome }),
      /dshx 0\.6\.2 is incompatible/,
    )
    assert.equal(existsSync(join(dshHome, '.agent-presets')), false)
  })

  it('fails before preset mutation when DSHX v0.7 is missing Update Assistant surfaces', () => {
    const harnessRoot = harnessAt(temporaryDirectory('creator-mode-plus-incomplete-dshx-harness-'))
    const dshHome = temporaryDirectory('creator-mode-plus-incomplete-dshx-home-')
    rmSync(join(harnessRoot, 'tools/dshx/src/commands/update.ts'))
    assert.throws(
      () => installCreatorModePlus({ harnessRoot, dshHome }),
      /missing required dshx-v0\.7\/creator-bridge-v2 surfaces/,
    )
    assert.equal(existsSync(join(dshHome, '.agent-presets')), false)
  })

  it('fails before preset mutation when a named v0.7 surface has contract drift', () => {
    const harnessRoot = harnessAt(temporaryDirectory('creator-mode-plus-drifted-dshx-harness-'))
    const dshHome = temporaryDirectory('creator-mode-plus-drifted-dshx-home-')
    writeFileSync(join(harnessRoot, 'tools/dshx/src/commands/update.ts'), 'export function cmdUpdate() {}\n')
    assert.throws(
      () => installCreatorModePlus({ harnessRoot, dshHome }),
      /contract drift for dshx-v0\.7\/creator-bridge-v2: src\/commands\/update\.ts/,
    )
    assert.equal(existsSync(join(dshHome, '.agent-presets')), false)
  })

  it('fails before preset mutation when DSHX lacks the RC2 boot-manifest parser', () => {
    const harnessRoot = harnessAt(temporaryDirectory('creator-mode-plus-rc2-parser-harness-'))
    const dshHome = temporaryDirectory('creator-mode-plus-rc2-parser-home-')
    writeFileSync(
      join(harnessRoot, 'tools/dshx/src/internal/new-client.ts'),
      "const marker = 'window.__DSH_BOOT__ = '\n",
    )
    assert.throws(
      () => installCreatorModePlus({ harnessRoot, dshHome }),
      /contract drift for dshx-v0\.7\/creator-bridge-v2: src\/internal\/new-client\.ts/,
    )
    assert.equal(existsSync(join(dshHome, '.agent-presets')), false)
  })

  it('fails before preset mutation when DSHX lacks the single-Home Host gate', () => {
    const harnessRoot = harnessAt(temporaryDirectory('creator-mode-plus-host-gate-harness-'))
    const dshHome = temporaryDirectory('creator-mode-plus-host-gate-home-')
    writeFileSync(join(harnessRoot, 'tools/dshx/src/commands/host.ts'), 'shared-home-collision\n')
    assert.throws(
      () => installCreatorModePlus({ harnessRoot, dshHome }),
      /contract drift for dshx-v0\.7\/creator-bridge-v2: src\/commands\/host\.ts/,
    )
    assert.equal(existsSync(join(dshHome, '.agent-presets')), false)
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
