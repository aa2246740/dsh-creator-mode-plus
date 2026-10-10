/** Watched-profile lifecycle boundary. Activation, watched-patch mutation and
 * removal belong to the fixed DSHX tools (dshx_activate_new_client,
 * dshx_hot_reload, dshx_remove_plugin) — never to direct file or shell writes
 * from the model session. This is not the official-source boundary
 * (core-boundary.js): the profile is user configuration, and the risk here is
 * bypassing activation journaling, Guardian quarantine, same-PID checks and
 * the claim fence, not editing core. */
import { homedir } from 'node:os'
import { basename, isAbsolute, resolve, sep } from 'node:path'
import { canonicalTarget, readOnlyShellCommand, under } from './core-boundary.js'

export const CREATOR_LIFECYCLE_ONLY = 'CREATOR_LIFECYCLE_ONLY'
const ROUTE = 'route through the fixed tools: dshx_activation_plan, dshx_activate_new_client, dshx_hot_reload or dshx_remove_plugin — never a direct write. Manual profile edits bypass the ordered activation journal, Guardian quarantine, same-PID proof and the claim fence'
const deny = detail => `${CREATOR_LIFECYCLE_ONLY}: ${detail}; ${ROUTE}.`

/** Watched configuration names anywhere under the DSH home root. */
const WATCHED_BASENAMES = /^(?:cordis\.patch\.yml$|agent\.cordis\.yml$|\.agent-presets(?:\.|$))/

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
  // Keep the lexical location too: replacing a profile symlink is a lifecycle
  // mutation even when its current referent lives outside the Home.
  const targets = [resolve(cwd, target), canonicalTarget(target, cwd)]
  for (const dshHome of roots) {
    const profiles = `${dshHome}${sep}profiles`
    for (const resolved of targets) {
      if (under(profiles, resolved) || under(canonicalTarget(profiles), resolved)) {
        return deny(`watched profile surface ${resolved}`)
      }
      if (under(dshHome, resolved) && WATCHED_BASENAMES.test(basename(resolved))) {
        return deny(`watched profile file ${resolved}`)
      }
    }
  }
  return undefined
}

const FILE_TOOLS = ['write', 'edit', 'write_file', 'edit_file', 'delete_file', 'move_file', 'copy_file']
const SHELL_TOOLS = ['bash', 'terminal_open', 'terminal_send']

/**
 * Deny file-tool mutations and shell mutation targets in watched paths.
 * This is not an interpreter sandbox: computed paths, hard links and races
 * require filesystem confinement; token inspection cannot prove isolation.
 * Read-only shell commands stay available (status verification is normal
 * work), and ordinary writes outside the profile surface are untouched —
 * plugin source editing keeps working.
 */
