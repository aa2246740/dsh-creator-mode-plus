import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const CREATOR_BRIDGE_VERSION = 2

export const DSHX_CONTRACT = Object.freeze({
  id: 'dshx-v0.7/creator-bridge-v2',
  release: 'v0.7.1',
  minimum: '0.7.1',
  maximumExclusive: '0.8.0',
  capabilities: Object.freeze([
    'creator-session-claims',
    'workspace-scaffold',
    'bounded-new-client-activation',
    'external-guardian-recovery',
    'same-pid-activation-matrix',
    'transactional-harness-update-assistant',
  ]),
})

export const SUPPORTED_DSHX = Object.freeze({
  minimum: DSHX_CONTRACT.minimum,
  maximumExclusive: DSHX_CONTRACT.maximumExclusive,
})

export const CREATOR_MODEL_TOOLS = Object.freeze([
  'dshx_claim_plugin',
  'dshx_scaffold',
  'dshx_check',
  'dshx_activation_plan',
  'dshx_activate_new_client',
  'dshx_status',
])

export const DSHX_SURFACE_MARKERS = Object.freeze({
  'src/cli.ts': Object.freeze([
    "case 'check'",
    "case 'status'",
    "case 'activation-plan'",
    "case 'activate-new-client'",
    "case 'creator'",
    "case 'update'",
  ]),
  'src/commands/activation.ts': Object.freeze([
    '--change patch|manifest|preset|client|new-client|server|artifact',
    'activationDecision(options.change, facts)',
  ]),
  'src/commands/check.ts': Object.freeze(['checkPlugin(loadPlugin(root, name), root)']),
  'src/commands/creator.ts': Object.freeze([
    "action === 'claim'",
    "action === 'scaffold'",
    "action === 'client-failure'",
    'recoverCreatorClientFailure(root, failure)',
  ]),
  'src/commands/new-client.ts': Object.freeze(['SOURCE_BUILT', 'CLIENT_MANIFEST_PRESENT']),
  'src/commands/update.ts': Object.freeze([
    'dshx update plan|prepare|verify|apply|rollback',
    "action === 'apply' || action === 'rollback'",
  ]),
  'src/internal/creator.ts': Object.freeze(['bridgeVersion !== 2', 'workspaceRoot']),
  'src/internal/guardian.ts': Object.freeze([
    'export function armGuardian',
    'export async function recoverCreatorClientFailure',
    'export async function runGuardianCycle',
    "reason: 'crash-loop'",
  ]),
  'src/internal/io.ts': Object.freeze(["command === 'update'", "args[0] ?? 'plan'"]),
  'src/internal/new-client.ts': Object.freeze([
    'BOOT_MANIFEST_ASSIGNMENT',
    'window.__DSH_BOOT__',
    'globalThis["__DSH_BOOT__"]',
    'no supported __DSH_BOOT__ manifest assignment',
  ]),
  'knowledge/contracts/creator-mode-plus.md': Object.freeze([
    'creator claim',
    'creator scaffold',
    'activate-new-client',
  ]),
  'knowledge/contracts/creator-guardian.md': Object.freeze(['Creator+', 'crash-loop fuse', 'quarantine']),
  'knowledge/contracts/harness-update.md': Object.freeze(['plan → prepare → verify → apply', 'rollback']),
  'knowledge/contracts/live-activation.md': Object.freeze(['SOURCE_BUILT', 'CLIENT_MANIFEST_PRESENT']),
})

export const REQUIRED_DSHX_PATHS = Object.freeze(Object.keys(DSHX_SURFACE_MARKERS))

function parseVersion(value) {
  if (typeof value !== 'string') return undefined
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
  if (!match) return undefined
  return {
    parts: match.slice(1, 4).map(Number),
    prerelease: match[4] !== undefined,
  }
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

/** Return whether a stable DSHX release implements the complete v0.7 contract. */
export function supportsDshxVersion(version) {
  const parsed = parseVersion(version)
  const minimum = parseVersion(DSHX_CONTRACT.minimum)
  const maximum = parseVersion(DSHX_CONTRACT.maximumExclusive)
  return Boolean(parsed)
    && parsed.prerelease === false
    && compareVersions(parsed.parts, minimum.parts) >= 0
    && compareVersions(parsed.parts, maximum.parts) < 0
}

/** Fail closed unless one Harness checkout carries the full DSHX v0.7 contract. */
export function inspectDshxCompatibility(harnessRoot) {
  const root = resolve(harnessRoot)
  const dshxRoot = join(root, 'tools/dshx')
  const packagePath = join(dshxRoot, 'package.json')
  let metadata
  try {
    metadata = JSON.parse(readFileSync(packagePath, 'utf8'))
  } catch (error) {
    throw new Error(`dsh-creator-mode-plus: cannot read DSHX package metadata at ${packagePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (metadata.name !== 'dsh-external-plugin-devkit') {
    throw new Error(`dsh-creator-mode-plus: unexpected package at ${packagePath}`)
  }
  if (!supportsDshxVersion(metadata.version)) {
    throw new Error(
      `dsh-creator-mode-plus: dshx ${metadata.version ?? 'unknown'} is incompatible; `
      + `contract ${DSHX_CONTRACT.id} requires >=${DSHX_CONTRACT.minimum} <${DSHX_CONTRACT.maximumExclusive}`,
    )
  }
  const missingPaths = REQUIRED_DSHX_PATHS.filter(path => !existsSync(join(dshxRoot, path)))
  if (missingPaths.length > 0) {
    throw new Error(
      `dsh-creator-mode-plus: dshx ${metadata.version} is missing required ${DSHX_CONTRACT.id} surfaces: ${missingPaths.join(', ')}`,
    )
  }
  const driftedSurfaces = []
  for (const [path, markers] of Object.entries(DSHX_SURFACE_MARKERS)) {
    const source = readFileSync(join(dshxRoot, path), 'utf8')
    const missingMarkers = markers.filter(marker => !source.includes(marker))
    if (missingMarkers.length > 0) driftedSurfaces.push(`${path} [${missingMarkers.join(', ')}]`)
  }
  if (driftedSurfaces.length > 0) {
    throw new Error(
      `dsh-creator-mode-plus: dshx ${metadata.version} contract drift for ${DSHX_CONTRACT.id}: ${driftedSurfaces.join('; ')}`,
    )
  }
  return Object.freeze({
    root,
    dshxRoot,
    packagePath,
    dshxVersion: metadata.version,
    creatorBridgeVersion: CREATOR_BRIDGE_VERSION,
    contractId: DSHX_CONTRACT.id,
    capabilities: DSHX_CONTRACT.capabilities,
  })
}
