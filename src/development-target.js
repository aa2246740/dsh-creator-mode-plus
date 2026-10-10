/**
 * Bounded, read-only development-target observations for Creator task binding.
 *
 * Host code supplies getHarnessRoot; model/tool arguments MUST NOT supply it.
 * This module does not grant permission, resolve live Loader rows, lock source
 * trees, or authenticate arbitrary same-process callers. A successful revalidate
 * is only a parent-side observation. The fixed DSHX child contract accepts no
 * expected digest/source inode: bytes may still change before the child reads or
 * executes them. Post-execution receipts cannot turn that window into prevention.
 */
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readlinkSync, readSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, parse as parsePath, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { types as utilTypes } from 'node:util'
import { isAlias, isMap, isSeq, parseDocument } from 'yaml'

export const DEVELOPMENT_TARGET_ENGINE = 'creator-plus-v1'
export const DEVELOPMENT_TARGET_LIMITS = Object.freeze({
  pathBytes: 4096,
  relativePathBytes: 1024,
  pathComponents: 64,
  componentVisits: 512,
  symlinks: 16,
  artifacts: 32,
  metadataBytes: 256 * 1024,
  artifactBytes: 4 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
  yamlNodes: 8192,
  yamlDepth: 32,
})

// Per resolver/producer: bounded live inputs, a hard real timer, and a conservative
// aggregate retained-code budget in addition to each existing 16 MiB/32-file read.
export const DEVELOPMENT_COMPILATION_LIMITS = Object.freeze({ pending: 64, ttlMs: 5 * 60_000, retainedBytes: 16 * 1024 * 1024 })
const signal = value => value instanceof AbortSignal
const synchronous = (value, code) => {
  if (utilTypes.isPromise(value)) { void Promise.prototype.then.call(value, undefined, () => {}); fail(code, 'A synchronous private reader is required') }
  if (typeof value?.then === 'function') fail(code, 'A synchronous private reader is required')
  return value
}

const CONTROL_IDS = Object.freeze([
  'dsh-creator-mode-plus', 'dsh-creator-mode', 'creator-mode-plus',
  'dsh-approve-for-me', 'dsh-auto-review', 'dsh-external-plugin-devkit',
  'dsh-creator-bridge', 'dsh-guardian', 'dsh-user-approval', 'dshx',
])
const CORE_DIRECTORIES = ['apps', 'packages', 'vendor', 'tools', 'native', 'scripts', 'website', 'node_modules', '.git']
const OWN_PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const RUNTIME_FILE = /\.(?:[cm]?[jt]sx?)$/
const DECLARATION_FILE = /\.d\.(?:[cm]?ts)$/

export class DevelopmentTargetError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'DevelopmentTargetError'
    this.code = code
    this.eligible = false
  }
}

function fail(code, message) { throw new DevelopmentTargetError(code, message) }
function within(path, root) {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}
function overlaps(a, b) { return within(a, b) || within(b, a) }
function protectedId(id) { return CONTROL_IDS.some(control => id === control || id.startsWith(`${control}-`)) }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
function signature(value) { return JSON.stringify(value) }
function identity(stat) {
  if (stat.dev < 0n || stat.ino <= 0n) fail('UNSUPPORTED_IDENTITY', 'Source directory identity must have nonnegative dev and positive ino')
  return { dev: stat.dev.toString(10), ino: stat.ino.toString(10) }
}
function fileIdentity(stat) {
  return { ...identity(stat), size: stat.size.toString(10), mtimeNs: stat.mtimeNs.toString(10), ctimeNs: stat.ctimeNs.toString(10) }
}
function absolutePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || !isAbsolute(value)
    || CONTROL_CHARACTERS.test(value) || Buffer.byteLength(value) > DEVELOPMENT_TARGET_LIMITS.pathBytes) {
    fail('INVALID_PATH', `${label} must be a bounded absolute filesystem path`)
  }
  // Preserve dot components until the filesystem walk: lexical normalization
  // before resolving a symlink would give the wrong meaning to link/../target.
  if (value.split(sep).filter(Boolean).length > DEVELOPMENT_TARGET_LIMITS.pathComponents) fail('PATH_LIMIT', `${label} has too many components`)
  return value
}

