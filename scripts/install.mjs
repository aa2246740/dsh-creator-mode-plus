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
import { resolveHarnessRoot } from '../src/runner.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CURRENT_PRESET_ID = 'creator-mode-plus'
const LEGACY_PRESET_ID = 'creator-plus'
const CURRENT_ROW = `- id: dsh-creator-mode-plus\n  name: dsh-creator-mode-plus`
const LEGACY_ROW = `- id: dshx-creator-plus\n  name: dsh-external-plugin-devkit/creator-plus`

function standardPresetAt(root) {
  const path = join(root, 'apps/cli/config/agent-presets/standard')
  if (!existsSync(join(path, 'agent.cordis.yml'))) {
    throw new Error(`Creator Mode+ installer cannot find the shipped Standard preset at ${path}`)
  }
  return path
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

function creatorComposition(standard) {
  let text = replaceOnce(
    standard,
    '# The `standard` agent preset: the full coding agent, mounted once per process.',
    '# Creator Mode+ starts from the shipped Standard preset and adds the fixed dshx bridge.',
    'preset heading',
  )
  text = replaceOnce(
    text,
    `    text: >-\n      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.`,
    `    text: |-\n      You are Creator Mode+, a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.\n\n      Create file-backed DeepSeek Harness plugins through the fixed dshx bridge. Treat the official browser WebUI and public Cordis/client extension points as the compatibility target. App-shell APIs and wrapper-specific behavior are outside the supported surface.\n\n      Load the \`creator-mode-plus\` skill before creating, activating, hot-reloading, or validating a DSH plugin. Keep Harness core and shipped presets unchanged.`,
    'persona',
  )
  text = replaceOnce(
    text,
    `- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'`,
    `- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n  config:\n    customSkillDirs:\n      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"`,
    'skill filesystem',
  )
  return replaceOnce(
    text,
    `- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'`,
    `- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n\n# Bridge v1: fixed dshx operations only; no shell, arbitrary argv, or process control.\n${CURRENT_ROW}`,
    'tool skill',
  )
}

function refreshManagedAssets(target, root, migrateLegacy) {
  const compositionPath = join(target, 'agent.cordis.yml')
  let composition = existsSync(compositionPath) ? readFileSync(compositionPath, 'utf8') : ''
  const currentCount = composition.split(CURRENT_ROW).length - 1
  const legacyCount = composition.split(LEGACY_ROW).length - 1

  if (currentCount === 1 && legacyCount === 0) {
    // Current composition remains user-owned; only managed assets are refreshed.
  } else if (currentCount === 0 && legacyCount === 1 && migrateLegacy) {
    composition = composition.replace(LEGACY_ROW, CURRENT_ROW)
  } else if (legacyCount === 1 && !migrateLegacy) {
    throw new Error('legacy bundled Creator Mode+ found; rerun with --migrate-legacy after adding dsh-creator-mode-plus to the Web profile')
  } else {
    throw new Error('Creator Mode+ preset does not contain exactly one recognized managed plugin row; refusing an unsafe update')
  }

  const temporaryRoot = mkdtempSync(join(root, '.dsh-creator-mode-plus-upgrade-'))
  const staging = join(temporaryRoot, 'next')
  const backup = join(temporaryRoot, 'previous')
  let movedOriginal = false
  try {
    cpSync(target, staging, { recursive: true, errorOnExist: true })
    writeFileSync(join(staging, 'agent.cordis.yml'), composition)
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
  } catch (error) {
    if (movedOriginal && !existsSync(target) && existsSync(backup)) renameSync(backup, target)
    throw error
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
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
  const source = standardPresetAt(harnessRoot)
  const dshHome = resolve(options.dshHome || process.env.DSH_HOME || join(homedir(), '.dsh'))
  const root = join(dshHome, '.agent-presets')
  const currentTarget = join(root, CURRENT_PRESET_ID)
  const legacyTarget = join(root, LEGACY_PRESET_ID)
  const currentExists = existsSync(currentTarget)
  const legacyExists = existsSync(legacyTarget)

  if (currentExists && legacyExists) {
    throw new Error(`both ${currentTarget} and ${legacyTarget} exist; refusing to choose or overwrite either preset`)
  }
  mkdirSync(root, { recursive: true })

  if (currentExists) {
    if (!options.upgrade && !options.migrateLegacy) {
      throw new Error(`Creator Mode+ already exists at ${currentTarget}; pass --upgrade to refresh only managed assets`)
    }
    refreshManagedAssets(currentTarget, root, false)
    return { target: currentTarget, action: 'updated' }
  }

  if (legacyExists) {
    if (!options.migrateLegacy) {
      throw new Error(`legacy Creator Mode+ exists at ${legacyTarget}; pass --migrate-legacy after adding the standalone package`)
    }
    refreshManagedAssets(legacyTarget, root, true)
    return { target: legacyTarget, action: 'migrated' }
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
  return { target: currentTarget, action: 'installed' }
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
      process.stdout.write(`Creator Mode+ ${result.action} at ${result.target}\n`)
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  }
}