export function creatorProfileMutationReason(exec, roots, cwd, env = process.env) {
  const args = exec?.arguments ?? {}
  const base = typeof cwd === 'string' ? cwd : exec?.agent?.session?.header?.cwd ?? process.cwd()
  if (FILE_TOOLS.includes(exec?.name)) {
    for (const key of ['file_path', 'path', 'destination', ...(exec.name === 'copy_file' ? [] : ['source']), 'target']) {
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
  if (!command) return undefined
  const workdir = args.workdir ?? args.cwd ?? base
  const expand = token => token.replace(/\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g,
    (match, braced, bare) => env[braced ?? bare] ?? match)
    .replace(/^~(?=\/)/, env.HOME ?? homedir())
  const directory = canonicalTarget(expand(workdir), base)
  // Only classify simple shell syntax. Substitutions, heredocs and interpreters
  // retain conservative inspection of their embedded script text.
  const words = shellWords(command, true)
  let segment = []
  const segments = []
  for (const word of words) {
    if (['|', '||', '&', '&&', ';', '\n'].includes(word)) {
      segments.push(segment)
      segment = []
    } else segment.push(word)
  }
  segments.push(segment)
  for (const part of segments) {
    if (!part.length) continue
    const simple = !words.ambiguous && !words.includes('<<')
    const targets = []
    const argv = []
    for (let i = 0; i < part.length; i++) {
      if (/^(?:>|>>|<)$/.test(part[i])) {
        if (part[i] !== '<') targets.push(part[i + 1] ?? '$unknown')
        i++
      } else argv.push(part[i])
    }
    const name = argv[0] ?? ''
    const readOnly = (/^(?:cat|head|tail|ls|pwd|stat|realpath|readlink|rg|jq)$/.test(name)
      && !argv.some(word => /^--pre(?:=|$)/.test(word)))
      || (name === 'git' && readOnlyShellCommand(argv.join(' ')))
    let classified = simple && readOnly
    if (simple && name === 'cp') {
      const operands = []
      let targetDirectory, options = true
      classified = true
      for (let i = 1; i < argv.length; i++) {
        const word = argv[i]
        if (options && word === '--') { options = false; continue }
        if (options && (word === '-t' || word === '--target-directory')) {
          targetDirectory = argv[++i] ?? '$unknown'
        } else if (options && word.startsWith('--target-directory=')) {
          targetDirectory = word.slice('--target-directory='.length)
        } else if (options && word.startsWith('-t') && !word.startsWith('--')) {
          targetDirectory = word.slice(2)
        } else if (options && word.startsWith('-')) {
          // Unknown option arity makes the destination ambiguous.
          if (!/^(?:-[abdfHilLnprRsTuvx]+|--(?:archive|force|interactive|no-clobber|recursive|no-target-directory|verbose|preserve(?:=.*)?|reflink(?:=.*)?))$/.test(word)) classified = false
        } else operands.push(word)
      }
      targets.push(targetDirectory ?? operands.at(-1) ?? '$unknown')
    }
    const mutationTargets = targets.length
    if (!classified) {
      const atProfile = profileWriteReason(directory, roots, base)
      if (atProfile) return atProfile
      targets.push(...part)
    }
    for (const [index, token] of targets.entries()) {
      const expanded = expand(token)
      if ((classified || index < mutationTargets) && /[*?{}]/.test(expanded)) return deny('cannot resolve an expanded mutation target')
      if (/\$|`/.test(expanded)) return deny('cannot resolve a dynamic mutation target')
      const candidates = [expanded.replace(/^[\w$]+=/, '')]
      for (const match of expanded.matchAll(/"([^"\n]+)"|'([^'\n]+)'/g)) candidates.push(match[1] ?? match[2])
      for (const match of expanded.matchAll(/(?:^|[\s'"(=,])((?:\/|\.\.?\/)[^\s'"()<>;,]+)/g)) candidates.push(match[1])
      for (const candidate of candidates) {
        if (!candidate || candidate === '-' || candidate.includes('://')) continue
        const reason = profileWriteReason(candidate, roots, directory)
        if (reason) return reason
      }
    }
  }
  return undefined
}

function shellWords(command, operators = false) {
  const words = []
  let word = '', quote
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (char === "\\" && quote !== "'") {
      const next = command[i + 1]
      if (next !== undefined && (!quote || /["\\$`\n]/.test(next))) {
        if (next !== '\n') word += next
        i++
        continue
      }
    }
    if ((quote !== "'" && (char === '`' || (char === '$' && command[i + 1] === '(')))
      || (!quote && /[()]/.test(char))) words.ambiguous = true
    if (quote) {
      if (char === quote) quote = undefined
      else word += char
    } else if (char === '"' || char === "'") quote = char
    else if (/[\s;|&()<>`]/.test(char)) {
      if (word) words.push(word)
      word = ''
      if (operators && /[;|&<>\n]/.test(char)) {
        if (command[i + 1] === char && /[|&<>]/.test(char)) { words.push(char + char); i++ }
        else words.push(char)
      }
    } else word += char
  }
  if (word) words.push(word)
  if (quote) words.ambiguous = true
  return words
}