/** Resolve normalized outer links with explicit link/visit limits and an identity trail. */
function directoryPath(value, label) {
  let target = absolutePath(value, label)
  if (target.split(sep).some(part => part === '.' || part === '..')) fail('AMBIGUOUS_LINK_PATH', `${label} must not contain dot traversal`)
  let cursor = parsePath(target).root
  let parts = target.slice(cursor.length).split(sep).filter(Boolean)
  let visits = 0
  let links = 0
  const trail = []
  let ancestors = []
  while (parts.length) {
    if (++visits > DEVELOPMENT_TARGET_LIMITS.componentVisits) fail('PATH_LIMIT', `${label} exceeded its component traversal budget`)
    const part = parts.shift()
    if (part === '.') continue
    if (part === '..') { cursor = dirname(cursor); ancestors.pop(); continue }
    const path = join(cursor, part)
    const stat = lstatSync(path, { bigint: true })
    if (stat.isSymbolicLink()) {
      if (++links > DEVELOPMENT_TARGET_LIMITS.symlinks) fail('LINK_LIMIT', `${label} exceeded its symlink budget`)
      const link = readlinkSync(path)
      if (CONTROL_CHARACTERS.test(link) || Buffer.byteLength(link) > DEVELOPMENT_TARGET_LIMITS.pathBytes) fail('INVALID_PATH', `${label} has an invalid symlink target`)
      // Node's JS realpathSync (used by DSHX) and kernel resolution can disagree
      // on named-link/../target. Accept leading relative ../ only; never approve
      // one interpretation while the child might select another interpretation.
      let namedComponent = isAbsolute(link)
      for (const component of link.split(sep).filter(Boolean)) {
        if (component === '.' || component === '..') {
          if (namedComponent) fail('AMBIGUOUS_LINK_PATH', `${label} has a non-normalized symlink target`)
        } else namedComponent = true
      }
      trail.push({ path, kind: 'link', ...identity(stat), target: link })
      const linked = isAbsolute(link) ? link : `${dirname(path)}${sep}${link}`
      target = absolutePath(`${linked}${parts.length ? `${sep}${parts.join(sep)}` : ''}`, label)
      cursor = parsePath(target).root
      parts = target.slice(cursor.length).split(sep).filter(Boolean)
      ancestors = []
    } else {
      if (!stat.isDirectory()) fail('NOT_DIRECTORY', `${label} traverses a non-directory`)
      trail.push({ path, kind: 'directory', ...identity(stat) })
      ancestors.push(identity(stat))
      cursor = path
    }
  }
  const stat = lstatSync(cursor, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('NOT_DIRECTORY', `${label} is not a canonical directory`)
  return { path: cursor, identity: identity(stat), trail, ancestors }
}

function exactRelative(value, runtime = true) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > DEVELOPMENT_TARGET_LIMITS.relativePathBytes
    || isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes('\\') || CONTROL_CHARACTERS.test(value)
    || /[*?{}[\]!()]/.test(value)) fail('INVALID_ARTIFACT_PATH', 'Entry/artifact must be an exact bounded package-relative path')
  const parts = value.split('/')
  if (parts.length > DEVELOPMENT_TARGET_LIMITS.pathComponents
    || parts.some(part => part === '' || part === '.' || part === '..' || part === 'node_modules' || part === '.git')) {
    fail('INVALID_ARTIFACT_PATH', 'Entry/artifact cannot traverse directories, dependencies, or VCS metadata')
  }
  if (runtime && (!RUNTIME_FILE.test(value) || DECLARATION_FILE.test(value))) fail('INVALID_ARTIFACT_PATH', 'Entry/artifact must be a runtime JavaScript or TypeScript file')
  return value
}

/** No symlink is accepted in ANY component below the canonical source root. */
function regularPath(root, relativePath) {
  exactRelative(relativePath, false)
  let cursor = root
  const parts = relativePath.split('/')
  const trail = []
  for (let index = 0; index < parts.length; index += 1) {
    cursor = join(cursor, parts[index])
    const stat = lstatSync(cursor, { bigint: true })
    if (stat.isSymbolicLink()) fail('SYMLINK_FORBIDDEN', `Metadata/artifact cannot traverse a symlink: ${relativePath}`)
    const final = index === parts.length - 1
    if (final ? !stat.isFile() : !stat.isDirectory()) fail('NOT_REGULAR_FILE', `Metadata/artifact is not a regular contained file: ${relativePath}`)
    trail.push({ path: cursor, kind: final ? 'file' : 'directory', ...(final ? fileIdentity(stat) : identity(stat)) })
  }
  return { path: cursor, trail }
}

