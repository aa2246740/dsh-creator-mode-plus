import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const harness = new Set([
  'authorization-feasibility', 'default-delivery', 'development-execution',
  'development-invocation', 'development-policy', 'development-revoke',
  'development-tasks', 'takeover',
].map(name => `${name}.spec.mjs`))
const mode = process.argv[2]
if (!['ci', 'harness'].includes(mode)) throw new Error('Expected ci or harness test subset')
const specs = readdirSync('tests').filter(name => name.endsWith('.spec.mjs')
  && harness.has(name) === (mode === 'harness')).sort()
const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--test',
  ...specs.map(name => `tests/${name}`)], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
