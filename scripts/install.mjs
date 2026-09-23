import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { migratePersona015 } from '../src/preset-015.js'
import { inspectDshxCompatibility, resolveHarnessRoot } from '../src/runner.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CURRENT_PRESET_ID = 'creator-mode-plus'
const LEGACY_PRESET_ID = 'creator-plus'
const CURRENT_ROW = `- id: dsh-creator-mode-plus\n  name: dsh-creator-mode-plus`
const LEGACY_ROWS = [
  `- id: dshx-creator-plus\n  name: dsh-external-plugin-devkit/creator-plus`,
  `- id: dshx-creator-plus\n  name: dsh-external-plugin-devkit`,
]
const LEGACY_SIX_TOOL_PERSONA = 'Create file-backed DeepSeek Harness plugins through the six-tool DSHX v0.7 fixed bridge. Treat the official browser WebUI and public Cordis/client extension points as the compatibility target. App-shell APIs and wrapper-specific behavior are outside the supported surface. Harness update planning is read-only inside this session; prepare, verify, apply, rollback, and process control belong to the external DSHX supervisor.'
const SEVEN_TOOL_PERSONA = 'Create and safely remove file-backed DeepSeek Harness plugins through the seven-tool DSHX v0.7 fixed bridge. Treat the official browser WebUI and public Cordis/client extension points as the compatibility target. App-shell APIs and wrapper-specific behavior are outside the supported surface. Whole-plugin teardown must use dshx_remove_plugin so the live Host deactivates first and source is preserved. Harness update planning is read-only inside this session; prepare, verify, apply, rollback, and process control belong to the external DSHX supervisor.'
const CURRENT_PERSONA = `${SEVEN_TOOL_PERSONA} DSH.app, direct dsh web, and dshx are launchers for one long-lived Web Host per DSH_HOME; never start a second same-Home Host or keep an isolated verifier alive.`
const LEGACY_SIX_TOOL_COMMENT = '# Bridge v2: six fixed dshx tools plus external Guardian lifecycle hooks; no shell, arbitrary argv, or model process control.'
const SEVEN_TOOL_COMMENT = '# Bridge v2: seven fixed dshx tools plus external Guardian lifecycle hooks; no arbitrary argv, raw plugin teardown, or model process control.'

const STANDARD_PRESET_PATHS = [
  'packages/preset/agent-presets/presets/standard',
  'apps/cli/config/agent-presets/standard',
]
const STANDARD_PATCH_PATH = 'packages/bundle/web-app/presets/standard.patch.yml'
const WEB_PROFILE = 'web'
const PROFILE_INCLUDE_PATH = 'creator-mode-plus/agent.cordis.yml'
const PROFILE_INCLUDE = `# Creator Mode+ preset include. The installer owns this block.
- insert:
    - id: creator-mode-plus-preset
      name: cordis:include
      config:
        path: ${PROFILE_INCLUDE_PATH}
`

export function standardPresetAt(root) {
  for (const relative of STANDARD_PRESET_PATHS) {
    const path = join(root, relative)
    if (existsSync(join(path, 'agent.cordis.yml')) && existsSync(join(path, 'preset.yml'))) return path
  }
  throw new Error(`Creator Mode+ installer cannot find the shipped Standard preset under ${root}`)
}

