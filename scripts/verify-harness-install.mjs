import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installCreatorModePlus } from './install.mjs'

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function parseArguments(argv) {
  let harnessRoot
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--harness') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--') || harnessRoot) throw new Error('--harness requires exactly one path')
      harnessRoot = resolve(value)
      index += 1
    } else if (token === '--help' || token === '-h') {
      return { help: true }
    } else {
      throw new Error(`unknown option: ${token}`)
    }
  }
  if (!harnessRoot) throw new Error('--harness is required for RC2 install verification')
  return { harnessRoot }
}

/** Exercise the real shipped Standard preset in an isolated disposable DSH_HOME. */
export function verifyHarnessInstall(harnessRoot) {
  const sourceComposition = join(harnessRoot, 'apps/cli/config/agent-presets/standard/agent.cordis.yml')
  const sourcePreset = join(harnessRoot, 'apps/cli/config/agent-presets/standard/preset.yml')
  const before = {
    composition: digest(sourceComposition),
    preset: digest(sourcePreset),
  }
  const dshHome = mkdtempSync(join(tmpdir(), 'creator-mode-plus-rc2-install-'))
  try {
    const installed = installCreatorModePlus({ harnessRoot, dshHome })
    const compositionPath = join(installed.target, 'agent.cordis.yml')
    const skillPath = join(installed.target, 'skills/creator-mode-plus/SKILL.md')
    const composition = readFileSync(compositionPath, 'utf8')
    const skill = readFileSync(skillPath, 'utf8')
    if (!composition.includes('You are Creator Mode+')) throw new Error('isolated preset is missing the Creator Mode+ persona')
    if (!composition.includes('name: dsh-creator-mode-plus')) throw new Error('isolated preset is missing the standalone bridge row')
    if (!skill.includes('dshx-v0.7/creator-bridge-v2')) throw new Error('isolated preset is missing the DSHX v0.7 skill')
    if (!skill.includes('update plan → prepare → verify → apply')) throw new Error('isolated preset is missing the Harness Update Assistant boundary')

    const firstStamp = statSync(compositionPath)
    const updated = installCreatorModePlus({ harnessRoot, dshHome, upgrade: true })
    const secondStamp = statSync(compositionPath)
    if (firstStamp.size !== secondStamp.size || firstStamp.mtimeMs !== secondStamp.mtimeMs) {
      throw new Error('managed asset refresh changed the unchanged agent.cordis.yml stamp')
    }
    if (!existsSync(skillPath)) throw new Error('managed upgrade removed the Creator Mode+ skill')
    if (digest(sourceComposition) !== before.composition || digest(sourcePreset) !== before.preset) {
      throw new Error('isolated install changed a shipped Harness preset')
    }

    return Object.freeze({
      ok: true,
      harnessRoot,
      dshxVersion: updated.dshxVersion,
      creatorBridgeVersion: updated.creatorBridgeVersion,
      dshxContract: updated.dshxContract,
      freshInstall: installed.action,
      managedUpgrade: updated.action,
      shippedPresetUnchanged: true,
      compositionStampStable: true,
    })
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) {
      process.stdout.write('Usage: node scripts/verify-harness-install.mjs --harness /absolute/path/to/deepseek-harness\n')
    } else {
      const result = verifyHarnessInstall(options.harnessRoot)
      process.stdout.write('CREATOR_MODE_PLUS_HARNESS_INSTALL_COMPATIBILITY_PASS\n')
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