function readBounded(root, path, role, budget, retainText = false) {
  if (typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_NONBLOCK !== 'number') fail('UNSUPPORTED_SAFE_READ', 'This platform lacks no-follow/nonblocking file opens')
  const beforePath = regularPath(root, path)
  const fd = openSync(beforePath.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = fstatSync(fd, { bigint: true })
    if (!before.isFile()) fail('NOT_REGULAR_FILE', `Not a regular opened file: ${path}`)
    const opened = fileIdentity(before)
    const expected = beforePath.trail.at(-1)
    if (Object.keys(opened).some(key => opened[key] !== expected[key])) fail('TARGET_CHANGED', `File changed before opening: ${path}`)
    const limit = Math.min(role === 'metadata' ? DEVELOPMENT_TARGET_LIMITS.metadataBytes : DEVELOPMENT_TARGET_LIMITS.artifactBytes, budget.remaining)
    if (before.size > BigInt(limit)) fail('BYTE_LIMIT', `Metadata/artifact exceeds its byte budget: ${path}`)
    const hash = createHash('sha256')
    const chunks = []
    const buffer = Buffer.alloc(64 * 1024)
    let bytes = 0
    while (true) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, limit + 1 - bytes), null)
      if (count === 0) break
      bytes += count
      if (bytes > limit) fail('BYTE_LIMIT', `Metadata/artifact grew beyond its byte budget: ${path}`)
      hash.update(buffer.subarray(0, count))
      if (role === 'metadata' || retainText) chunks.push(Buffer.from(buffer.subarray(0, count)))
    }
    const after = fstatSync(fd, { bigint: true })
    const afterPath = regularPath(root, path)
    if (signature(fileIdentity(after)) !== signature(opened) || signature(afterPath.trail) !== signature(beforePath.trail)
      || BigInt(bytes) !== before.size) fail('TARGET_CHANGED', `File changed while reading: ${path}`)
    budget.remaining -= bytes
    return {
      file: { path, role, bytes, sha256: hash.digest('hex') },
      trail: beforePath.trail,
      ...((role === 'metadata' || retainText) ? { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: retainText }).decode(Buffer.concat(chunks)) } : {}),
    }
  } finally { closeSync(fd) }
}

function manifestFromYaml(text) {
  const document = parseDocument(text, { version: '1.2', schema: 'core', strict: true, uniqueKeys: true, prettyErrors: false })
  if (document.errors.length || document.warnings.length) fail('INVALID_MANIFEST', 'dshx.yml must be unambiguous core-schema YAML')
  const stack = [{ node: document.contents, depth: 0 }]
  let count = 0
  while (stack.length) {
    const { node, depth } = stack.pop()
    if (++count > DEVELOPMENT_TARGET_LIMITS.yamlNodes || depth > DEVELOPMENT_TARGET_LIMITS.yamlDepth) fail('MANIFEST_LIMIT', 'dshx.yml exceeds the YAML structure budget')
    if (isAlias(node)) fail('INVALID_MANIFEST', 'dshx.yml aliases are not accepted')
    if (isMap(node)) {
      for (const pair of node.items) stack.push({ node: pair.key, depth: depth + 1 }, { node: pair.value, depth: depth + 1 })
    } else if (isSeq(node)) {
      for (const child of node.items) stack.push({ node: child, depth: depth + 1 })
    }
  }
  const value = document.toJS({ maxAliasCount: 0 })
  if (!record(value)) fail('INVALID_MANIFEST', 'dshx.yml must be an object')
  return value
}

