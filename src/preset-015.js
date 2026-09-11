import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PRESET_IDS = ['creator-plus', 'creator-mode-plus']

/** Rewrite a leftover 0.1.2 `text` persona field to the 0.1.5 `prefix` field. */
export function migratePersona015(text) {
  return text.replace(/(^|\n)(    )text: ([|>]-?)/g, '$1$2prefix: $3')
}

/**
 * Heal already-installed Creator+ compositions in DSH_HOME.
 * The Host plugin can run this even when a stale preset fails to mount.
 */
export function healCreatorPlusPresets(home = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  const healed = []
  for (const id of PRESET_IDS) {
    const path = join(home, '.agent-presets', id, 'agent.cordis.yml')
    if (!existsSync(path)) continue
    const before = readFileSync(path, 'utf8')
    const after = migratePersona015(before)
    if (after === before) continue
    writeFileSync(path, after)
    healed.push(path)
  }
  return healed
}
