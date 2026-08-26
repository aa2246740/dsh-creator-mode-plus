import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveDshxRuntime } from '../src/runner.js'
import { DSHX_SURFACE_MARKERS } from '../src/compatibility.js'

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
  return { harnessRoot }
}

/** Verify the actual checkout, not only a fabricated version string. */
export function verifyDshxAlignment(options = {}) {
  const runtime = resolveDshxRuntime({
    harnessRoot: options.harnessRoot,
    envRoot: options.envRoot,
    configFile: options.configFile,
    cwd: options.cwd,
    moduleDir: options.moduleDir,
    loaderPath: options.loaderPath,
  })

  const version = spawnSync(process.execPath, ['--import', runtime.loader, runtime.cli, 'version'], {
    cwd: runtime.root,
    env: { ...process.env, DSHX_HARNESS: runtime.root },
    encoding: 'utf8',
    timeout: 15_000,
  })
  if (version.error) throw version.error
  if (version.status !== 0) {
    throw new Error(`DSHX version probe failed (${version.status}): ${(version.stderr || version.stdout).trim()}`)
  }
  const expected = `dshx ${runtime.dshxVersion}`
  if (version.stdout.trim() !== expected) {
    throw new Error(`DSHX version probe mismatch: expected ${expected}, got ${version.stdout.trim() || '<empty>'}`)
  }

  return Object.freeze({
    ok: true,
    dshxVersion: runtime.dshxVersion,
    creatorBridgeVersion: runtime.bridgeVersion,
    dshxContract: runtime.contractId,
    capabilities: runtime.capabilities,
    harnessRoot: runtime.root,
    cliVersionProbe: expected,
    contractMarkers: Object.keys(DSHX_SURFACE_MARKERS),
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) {
      process.stdout.write('Usage: node scripts/verify-dshx.mjs [--harness /absolute/path/to/deepseek-harness]\n')
    } else {
      const result = verifyDshxAlignment(options)
      process.stdout.write('CREATOR_MODE_PLUS_DSHX_V070_COMPATIBILITY_PASS\n')
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