function readSnapshot(sourceRoot, pluginId, { runtimeEntry, retainCode = false } = {}) {
  const budget = { remaining: DEVELOPMENT_TARGET_LIMITS.totalBytes }
  const pkg = readBounded(sourceRoot, 'package.json', 'metadata', budget)
  const yml = readBounded(sourceRoot, 'dshx.yml', 'metadata', budget)
  let packageManifest
  try { packageManifest = JSON.parse(pkg.text) } catch { fail('INVALID_MANIFEST', 'package.json must contain valid JSON') }
  if (!record(packageManifest) || packageManifest.name !== pluginId) fail('IDENTITY_MISMATCH', 'package.json name must exactly match the selected plugin id')
  const manifest = manifestFromYaml(yml.text)
  if (manifest.id !== pluginId || manifest.profile !== 'web') fail('IDENTITY_MISMATCH', 'dshx.yml must explicitly match the selected id and web profile')
  const entry = exactRelative(manifest.entry)
  if (manifest.hotReload !== undefined && (!record(manifest.hotReload) || Object.keys(manifest.hotReload).some(key => key !== 'artifacts'))) {
    fail('INVALID_MANIFEST', 'hotReload accepts only an artifacts field')
  }
  const configured = manifest.hotReload?.artifacts
  const artifacts = configured === undefined ? [entry] : configured
  if (!Array.isArray(artifacts) || artifacts.length < 1 || artifacts.length > DEVELOPMENT_TARGET_LIMITS.artifacts) fail('ARTIFACT_LIMIT', 'hotReload.artifacts must contain 1 to 32 files')
  const checked = artifacts.map(path => exactRelative(path))
  if (new Set(checked).size !== checked.length || !checked.includes(entry)) fail('INVALID_MANIFEST', 'hotReload.artifacts must be unique and include the declared entry')
  const compilation = runtimeEntry !== undefined
  if (compilation && configured === undefined) fail('COMPILATION_PROFILE_UNSUPPORTED', 'Compilation requires an explicit hotReload.artifacts closure')
  const paths = compilation ? [...new Set([...checked, exactRelative(runtimeEntry)])] : checked
  if (paths.length > DEVELOPMENT_TARGET_LIMITS.artifacts) fail('ARTIFACT_LIMIT', 'Declared artifacts plus registered runtimeEntry exceed 32 files')
  if (compilation && paths.some(path => !/\.(?:[cm]?js)$/.test(path))) fail('COMPILATION_PROFILE_UNSUPPORTED', 'Only an explicit JavaScript closure is supported; no TS/JSX/build or Loader inference')
  const runtime = [...paths].sort().map(path => readBounded(sourceRoot, path, 'artifact', budget, retainCode))
  const all = [pkg, yml, ...runtime]
  return {
    observed: {
      entry, profile: 'web', declaredArtifacts: [...checked],
      ...(compilation ? { declaredEntry: entry, resolvedRuntimeEntry: runtimeEntry } : {}),
      files: all.map(item => item.file),
      trails: all.map(item => item.trail),
    },
    ...(retainCode ? { code: runtime.map(item => ({ path: item.file.path, code: item.text, sha256: item.file.sha256, bytes: item.file.bytes })) } : {}),
  }
}

function hasIdentity(ancestors, target) {
  return ancestors.some(item => item.dev === target.dev && item.ino === target.ino)
}
function assertEligible(source, host, extensionsIdentity, pluginId) {
  const sourceRoot = source.path
  const harnessRoot = host.path
  const extensions = join(harnessRoot, 'my-plugins')
  // Identity ancestry also protects case-insensitive / normalization-insensitive
  // filesystems: a differently spelled RUNTIME path is still the same core.
  if (hasIdentity(host.ancestors, source.identity)
    || hasIdentity([extensionsIdentity], source.identity)
    || (hasIdentity(source.ancestors, host.identity) && !hasIdentity(source.ancestors, extensionsIdentity))
    || sourceRoot === extensions || (within(sourceRoot, harnessRoot) && !within(sourceRoot, extensions))) {
    fail('PROTECTED_TARGET', 'Only my-plugins packages, not other Harness checkout directories, are development targets')
  }
  if (protectedId(pluginId) || sourceRoot.split(sep).some(part => protectedId(part.toLowerCase()))) fail('PROTECTED_TARGET', 'Control infrastructure is not eligible for remembered development authorization')
  if (sourceRoot.split(sep).some(part => ['node_modules', '.git', '.dsh', '.agent-presets'].includes(part.toLowerCase()))) fail('PROTECTED_TARGET', 'Dependency, profile, or VCS storage is not a development target')
  const control = directoryPath(OWN_PACKAGE, 'Creator control source')
  if (CORE_DIRECTORIES.some(name => overlaps(sourceRoot, join(harnessRoot, name))) || overlaps(sourceRoot, OWN_PACKAGE)
    || hasIdentity(source.ancestors, control.identity) || hasIdentity(control.ancestors, source.identity)) {
    fail('PROTECTED_TARGET', 'Harness core and Creator control sources are not eligible development targets')
  }
  return control.trail
}

/**
 * getHarnessRoot is a synchronous Host-owned resolver, NOT a model parameter.
 * capture failures throw DevelopmentTargetError { eligible:false, code }.
 * Snapshots are resolver-issued object capabilities for revalidation, not grants.
 * External source roots are supported; workspaceRoot binds the actual Agent cwd
 * without falsely requiring that every claimed external plugin lives inside it.
 */