/** Shipped Standard composition. 0.1.7 stores it as a bundle patch; older lines use a preset directory. */
export function standardSourceAt(root) {
  const patch = join(root, STANDARD_PATCH_PATH)
  if (existsSync(patch)) return Object.freeze({ kind: 'patch', path: patch })
  return Object.freeze({ kind: 'directory', path: standardPresetAt(root) })
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function countManagedRow(text, row) {
  const exact = exactRowCount(text, row)
  if (exact > 0) return exact
  const [idLine, nameLine] = row.split('\n')
  const pattern = new RegExp(
    `^[ \\t]*${escapeRegExp(idLine)}\\n[ \\t]*${escapeRegExp(nameLine.trim())}(?=\\n|$)`,
    'gm',
  )
  return [...text.matchAll(pattern)].length
}

function reindentPlugins(plugins) {
  const body = plugins.split('\n').map(line => (line.startsWith('    ') ? line.slice(4) : line)).join('\n')
  return body.endsWith('\n') ? body : `${body}\n`
}

function rewritePatchPersona(plugins) {
  const match = /^([ \t]*)prefix: You are a coding agent powered by the \{\{model\}\} model\.$/m.exec(plugins)
  if (!match) {
    throw new Error('Creator Mode+ installer expected the shipped Standard persona prefix')
  }
  const indent = match[1]
  const lines = [
    'You are Creator Mode+, a coding agent powered by the {{model}} model.',
    '',
    CURRENT_PERSONA,
    '',
    'Load the `creator-mode-plus` skill before creating, activating, removing, hot-reloading, updating Harness, or validating a DSH plugin. Keep Harness core and shipped presets unchanged.',
  ]
  const body = lines.map(line => (line.length === 0 ? '' : `${indent}  ${line}`)).join('\n')
  const replacement = `${indent}prefix: |-\n${body}`
  return plugins.slice(0, match.index) + replacement + plugins.slice(match.index + match[0].length)
}

function deriveCreatorDeclaration(standardPatch) {
  const marker = '\n        plugins:\n'
  const index = standardPatch.indexOf(marker)
  if (index < 0 || standardPatch.indexOf(marker, index + marker.length) >= 0) {
    throw new Error('Creator Mode+ installer expected exactly one Standard preset plugin list')
  }
  let plugins = rewritePatchPersona(reindentPlugins(standardPatch.slice(index + marker.length)))
  plugins = replaceOnce(
    plugins,
    `      - id: skill-filesystem\n        name: '@deepseek-ai/dsh-skill-filesystem'`,
    `      - id: skill-filesystem\n        name: '@deepseek-ai/dsh-skill-filesystem'\n        config:\n          customSkillDirs:\n            - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"`,
    'skill filesystem',
  )
  plugins = replaceOnce(
    plugins,
    `      - id: tool-skill\n        name: '@deepseek-ai/dsh-tool-skill'`,
    `      - id: tool-skill\n        name: '@deepseek-ai/dsh-tool-skill'\n\n      # Bridge v2: seven fixed dshx tools plus external Guardian lifecycle hooks; no arbitrary argv, raw plugin teardown, or model process control.\n      - id: dsh-creator-mode-plus\n        name: dsh-creator-mode-plus`,
    'tool skill',
  )
  const description = '在 DSH 对话中创建、修改并加载插件，继续验证实际功能；支持保留当前会话的热更新和故障恢复。'
  return `# Creator Mode+ starts from the shipped Standard preset and adds the fixed dshx bridge.
- id: preset-creator-mode-plus
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: creator-mode-plus
    name: Creator Mode+
    description: ${JSON.stringify(description)}
    order: 20
    plugins:
${plugins}`
}

function profilePresetDir(dshHome) {
  return join(dshHome, 'profiles', WEB_PROFILE, 'creator-mode-plus')
}

function withoutPatchComments(text) {
  return text.replace(/^[ \t]*#.*$/gm, '').trim()
}

function ensureProfileInclude(profileDir) {
  mkdirSync(profileDir, { recursive: true })
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  const body = withoutPatchComments(existing)
  // Official profile init writes a comment header plus an empty array. A later
  // sequence item after `[]` is not a patch entry, so replace that array.
  if (body === '[]' || body.startsWith('[]\n')) {
    const repaired = existing.replace(/^[ \t]*\[\][ \t]*\r?\n/m, '')
    const next = repaired.includes(`path: ${PROFILE_INCLUDE_PATH}`)
      ? repaired
      : `${repaired.endsWith('\n') || repaired.length === 0 ? repaired : `${repaired}\n`}${PROFILE_INCLUDE}`
    if (next !== existing) writeFileSync(patchPath, next)
    return patchPath
  }
  if (existing.includes(`path: ${PROFILE_INCLUDE_PATH}`)) return patchPath
  const prefix = existing.length === 0 || existing.endsWith('\n') ? existing : `${existing}\n`
  writeFileSync(patchPath, `${prefix}${PROFILE_INCLUDE}`)
  return patchPath
}

function writeProfilePreset(target, composition) {
  const root = dirname(target)
  mkdirSync(root, { recursive: true })
  const temporaryRoot = mkdtempSync(join(root, '.dsh-creator-mode-plus-install-'))
  const staging = join(temporaryRoot, 'creator-mode-plus')
  try {
    mkdirSync(staging, { recursive: true })
    writeFileSync(join(staging, 'agent.cordis.yml'), composition)
    cpSync(join(packageRoot, 'preset/preset.yml'), join(staging, 'preset.yml'))
    cpSync(join(packageRoot, 'preset/skills'), join(staging, 'skills'), { recursive: true })
    tightenTree(staging)
    renameSync(staging, target)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
  ensureProfileInclude(root)
}

function recognizedLegacyRow(composition) {
  const matches = LEGACY_ROWS.filter(row => countManagedRow(composition, row) === 1)
  const legacyCount = LEGACY_ROWS.reduce((count, row) => count + countManagedRow(composition, row), 0)
  if (legacyCount !== 1 || matches.length !== 1) {
    throw new Error('Creator Mode+ preset does not contain exactly one recognized managed plugin row; refusing an unsafe update')
  }
  return matches[0]
}

function replaceOnce(text, search, replacement, label) {
  const first = text.indexOf(search)
  if (first < 0 || text.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Creator Mode+ installer expected exactly one ${label} block in the Standard preset`)
  }
  return text.slice(0, first) + replacement + text.slice(first + search.length)
}

function tightenTree(path) {
  const info = statSync(path)
  if (info.isDirectory()) {
    chmodSync(path, 0o700)
    for (const name of readdirSync(path)) tightenTree(join(path, name))
    return
  }
  chmodSync(path, info.mode & 0o111 ? 0o700 : 0o600)
}

function exactRowCount(text, row) {
  let count = 0
  let offset = 0
  while (offset <= text.length) {
    const index = text.indexOf(row, offset)
    if (index < 0) break
    const next = text[index + row.length]
    if (next === undefined || next === '\n' || next === '\r') count += 1
    offset = index + row.length
  }
  return count
}

const PERSONA_PREFIX = `    prefix: |-\n      You are Creator Mode+, a coding agent powered by the {{model}} model.\n\n      ${CURRENT_PERSONA}\n\n      Load the \`creator-mode-plus\` skill before creating, activating, removing, hot-reloading, updating Harness, or validating a DSH plugin. Keep Harness core and shipped presets unchanged.`
const PERSONA_RC2 = `    suffix: Your working directory is {{cwd}}.\n    prefix: >-\n      You are a coding agent powered by the {{model}} model.`
const PERSONA_RC2_REPLACEMENT = `    suffix: Your working directory is {{cwd}}.\n${PERSONA_PREFIX}`
const PERSONA_RC1 = `    text: >-\n      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.`
const PERSONA_RC1_REPLACEMENT = `${PERSONA_PREFIX}\n    suffix: Your working directory is {{cwd}}.`

function rewritePersona(standard) {
  if (standard.includes(PERSONA_RC2)) {
    return replaceOnce(standard, PERSONA_RC2, PERSONA_RC2_REPLACEMENT, 'persona')
  }
  if (standard.includes(PERSONA_RC1)) {
    return replaceOnce(standard, PERSONA_RC1, PERSONA_RC1_REPLACEMENT, 'persona')
  }
  throw new Error('Creator Mode+ installer expected a 0.1.5 prefix/suffix or legacy text persona in the Standard preset')
}

function creatorComposition(standard) {
  let text = replaceOnce(
    standard,
    '# The `standard` agent preset: the full coding agent, mounted once per process.',
    '# Creator Mode+ starts from the shipped Standard preset and adds the fixed dshx bridge.',
    'preset heading',
  )
  text = rewritePersona(text)
  text = replaceOnce(
    text,
    `- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'`,
    `- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n  config:\n    customSkillDirs:\n      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"`,
    'skill filesystem',
  )
  return replaceOnce(
    text,
    `- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'`,
    `- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n\n# Bridge v2: seven fixed dshx tools plus external Guardian lifecycle hooks; no arbitrary argv, raw plugin teardown, or model process control.\n${CURRENT_ROW}`,
    'tool skill',
  )
}

function migrateManagedSafetyCopy(text) {
  let next = migratePersona015(text)
  for (const [before, after] of [
    [LEGACY_SIX_TOOL_PERSONA, SEVEN_TOOL_PERSONA],
    [SEVEN_TOOL_PERSONA, CURRENT_PERSONA],
    [LEGACY_SIX_TOOL_COMMENT, SEVEN_TOOL_COMMENT],
  ]) {
    if (before === SEVEN_TOOL_PERSONA && next.includes(CURRENT_PERSONA)) continue
    const first = next.indexOf(before)
    if (first < 0) continue
    if (next.indexOf(before, first + before.length) >= 0) {
      throw new Error('Creator Mode+ preset contains duplicate legacy managed safety text; refusing an unsafe update')
    }
    next = next.slice(0, first) + after + next.slice(first + before.length)
  }
  return next
}

function refreshManagedAssets(target, root, migrateLegacy) {
  const compositionPath = join(target, 'agent.cordis.yml')
  const originalComposition = existsSync(compositionPath) ? readFileSync(compositionPath, 'utf8') : ''
  let composition = originalComposition
  const currentCount = countManagedRow(composition, CURRENT_ROW)
  const matchingLegacyRows = LEGACY_ROWS.filter(row => countManagedRow(composition, row) === 1)
  const legacyCount = LEGACY_ROWS.reduce((count, row) => count + countManagedRow(composition, row), 0)

  if (currentCount === 1 && legacyCount === 0) {
    // Current composition remains user-owned; only managed assets are refreshed.
  } else if (currentCount === 0 && legacyCount === 1 && migrateLegacy) {
    composition = composition.replace(matchingLegacyRows[0], CURRENT_ROW)
  } else if (legacyCount === 1 && !migrateLegacy) {
    throw new Error('legacy bundled Creator Mode+ found; rerun with --migrate-legacy after adding dsh-creator-mode-plus to the Web profile')
  } else {
    throw new Error('Creator Mode+ preset does not contain exactly one recognized managed plugin row; refusing an unsafe update')
  }
  composition = migrateManagedSafetyCopy(composition)

  const temporaryRoot = mkdtempSync(join(root, '.dsh-creator-mode-plus-upgrade-'))
  const staging = join(temporaryRoot, 'next')
  const backup = join(temporaryRoot, 'previous')
  let movedOriginal = false
  let installedNext = false
  try {
    cpSync(target, staging, { recursive: true, errorOnExist: true, preserveTimestamps: true })
    if (composition !== originalComposition) writeFileSync(join(staging, 'agent.cordis.yml'), composition)
    rmSync(join(staging, 'skills/creator-mode-plus'), { recursive: true, force: true })
    cpSync(
      join(packageRoot, 'preset/skills/creator-mode-plus'),
      join(staging, 'skills/creator-mode-plus'),
      { recursive: true, errorOnExist: true },
    )
    cpSync(join(packageRoot, 'preset/preset.yml'), join(staging, 'preset.yml'), { force: true })
    tightenTree(join(staging, 'skills/creator-mode-plus'))
    tightenTree(join(staging, 'preset.yml'))

    renameSync(target, backup)
    movedOriginal = true
    renameSync(staging, target)
    installedNext = true
    if (composition === originalComposition) {
      rmSync(join(target, 'agent.cordis.yml'))
      renameSync(join(backup, 'agent.cordis.yml'), join(target, 'agent.cordis.yml'))
    }
  } catch (error) {
    if (installedNext && existsSync(target)) rmSync(target, { recursive: true, force: true })
    if (movedOriginal && existsSync(backup)) renameSync(backup, target)
    throw error
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

function installFromStandardPatch({ sourcePath, dshHome, compatibility, upgrade, migrateLegacy }) {
  const target = profilePresetDir(dshHome)
  const legacyDirs = [
    join(dshHome, '.agent-presets', CURRENT_PRESET_ID),
    join(dshHome, '.agent-presets', LEGACY_PRESET_ID),
  ].filter(path => existsSync(path))
  const currentExists = existsSync(target)
  const result = (action) => ({
    target,
    action,
    dshxVersion: compatibility.dshxVersion,
    creatorBridgeVersion: compatibility.creatorBridgeVersion,
    dshxContract: compatibility.contractId,
    layout: 'profile-include',
  })

  if (currentExists && legacyDirs.length > 0) {
    throw new Error(`both ${target} and a legacy .agent-presets Creator Mode+ exist; refusing to choose or overwrite either preset`)
  }
  if (currentExists) {
    if (!upgrade && !migrateLegacy) {
      throw new Error(`Creator Mode+ already exists at ${target}; pass --upgrade to refresh only managed assets`)
    }
    refreshManagedAssets(target, dirname(target), false)
    ensureProfileInclude(dirname(target))
    return result('updated')
  }
  if (legacyDirs.length > 0) {
    if (!migrateLegacy) {
      throw new Error(`legacy Creator Mode+ exists at ${legacyDirs[0]}; pass --migrate-legacy after adding the standalone package`)
    }
    if (legacyDirs.length > 1) {
      throw new Error(`both ${legacyDirs[0]} and ${legacyDirs[1]} exist; refusing to choose or overwrite either preset`)
    }
    const compositionPath = join(legacyDirs[0], 'agent.cordis.yml')
    let composition = readFileSync(compositionPath, 'utf8')
    if (countManagedRow(composition, CURRENT_ROW) !== 1) {
      composition = composition.replace(recognizedLegacyRow(composition), CURRENT_ROW)
    }
    composition = migrateManagedSafetyCopy(composition)
    const indented = composition.replace(/[ \t]+$/gm, '').replace(/\n$/, '').split('\n')
      .map(line => (line.length === 0 ? '' : `      ${line}`))
      .join('\n')
    const description = '在 DSH 对话中创建、修改并加载插件，继续验证实际功能；支持保留当前会话的热更新和故障恢复。'
    writeProfilePreset(target, `# Creator Mode+ preset migrated from .agent-presets. The legacy directory is preserved.
- id: preset-creator-mode-plus
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: creator-mode-plus
    name: Creator Mode+
    description: ${JSON.stringify(description)}
    order: 20
    plugins:
${indented}
`)
    return result('migrated')
  }
  if (upgrade || migrateLegacy) {
    throw new Error('no existing Creator Mode+ preset found to update or migrate')
  }
  writeProfilePreset(target, deriveCreatorDeclaration(readFileSync(sourcePath, 'utf8')))
  return result('installed')
}

/** Install or safely refresh the user-owned Creator Mode+ preset. */
export function installCreatorModePlus(options = {}) {
  const harnessRoot = resolveHarnessRoot({
    harnessRoot: options.harnessRoot,
    envRoot: options.envRoot,
    configFile: options.configFile,
    cwd: options.cwd,
    moduleDir: options.moduleDir,
  })
  const compatibility = inspectDshxCompatibility(harnessRoot)
  const sourceInfo = standardSourceAt(harnessRoot)
  const dshHome = resolve(options.dshHome || process.env.DSH_HOME || join(homedir(), '.dsh'))
  if (sourceInfo.kind === 'patch') {
    return installFromStandardPatch({
      sourcePath: sourceInfo.path,
      dshHome,
      compatibility,
      upgrade: options.upgrade,
      migrateLegacy: options.migrateLegacy,
    })
  }
  const source = sourceInfo.path
  const root = join(dshHome, '.agent-presets')
  const currentTarget = join(root, CURRENT_PRESET_ID)
  const legacyTarget = join(root, LEGACY_PRESET_ID)
  const currentExists = existsSync(currentTarget)
  const legacyExists = existsSync(legacyTarget)
  const result = (target, action) => ({
    target,
    action,
    dshxVersion: compatibility.dshxVersion,
    creatorBridgeVersion: compatibility.creatorBridgeVersion,
    dshxContract: compatibility.contractId,
  })

  if (currentExists && legacyExists) {
    throw new Error(`both ${currentTarget} and ${legacyTarget} exist; refusing to choose or overwrite either preset`)
  }
  mkdirSync(root, { recursive: true })

  if (currentExists) {
    if (!options.upgrade && !options.migrateLegacy) {
      throw new Error(`Creator Mode+ already exists at ${currentTarget}; pass --upgrade to refresh only managed assets`)
    }
    refreshManagedAssets(currentTarget, root, false)
    return result(currentTarget, 'updated')
  }

  if (legacyExists) {
    if (!options.migrateLegacy) {
      throw new Error(`legacy Creator Mode+ exists at ${legacyTarget}; pass --migrate-legacy after adding the standalone package`)
    }
    refreshManagedAssets(legacyTarget, root, true)
    return result(legacyTarget, 'migrated')
  }

  if (options.upgrade || options.migrateLegacy) {
    throw new Error('no existing Creator Mode+ preset found to update or migrate')
  }

  const temporaryRoot = mkdtempSync(join(root, '.dsh-creator-mode-plus-install-'))
  const staging = join(temporaryRoot, CURRENT_PRESET_ID)
  try {
    cpSync(source, staging, { recursive: true, errorOnExist: true })
    const compositionPath = join(staging, 'agent.cordis.yml')
    writeFileSync(compositionPath, creatorComposition(readFileSync(compositionPath, 'utf8')))
    cpSync(join(packageRoot, 'preset/preset.yml'), join(staging, 'preset.yml'), { force: true })
    cpSync(join(packageRoot, 'preset/skills'), join(staging, 'skills'), { recursive: true, force: true })
    tightenTree(staging)
    renameSync(staging, currentTarget)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
  return result(currentTarget, 'installed')
}

function parseArguments(argv) {
  const options = { upgrade: false, migrateLegacy: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--upgrade') options.upgrade = true
    else if (token === '--migrate-legacy') options.migrateLegacy = true
    else if (token === '--harness') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--') || options.harnessRoot) {
        throw new Error('--harness requires exactly one path')
      }
      options.harnessRoot = value
      index += 1
    } else if (token === '--help' || token === '-h') {
      options.help = true
    } else {
      throw new Error(`unknown option: ${token}`)
    }
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) {
      process.stdout.write('Usage: node scripts/install.mjs --harness <path> [--upgrade | --migrate-legacy]\n')
    } else {
      const result = installCreatorModePlus(options)
      process.stdout.write(
        `Creator Mode+ ${result.action} at ${result.target}\n`
        + `DSHX ${result.dshxVersion}; bridge v${result.creatorBridgeVersion}; contract ${result.dshxContract}\n`,
      )
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  }
}
