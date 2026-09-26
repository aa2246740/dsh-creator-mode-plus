/** Deterministic local source locators for native-Core tests; never skip/fall back to installed API copies. */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CORE_SOURCE_FILES = Object.freeze([
  'package.json', 'tsconfig.json', 'tsconfig.base.json', 'pnpm-workspace.yaml',
  'vendor/cordis/src/index.ts', 'packages/core/session/src/index.ts',
  'packages/core/agent/src/index.ts', 'packages/core/agent-loop/src/index.ts',
  'packages/core/tools/src/index.ts', 'packages/interaction/user-approval/src/index.ts',
  'packages/interaction/permission-presets/src/index.ts',
  'packages/sandbox/sandbox-policy/src/index.ts',
  'node_modules/tsx/dist/esm/api/index.mjs',
])
const APPROVER_FILES = ['package.json', 'src/coordinator.ts', 'src/dsh-approve-for-me.ts', 'src/approval-context.ts']

function validate(path, name, files) {
  const root = realpathSync(path)
  if (!statSync(root).isDirectory()) throw new Error('not a directory')
  for (const file of files) {
    if (!statSync(resolve(root, file)).isFile()) throw new Error(`not a file: ${file}`)
  }
  if (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).name !== name) {
    throw new Error(`package name must be ${name}`)
  }
  return root
}
function locate(variable, env, candidates, name, files) {
  if (Object.hasOwn(env, variable)) {
    const path = env[variable]
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`${variable} must be an absolute source directory (empty values are invalid)`)
    try { return validate(path, name, files) }
    catch (error) { throw new Error(`${variable} is not a usable source checkout: ${error.message}`, { cause: error }) }
  }
  const valid = new Set(), errors = []
  for (const path of new Set(candidates)) {
    try { valid.add(validate(path, name, files)) }
    catch (error) { errors.push(`${path}: ${error.message}`) }
  }
  if (valid.size === 1) return [...valid][0]
  if (valid.size > 1) throw new Error(`Ambiguous local source checkouts; set ${variable} explicitly: ${[...valid].join(', ')}`)
  throw new Error(`No usable local source checkout; set ${variable}. No installed-module fallback or skip.\n${errors.join('\n')}`)
}

/** Explicit DSHX_HARNESS wins (and fails hard when invalid); otherwise inspect only named local layouts and cwd. */
export function resolveSourceCheckout({ env = process.env, packageRoot = PACKAGE, cwd = process.cwd() } = {}) {
  return locate('DSHX_HARNESS', env, [
    cwd,
    resolve(packageRoot, '../..'), // <checkout>/my-plugins/<C>
    resolve(packageRoot, '../../runtime'), // <project>/plugins/<C>, sibling <project>/runtime
  ], '@deepseek-ai/dsh-root', CORE_SOURCE_FILES)
}

/** Resolve A read-only through the selected checkout's link or C's sibling; reject ambiguous different sources. */
export function resolveApproverSource(checkout, { env = process.env, packageRoot = PACKAGE } = {}) {
  return locate('DSHX_APPROVER_SOURCE', env, [
    resolve(checkout, 'my-plugins/dsh-approve-for-me'),
    resolve(packageRoot, '../dsh-approve-for-me'),
  ], 'dsh-approve-for-me', APPROVER_FILES)
}