export function createDevelopmentTargetResolver({ getHarnessRoot, readRegisteredTarget, readCompilationSignals, producerSignal,
  compilationTtlMs = DEVELOPMENT_COMPILATION_LIMITS.ttlMs, compilationNow = () => performance.now(),
} = {}) {
  if (typeof getHarnessRoot !== 'function') throw new TypeError('A Host-owned getHarnessRoot callback is required')
  const issued = new WeakMap(), compilations = new WeakMap(), pending = new Set()
  let compilationDisposed = false, capturing = false, retainedBytes = 0, lastClock = 0
  function locate(exec, pluginId) {
    if (typeof pluginId !== 'string' || pluginId.length > 128 || !PLUGIN_ID.test(pluginId)) fail('INVALID_PLUGIN_ID', 'Select one bounded lower-case kebab-case plugin id, not a path')
    const agent = exec?.agent
    if (!agent || typeof agent !== 'object') fail('MISSING_AGENT', 'The real execution Agent is required')
    const host = directoryPath(getHarnessRoot(), 'Host Harness root')
    const workspace = directoryPath(agent.session?.header?.cwd, 'Agent session cwd')
    // DSHX resolvePluginDir(root, id) tries root/id before my-plugins/id.
    // Do not approve the latter while a same-name checkout entry can shadow it.
    let shadow
    try { shadow = lstatSync(join(host.path, pluginId), { bigint: true }) } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (shadow) fail('AMBIGUOUS_PLUGIN_ROOT', 'A same-name Harness-root entry can shadow the selected my-plugins target')
    const base = join(host.path, 'my-plugins')
    const baseStat = lstatSync(base, { bigint: true })
    if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) fail('INVALID_PLUGIN_ROOT', 'Harness my-plugins must be a real directory')
    const source = directoryPath(join(base, pluginId), 'my-plugins target')
    const controlTrail = assertEligible(source, host, identity(baseStat), pluginId)
    return {
      agent,
      binding: {
        engine: DEVELOPMENT_TARGET_ENGINE,
        harnessRoot: host.path,
        workspaceRoot: workspace.path,
        sourceRoot: source.path,
        pluginId,
        sourceDirectoryIdentity: source.identity,
      },
      route: { host: host.trail, workspace: workspace.trail, base: identity(baseStat), source: source.trail, control: controlTrail },
    }
  }
  function observe(exec, pluginId) {
    const first = locate(exec, pluginId)
    const firstFiles = readSnapshot(first.binding.sourceRoot, pluginId).observed
    // A bounded second full observation catches changes during metadata parsing
    // and hashing. Neither pass is an atomic filesystem snapshot or child lease.
    const second = locate(exec, pluginId)
    const secondFiles = readSnapshot(second.binding.sourceRoot, pluginId).observed
    const firstProof = { binding: first.binding, route: first.route, files: firstFiles }
    const secondProof = { binding: second.binding, route: second.route, files: secondFiles }
    if (signature(firstProof) !== signature(secondProof)) fail('TARGET_CHANGED', 'Development target changed while capturing its snapshot')
    return { ...first, observed: firstFiles, proof: signature(firstProof) }
  }
  function capture(exec, pluginId) {
    try {
      const observed = observe(exec, pluginId)
      const snapshot = freeze({
        eligible: true,
        binding: observed.binding,
        entry: observed.observed.entry,
        profile: observed.observed.profile,
        declaredArtifacts: observed.observed.declaredArtifacts,
        files: observed.observed.files,
        evidenceBoundary: 'parent-observation-only',
      })
      issued.set(snapshot, { agent: observed.agent, proof: observed.proof, pluginId })
      return snapshot
    } catch (error) {
      if (error instanceof DevelopmentTargetError) throw error
      throw new DevelopmentTargetError('TARGET_UNAVAILABLE', 'Development target could not be safely observed', error)
    }
  }
  function revalidate(snapshot, exec) {
    const prior = snapshot && typeof snapshot === 'object' ? issued.get(snapshot) : undefined
    if (!prior) fail('UNISSUED_SNAPSHOT', 'Revalidation requires this resolver\'s original snapshot object')
    if (prior.compilationHandle) { validateCompilation(prior.compilationHandle, exec); return snapshot }
    if (exec?.agent !== prior.agent) fail('AGENT_MISMATCH', 'A snapshot cannot move to another Agent')
    try {
      const current = observe(exec, prior.pluginId)
      if (current.proof !== prior.proof) fail('TARGET_CHANGED', 'Development target no longer matches the captured snapshot')
      return snapshot
    } catch (error) {
      if (error instanceof DevelopmentTargetError && error.code === 'TARGET_CHANGED') throw error
      throw new DevelopmentTargetError('TARGET_CHANGED', 'Development target is unavailable or changed since capture', error)
    }
  }
  // Compilation is an opt-in PRIVATE composition, not a public model argument.
  // The registry reader resolves an exact opaque registered target lease. The
  // signal reader resolves the same real exec -> already-entered C owner/policy
  // witnesses; it must never look up a newest owner by Agent/session identifier.
  function compilationReady() {
    if (compilationDisposed) fail('COMPILATION_DISPOSED', 'Compilation capture was disposed')
    if (typeof readRegisteredTarget !== 'function' || typeof readCompilationSignals !== 'function' || !signal(producerSignal)
      || utilTypes.isAsyncFunction(readRegisteredTarget) || utilTypes.isAsyncFunction(readCompilationSignals)
      || typeof compilationNow !== 'function' || !Number.isInteger(compilationTtlMs) || compilationTtlMs <= 0
      || compilationTtlMs > DEVELOPMENT_COMPILATION_LIMITS.ttlMs) fail('COMPILATION_UNAVAILABLE', 'Private registry, execution lifetimes and a bounded TTL are required')
    if (producerSignal.aborted) fail('COMPILATION_CANCELLED', 'The producer lifetime ended')
  }
  function clock() {
    let value
    try { value = compilationNow() } catch { dispose(); fail('COMPILATION_EXPIRED', 'The capture clock is unavailable') }
    if (!Number.isFinite(value) || value < lastClock || value < 0 || value > Number.MAX_SAFE_INTEGER - DEVELOPMENT_COMPILATION_LIMITS.ttlMs) {
      dispose(); fail('COMPILATION_EXPIRED', 'A finite monotonic capture clock is required')
    }
    lastClock = value
    return value
  }
  function context(exec) {
    compilationReady()
    if (!record(exec) || !record(exec.agent) || !record(exec.agent.session) || typeof exec.token !== 'symbol' || !signal(exec.signal)) {
      fail('COMPILATION_CONTEXT_CHANGED', 'The original execution with its actual body signal is required')
    }
    const value = synchronous(readCompilationSignals(exec), 'COMPILATION_UNAVAILABLE')
    if (!record(value)) fail('COMPILATION_UNAVAILABLE', 'The private owner/policy lifetime reader is unavailable')
    const { ownerSignal, policySignal } = value
    if (!signal(ownerSignal) || !signal(policySignal)) fail('COMPILATION_UNAVAILABLE', 'The private owner/policy lifetime reader is unavailable')
    if (compilationDisposed || producerSignal.aborted || exec.signal.aborted || ownerSignal.aborted || policySignal.aborted) fail('COMPILATION_CANCELLED', 'An execution lifetime ended')
    return { exec, agent: exec.agent, session: exec.agent.session, token: exec.token, bodySignal: exec.signal,
      ownerSignal, policySignal, args: exec.arguments, name: exec.name,
      callId: exec.callId, rootCallId: exec.rootCallId, parent: exec.parent }
  }
  function checkContext(prior, createdAt, expiresAt) {
    const now = clock()
    if (now < createdAt || now >= expiresAt) fail('COMPILATION_EXPIRED', 'The bounded compilation input expired')
    const current = context(prior.exec)
    if (Object.keys(prior).some(key => current[key] !== prior[key])) fail('COMPILATION_CONTEXT_CHANGED', 'The execution or its private lifetime binding changed')
  }
  function registered(lease) {
    if (lease === null || lease === undefined) fail('REGISTERED_TARGET_UNAVAILABLE', 'An exact registered target lease is required, not a default target')
    const raw = synchronous(readRegisteredTarget(lease), 'REGISTERED_TARGET_UNAVAILABLE')
    if (!record(raw)) fail('REGISTERED_TARGET_UNAVAILABLE', 'The registered target lease is missing or revoked')
    const keys = ['harnessRoot', 'sourceRoot', 'pluginId', 'sourceDirectoryIdentity', 'runtimeEntry']
    if (Reflect.ownKeys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))) fail('REGISTERED_TARGET_UNAVAILABLE', 'The fixed physical target descriptor must contain exactly the documented fields')
    const value = Object.fromEntries(keys.map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('REGISTERED_TARGET_UNAVAILABLE', 'Registered physical descriptors must be data, not getters')
      return [key, descriptor.value]
    }))
    const sourceIdentity = value.sourceDirectoryIdentity
    if (!record(sourceIdentity) || !/^(?:0|[1-9][0-9]{0,39})$/.test(sourceIdentity.dev)
      || !/^[1-9][0-9]{0,39}$/.test(sourceIdentity.ino)
      || typeof sourceIdentity.dev !== 'string' || typeof sourceIdentity.ino !== 'string') fail('REGISTERED_TARGET_UNAVAILABLE', 'The registered physical directory identity is invalid')
    const runtimeEntry = exactRelative(value.runtimeEntry)
    if (!/\.(?:[cm]?js)$/.test(runtimeEntry)) fail('COMPILATION_PROFILE_UNSUPPORTED', 'The registered runtime entry must be one explicit package-relative JavaScript file')
    return freeze({ harnessRoot: absolutePath(value.harnessRoot, 'Registered Harness root'),
      sourceRoot: absolutePath(value.sourceRoot, 'Registered source root'), pluginId: value.pluginId,
      sourceDirectoryIdentity: { dev: sourceIdentity.dev, ino: sourceIdentity.ino }, runtimeEntry })
  }
  function observeCompilation(exec, lease, expectedRegistration, retainCode, guard) {
    let registration = expectedRegistration
    function readPass() {
      guard()
      const selected = registered(lease)
      guard()
      if (registration && signature(selected) !== signature(registration)) fail('REGISTERED_TARGET_CHANGED', 'The registered runtime entry or physical target changed')
      registration ??= selected
      const located = locate(exec, selected.pluginId)
      if (['harnessRoot', 'sourceRoot', 'pluginId'].some(key => located.binding[key] !== selected[key])
        || signature(located.binding.sourceDirectoryIdentity) !== signature(selected.sourceDirectoryIdentity)) {
        fail('REGISTERED_TARGET_MISMATCH', 'The located target does not match the registered physical target')
      }
      guard()
      const files = readSnapshot(located.binding.sourceRoot, selected.pluginId, { runtimeEntry: selected.runtimeEntry, retainCode })
      guard()
      return { ...located, observed: files.observed, code: files.code,
        proof: signature({ binding: located.binding, route: located.route, files: files.observed }) }
    }
    const first = readPass(), second = readPass()
    if (first.proof !== second.proof || (retainCode && first.code.some((item, index) => item.code !== second.code[index]?.code))) {
      fail('TARGET_CHANGED', 'The registered compilation inputs changed between bounded FD reads')
    }
    if (signature(registered(lease)) !== signature(registration)) fail('REGISTERED_TARGET_CHANGED', 'The registration changed before capture completed')
    guard()
    return { ...first, registration }
  }
  function drop(entry, code) {
    if (!entry || entry.closed) return false
    entry.closed = code
    pending.delete(entry)
    retainedBytes -= entry.bytes
    clearTimeout(entry.timer)
    entry.detach?.()
    // Leave only a light tombstone for a retained opaque handle. In particular,
    // revoked handles retain neither code nor the real Agent/exec/lease graph.
    for (const key of Object.keys(entry)) if (key !== 'closed') delete entry[key]
    return true
  }
  function sweep() {
    const now = clock()
    for (const entry of [...pending]) if (now < entry.createdAt || now >= entry.expiresAt) drop(entry, 'COMPILATION_EXPIRED')
  }
  function dispose() {
    if (compilationDisposed) return
    compilationDisposed = true
    for (const entry of [...pending]) drop(entry, 'COMPILATION_DISPOSED')
    if (signal(producerSignal)) producerSignal.removeEventListener('abort', dispose)
  }
  if (signal(producerSignal)) producerSignal.addEventListener('abort', dispose, { once: true })

  function captureCompilation(exec, opaqueLease) {
    compilationReady(); sweep()
    if (capturing || pending.size >= DEVELOPMENT_COMPILATION_LIMITS.pending) fail('COMPILATION_LIMIT', 'Compilation input capacity is exhausted or capture is reentrant')
    capturing = true
    let created
    try {
      const prior = context(exec), createdAt = clock(), expiresAt = createdAt + compilationTtlMs
      const guard = () => checkContext(prior, createdAt, expiresAt)
      const observed = observeCompilation(exec, opaqueLease, undefined, true, guard)
      const bytes = observed.code.reduce((sum, item) => sum + Buffer.byteLength(item.code, 'utf8'), 0)
      if (retainedBytes + bytes > DEVELOPMENT_COMPILATION_LIMITS.retainedBytes) fail('COMPILATION_LIMIT', 'Aggregate retained code exceeds 16 MiB')
      const snapshot = freeze({ eligible: true, binding: observed.binding, entry: observed.observed.entry,
        declaredEntry: observed.observed.declaredEntry, resolvedRuntimeEntry: observed.observed.resolvedRuntimeEntry,
        profile: observed.observed.profile, declaredArtifacts: observed.observed.declaredArtifacts,
        files: observed.observed.files, evidenceBoundary: 'parent-observation-only' })
      // Code is constructed ONLY from the two pre-approval FD observations. Input
      // reads below re-hash for validation, but NEVER replace these strings.
      const input = freeze({ binding: snapshot.binding, declaredEntry: snapshot.declaredEntry,
        resolvedRuntimeEntry: snapshot.resolvedRuntimeEntry, files: observed.code, evidenceBoundary: 'parent-observation-only' })
      const handle = Object.freeze(Object.create(null))
      const entry = { context: prior, lease: opaqueLease, registration: observed.registration, proof: observed.proof,
        createdAt, expiresAt, bytes, snapshot, input }
      created = entry
      const remaining = Math.max(1, Math.ceil(expiresAt - clock()))
      guard()
      const lifetime = AbortSignal.any([prior.bodySignal, prior.ownerSignal, prior.policySignal, producerSignal])
      const cancel = () => drop(entry, 'COMPILATION_CANCELLED')
      entry.detach = () => lifetime.removeEventListener('abort', cancel)
      pending.add(entry); retainedBytes += bytes
      compilations.set(handle, entry); issued.set(snapshot, { compilationHandle: handle })
      lifetime.addEventListener('abort', cancel, { once: true })
      entry.timer = setTimeout(() => drop(entry, 'COMPILATION_EXPIRED'), remaining)
      entry.timer.unref()
      if (lifetime.aborted) { cancel(); fail('COMPILATION_CANCELLED', 'An execution lifetime ended during capture') }
      return handle
    } catch (error) {
      if (created && pending.has(created)) drop(created, error instanceof DevelopmentTargetError ? error.code : 'TARGET_UNAVAILABLE')
      if (error instanceof DevelopmentTargetError) throw error
      throw new DevelopmentTargetError('TARGET_UNAVAILABLE', 'Registered compilation inputs could not be safely captured', error)
    } finally { capturing = false }
  }
  function validateCompilation(handle, exec) {
    const entry = handle && typeof handle === 'object' ? compilations.get(handle) : undefined
    if (!entry) fail('UNISSUED_COMPILATION', 'Use this resolver\'s exact compilation handle')
    if (entry.closed) fail(entry.closed, 'This compilation input is no longer live')
    // A borrower cannot gain access or destroy the rightful invocation's input.
    if (exec !== entry.context.exec) fail('COMPILATION_CONTEXT_CHANGED', 'Compilation inputs cannot move to a different exec, even on the same Agent')
    if (entry.checking) { drop(entry, 'COMPILATION_CONTEXT_CHANGED'); fail('COMPILATION_CONTEXT_CHANGED', 'Compilation revalidation cannot reenter itself') }
    entry.checking = true
    try {
      const guard = () => {
        if (entry.closed) fail(entry.closed, 'The compilation lifetime ended during revalidation')
        checkContext(entry.context, entry.createdAt, entry.expiresAt)
      }
      guard()
      const current = observeCompilation(exec, entry.lease, entry.registration, false, guard)
      if (current.proof !== entry.proof) fail('TARGET_CHANGED', 'Source, workspace, or registered compilation inputs changed')
      guard()
      return entry
    } catch (error) {
      const failure = error instanceof DevelopmentTargetError ? error
        : new DevelopmentTargetError('TARGET_CHANGED', 'Registered compilation input became unavailable', error)
      drop(entry, failure.code)
      throw failure
    } finally { if (!entry.closed) entry.checking = false }
  }
  function releaseCompilation(handle) { return drop(handle && typeof handle === 'object' ? compilations.get(handle) : undefined, 'COMPILATION_RELEASED') }
  return Object.freeze({ capture, revalidate, captureCompilation,
    compilationSnapshot: (handle, exec) => validateCompilation(handle, exec).snapshot,
    compilationInput: (handle, exec) => validateCompilation(handle, exec).input,
    releaseCompilation, dispose })
}
