/** Watched-profile lifecycle boundary. Activation, watched-patch mutation and
 * removal belong to the fixed DSHX tools (dshx_activate_new_client,
 * dshx_hot_reload, dshx_remove_plugin) — never to direct file or shell writes
 * from the model session. This is not the official-source boundary
 * (core-boundary.js): the profile is user configuration, and the risk here is
 * bypassing activation journaling, Guardian quarantine, same-PID checks and
 * the claim fence, not editing core. */
import { homedir } from 'node:os'
import { basename, isAbsolute, sep } from 'node:path'
import { canonicalTarget, readOnlyShellCommand, under } from './core-boundary.js'

export const CREATOR_LIFECYCLE_ONLY = 'CREATOR_LIFECYCLE_ONLY'
const ROUTE = 'route through the fixed tools: dshx_activation_plan, dshx_activate_new_client, dshx_hot_reload or dshx_remove_plugin — never a direct write. Manual profile edits bypass the ordered activation journal, Guardian quarantine, same-PID proof and the claim fence'
const deny = detail => `${CREATOR_LIFECYCLE_ONLY}: ${detail}; ${ROUTE}.`

/** Watched configuration names anywhere under the DSH home root. */
const WATCHED_BASENAMES = /^(?:cordis\.patch\.yml|agent\.cordis\.yml|\.agent-presets(?:\.|$))/

/** DSH home roots whose `profiles/` trees and watched files are protected.
 * Both the effective `DSH_HOME` and the default `~/.dsh` are covered: either
 * can carry a live watched profile on this machine. */
export function profileHomeRoots(env = process.env, home = homedir()) {
  const roots = []
  for (const candidate of [env.DSH_HOME, `${home}${sep}.dsh`]) {
    if (typeof candidate !== 'string' || !isAbsolute(candidate)) continue
    const resolved = canonicalTarget(candidate)
    if (!roots.includes(resolved)) roots.push(resolved)
  }
  return roots
}

/** Reason when `target` lands inside a protected profile surface; else undefined. */
export function profileWriteReason(target, roots, cwd = process.cwd()) {
  const resolved = canonicalTarget(target, cwd)
  for (const dshHome of roots) {
    if (under(`${dshHome}${sep}profiles`, resolved)) {
      return deny(`watched profile surface ${resolved}`)
    }
    if (under(dshHome, resolved) && WATCHED_BASENAMES.test(basename(resolved))) {
      return deny(`watched profile file ${resolved}`)
    }
  }
  return undefined
}

const FILE_TOOLS = ['write', 'edit', 'write_file', 'edit_file', 'delete_file', 'move_file', 'copy_file']
const SHELL_TOOLS = ['bash', 'terminal_open', 'terminal_send']

/**
 * Deny model-initiated writes to the watched profile surface across every
 * supported mutation route: file tools, apply_patch and shell/script paths.
 * Read-only shell commands stay available (status verification is normal
 * work), and ordinary writes outside the profile surface are untouched —
 * plugin source editing keeps working.
 */
export function creatorProfileMutationReason(exec, roots, cwd) {
  const args = exec?.arguments ?? {}
  const base = typeof cwd === 'string' ? cwd : exec?.agent?.session?.header?.cwd ?? process.cwd()
  if (FILE_TOOLS.includes(exec?.name)) {
    for (const key of ['file_path', 'path', 'destination', 'source', 'target']) {
      if (typeof args[key] === 'string') {
        const reason = profileWriteReason(args[key], roots, base)
        if (reason) return reason
      }
    }
    return undefined
  }
  if (exec?.name === 'apply_patch') {
    const patch = args.patch ?? args.input ?? ''
    for (const match of patch.matchAll(/^\*\*\* (?:(?:Update|Add|Delete) File|Move to):\s*(.+)$/gm)) {
      const reason = profileWriteReason(match[1], roots, base)
      if (reason) return reason
    }
    return undefined
  }
  if (!SHELL_TOOLS.includes(exec?.name)) return undefined
  const command = args.command ?? args.text ?? ''
  if (!command || readOnlyShellCommand(command)) return undefined
  // A mutating command that even references a protected path fails closed:
  // redirection targets, copies into the profile tree, in-place editors and
  // script-borne writes all travel through the same token surface. Commands
  // assembled to hide the path dynamically remain the Host sandbox's job.
  for (const match of command.matchAll(/"([^"\n]+)"|'([^'\n]+)'|([^\s;|&()<>`]+)/g)) {
    const token = match[1] ?? match[2] ?? match[3]
    const candidate = token.replace(/^[\w$]+=/, '').replace(/^[>|]+/, '')
    if (!candidate || candidate === '-') continue
    const looksPath = candidate.includes('/') || WATCHED_BASENAMES.test(basename(candidate))
    if (!looksPath || candidate.includes('://')) continue
    const reason = profileWriteReason(candidate, roots, base)
    if (reason) return reason
  }
  return undefined
}
