/** Real temporary files and the actual bounded FD reader. Exec/registry/signal
 * fixtures test identity and lifetime, NOT native provenance, human approval,
 * compilation, Loader interpretation, managed execution, or activation. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, lstatSync, rmSync, symlinkSync, renameSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { stringify } from 'yaml'
import { createDevelopmentTargetResolver, DevelopmentTargetError, DEVELOPMENT_COMPILATION_LIMITS as C, DEVELOPMENT_TARGET_LIMITS as T } from '../src/development-target.js'
const error = code => value => value instanceof DevelopmentTargetError && value.eligible === false && (!code || value.code === code)
const hash = value => createHash('sha256').update(value).digest('hex')
const options = { timeout: 15000 }
function fixture(t, options = {}) {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'creator-compilation-'))), id = 'demo-widget'
  const harnessRoot = join(temp, 'runtime'), sourceRoot = join(temp, 'sources', id), workspace = join(temp, 'work')
  mkdirSync(join(harnessRoot, 'my-plugins'), { recursive: true }); mkdirSync(workspace)
  mkdirSync(join(sourceRoot, 'src'), { recursive: true }); mkdirSync(join(sourceRoot, 'dist'))
  const files = {
    'src/index.js': 'globalThis.__creatorCompilationMustNotExecute = true; export const declared = 1;\n',
    'src/helper.js': 'export const helper = 2;\n',
    'dist/runtime.mjs': 'export const actual = 3;\n',
  }
  for (const [path, code] of Object.entries(files)) writeFileSync(join(sourceRoot, path), code)
  writeFileSync(join(sourceRoot, 'package.json'), JSON.stringify({ name: id, version: '1.0.0', main: './unlisted-do-not-resolve.js' }))
  const manifest = extra => writeFileSync(join(sourceRoot, 'dshx.yml'), stringify({ id, profile: 'web', entry: 'src/index.js', hotReload: { artifacts: ['src/index.js', 'src/helper.js'] }, ...extra }))
  manifest()
  symlinkSync(sourceRoot, join(harnessRoot, 'my-plugins', id), 'dir')
  const identity = lstatSync(sourceRoot, { bigint: true })
  const descriptor = Object.freeze({ harnessRoot, sourceRoot, pluginId: id,
    sourceDirectoryIdentity: Object.freeze({ dev: String(identity.dev), ino: String(identity.ino) }), runtimeEntry: 'dist/runtime.mjs' })
  const body = new AbortController(), owner = new AbortController(), policy = new AbortController(), producer = new AbortController()
  const exec = { token: Symbol('native-identity-fixture'), signal: body.signal, agent: { session: { header: { cwd: workspace } } }, arguments: Object.freeze({ name: id }) }
  const lease = Object.freeze({}), registry = new WeakMap([[lease, descriptor]])
  const contexts = new WeakMap([[exec, { ownerSignal: owner.signal, policySignal: policy.signal }]])
  let now = 100, registryReader = value => registry.get(value), signalReader = value => contexts.get(value)
  const config = { getHarnessRoot: () => harnessRoot, readRegisteredTarget: value => registryReader(value), readCompilationSignals: value => signalReader(value), producerSignal: producer.signal, compilationNow: () => now, ...options }
  const resolver = createDevelopmentTargetResolver(config)
  t.after(() => { resolver.dispose(); rmSync(temp, { recursive: true, force: true }) })
  return { temp, id, harnessRoot, sourceRoot, workspace, files, manifest, descriptor, lease, registry, contexts, exec,
    body, owner, policy, producer, resolver, config,
    time(value) { now = value },
    registryReader(value) { registryReader = value }, signalReader(value) { signalReader = value },
    capture() { return resolver.captureCompilation(exec, lease) },
    code(path, value) { mkdirSync(dirname(join(sourceRoot, path)), { recursive: true }); writeFileSync(join(sourceRoot, path), value) },
  }
}

test('registered actual runtime entry is included even when not declared; public snapshot has no code and input uses that exact binding', options, t => {
  const f = fixture(t), handle = f.capture(), snapshot = f.resolver.compilationSnapshot(handle, f.exec), input = f.resolver.compilationInput(handle, f.exec)
  assert.equal(Object.isFrozen(handle), true); assert.deepEqual(Reflect.ownKeys(handle), [])
  assert.equal(snapshot.entry, 'src/index.js'); assert.equal(snapshot.declaredEntry, 'src/index.js')
  assert.equal(snapshot.resolvedRuntimeEntry, 'dist/runtime.mjs')
  assert.deepEqual(snapshot.declaredArtifacts, ['src/index.js', 'src/helper.js'])
  assert.equal(snapshot.files.length, 5)
  assert.ok(snapshot.files.some(file => file.path === 'dist/runtime.mjs'))
  assert.equal(snapshot.binding.workspaceRoot, f.exec.agent.session.header.cwd)
  assert.equal(snapshot.binding.sourceRoot, f.sourceRoot)
  assert.equal(snapshot.binding.engine, 'creator-plus-v1')
  assert.equal(input.binding, snapshot.binding) // Never a later independent capture.
  assert.equal(Object.isFrozen(input.binding), true)
  assert.equal(Object.isFrozen(input.files[0]), true)
  assert.equal(input.evidenceBoundary, 'parent-observation-only')
  assert.equal(snapshot.evidenceBoundary, 'parent-observation-only')
  assert.ok(!JSON.stringify(snapshot).includes('__creatorCompilationMustNotExecute'))
  assert.ok(snapshot.files.every(file => !Object.hasOwn(file, 'code')))
  assert.equal(globalThis.__creatorCompilationMustNotExecute, undefined)
  for (const file of input.files) {
    const original = readFileSync(join(f.sourceRoot, file.path))
    assert.equal(file.code, original.toString('utf8'))
    assert.equal(file.sha256, hash(original)); assert.equal(file.bytes, original.length)
  }
  assert.equal(f.resolver.compilationInput(handle, f.exec), input) // Same pre-approval strings, not rebuilt from a later read.
  assert.equal(f.resolver.revalidate(snapshot, f.exec), snapshot)
})

test('UTF-8 BOM, CRLF and multibyte code retain the exact original bytes/hash', options, t => {
  const f = fixture(t), path = 'dist/runtime.mjs'
  const bytes = Buffer.from('\ufeffexport const text = "€ 😀";\r\n', 'utf8')
  f.code(path, bytes)
  const file = f.resolver.compilationInput(f.capture(), f.exec).files.find(file => file.path === path)
  assert.equal(file.code.charCodeAt(0), 0xfeff)
  assert.deepEqual(Buffer.from(file.code, 'utf8'), bytes)
  assert.equal(file.bytes, bytes.length); assert.equal(file.sha256, hash(bytes))
})

for (const key of ['readRegisteredTarget', 'readCompilationSignals', 'producerSignal']) {
  test(`missing ${key} closes compilation but does not change old capture/revalidate`, options, t => {
    const f = fixture(t, { [key]: undefined })
    assert.throws(() => f.capture(), error('COMPILATION_UNAVAILABLE'))
    const snapshot = f.resolver.capture(f.exec, f.id)
    assert.equal(f.resolver.revalidate(snapshot, { ...f.exec }), snapshot)
  })
}
for (const [label, key, reader] of [
  ['async registry', 'readRegisteredTarget', async () => ({})],
  ['promise registry', 'readRegisteredTarget', () => Promise.reject(new Error('rejected reader'))],
  ['thenable registry', 'readRegisteredTarget', () => ({ then() {} })],
  ['async lifetime', 'readCompilationSignals', async () => ({})],
  ['promise lifetime', 'readCompilationSignals', () => Promise.reject(new Error('rejected reader'))],
]) {
  test(`${label} is refused rather than interpreted as a ready value`, options, t => {
    const f = fixture(t, { [key]: reader })
    assert.throws(() => f.capture(), error())
  })
}

test('only the private registry resolves a lease; copied descriptors and model paths are not authority', options, t => {
  const f = fixture(t)
  assert.throws(() => f.resolver.captureCompilation(f.exec, { ...f.descriptor }), error('REGISTERED_TARGET_UNAVAILABLE'))
  assert.throws(() => f.resolver.captureCompilation(f.exec, undefined), error('REGISTERED_TARGET_UNAVAILABLE'))
  f.exec.arguments = Object.freeze({ runtimeEntry: 'src/helper.js', workspaceRoot: '/', sourceRoot: '/', name: 'unrelated' })
  const snapshot = f.resolver.compilationSnapshot(f.capture(), f.exec)
  assert.equal(snapshot.resolvedRuntimeEntry, f.descriptor.runtimeEntry)
  assert.equal(snapshot.binding.pluginId, f.id)
  assert.equal(snapshot.binding.workspaceRoot, f.workspace)
})
for (const key of ['harnessRoot', 'sourceRoot', 'sourceDirectoryIdentity', 'workspaceRoot']) {
  test(`registered physical descriptor cannot substitute ${key} for actual locate/session facts`, options, t => {
    const f = fixture(t)
    const value = key === 'sourceDirectoryIdentity' ? { ...f.descriptor.sourceDirectoryIdentity, ino: '999999999999' } : f.temp
    f.registry.set(f.lease, { ...f.descriptor, [key]: value })
    assert.throws(() => f.capture(), error(key === 'workspaceRoot' ? 'REGISTERED_TARGET_UNAVAILABLE' : 'REGISTERED_TARGET_MISMATCH'))
  })
}

test('original exec identity is mandatory even for the same Agent, including public snapshot revalidate', options, t => {
  const f = fixture(t), handle = f.capture(), snapshot = f.resolver.compilationSnapshot(handle, f.exec)
  const other = { ...f.exec, token: Symbol('other native call') }
  f.contexts.set(other, f.contexts.get(f.exec))
  assert.throws(() => f.resolver.compilationInput(handle, other), error('COMPILATION_CONTEXT_CHANGED'))
  assert.throws(() => f.resolver.revalidate(snapshot, other), error('COMPILATION_CONTEXT_CHANGED'))
  assert.throws(() => f.resolver.compilationInput({ ...handle }, f.exec), error('UNISSUED_COMPILATION'))
  const foreign = createDevelopmentTargetResolver(f.config); t.after(() => foreign.dispose())
  assert.throws(() => foreign.compilationInput(handle, f.exec), error('UNISSUED_COMPILATION'))
  assert.ok(f.resolver.compilationInput(handle, f.exec).files.length) // Borrowing does not destroy the rightful owner's input.
})
for (const mutate of ['agent', 'session', 'token', 'signal', 'arguments']) {
  test(`mutating the original exec ${mutate} invalidates the compilation handle`, options, t => {
    const f = fixture(t), handle = f.capture()
    if (mutate === 'agent') f.exec.agent = { session: f.exec.agent.session }
    else if (mutate === 'session') f.exec.agent.session = { header: { cwd: f.workspace } }
    else if (mutate === 'token') f.exec.token = Symbol('replacement')
    else if (mutate === 'signal') f.exec.signal = new AbortController().signal
    else f.exec.arguments = { ...f.exec.arguments }
    assert.throws(() => f.resolver.compilationInput(handle, f.exec), error('COMPILATION_CONTEXT_CHANGED'))
    assert.equal(f.resolver.releaseCompilation(handle), false)
  })
}
for (const field of ['ownerSignal', 'policySignal']) {
  test(`a different live ${field} cannot renew an existing exec's input`, options, t => {
    const f = fixture(t), handle = f.capture(), original = f.contexts.get(f.exec)
    f.contexts.set(f.exec, { ...original, [field]: new AbortController().signal })
    assert.throws(() => f.resolver.compilationInput(handle, f.exec), error('COMPILATION_CONTEXT_CHANGED'))
    f.contexts.set(f.exec, original)
    assert.throws(() => f.resolver.compilationInput(handle, f.exec), error('COMPILATION_CONTEXT_CHANGED'))
  })
}
for (const name of ['body', 'owner', 'policy', 'producer']) {
  test(`${name} cancellation immediately releases the private input and cannot revive`, options, t => {
    const f = fixture(t), handle = f.capture()
    f[name].abort()
    assert.equal(f.resolver.releaseCompilation(handle), false)
    assert.throws(() => f.resolver.compilationInput(handle, f.exec), error())
    assert.throws(() => f.capture(), error())
  })
}

test('revoked target lease closes both input and snapshot revalidate instead of selecting another current target', options, t => {
  const f = fixture(t), handle = f.capture(), snapshot = f.resolver.compilationSnapshot(handle, f.exec)
  f.registry.delete(f.lease)
  assert.throws(() => f.resolver.revalidate(snapshot, f.exec), error('REGISTERED_TARGET_UNAVAILABLE'))
  f.registry.set(f.lease, f.descriptor)
  assert.throws(() => f.resolver.compilationInput(handle, f.exec), error('REGISTERED_TARGET_UNAVAILABLE'))
})
test('registered runtimeEntry changes are closed, including a later return to the original entry', options, t => {
  const f = fixture(t), handle = f.capture()
  f.registry.set(f.lease, { ...f.descriptor, runtimeEntry: 'src/helper.js' })
  assert.throws(() => f.resolver.compilationInput(handle, f.exec), error('REGISTERED_TARGET_CHANGED'))
  f.registry.set(f.lease, f.descriptor)
  assert.throws(() => f.resolver.compilationInput(handle, f.exec), error('REGISTERED_TARGET_CHANGED'))
})
for (const path of ['src/index.js', 'src/helper.js', 'dist/runtime.mjs']) {
  test(`changed ${path} cannot replace pre-approval code during input revalidation`, options, t => {
    const f = fixture(t), handle = f.capture(), original = f.resolver.compilationInput(handle, f.exec)
    f.code(path, 'export const changed = 100;\n')
    assert.throws(() => f.resolver.compilationInput(handle, f.exec), error('TARGET_CHANGED'))
    assert.equal(original.files.find(file => file.path === path).code, f.files[path])
    assert.equal(f.resolver.releaseCompilation(handle), false)
  })
}
test('the actual runtime entry participates in both FD passes, not only an added hash after capture', options, t => {
  const f = fixture(t); let calls = 0
  f.registryReader(lease => { if (++calls === 2) f.code('dist/runtime.mjs', 'export const changedDuringCapture = true;\n'); return f.registry.get(lease) })
  assert.throws(() => f.capture(), error('TARGET_CHANGED'))
})
test('lease revocation between the two reads cannot yield an input', options, t => {
  const f = fixture(t); let calls = 0
  f.registryReader(lease => { if (++calls === 2) f.registry.delete(lease); return f.registry.get(lease) })
  assert.throws(() => f.capture(), error('REGISTERED_TARGET_UNAVAILABLE'))
})
test('policy cancellation by a private reader before the second pass yields no handle', options, t => {
  const f = fixture(t); let calls = 0
  f.registryReader(lease => { if (++calls === 2) f.policy.abort(); return f.registry.get(lease) })
  assert.throws(() => f.capture(), error('COMPILATION_CANCELLED'))
})
test('workspace changes are bound to the same capture, not taken from registration or a later independent snapshot', options, t => {
  const f = fixture(t), handle = f.capture()
  f.exec.agent.session.header.cwd = f.temp
  assert.throws(() => f.resolver.compilationInput(handle, f.exec), error('TARGET_CHANGED'))
})
for (const kind of ['leaf', 'directory']) {
  test(`registered runtime ${kind} symlink cannot enter the copied closure`, options, t => {
    const f = fixture(t), original = join(f.sourceRoot, kind === 'leaf' ? 'dist/runtime.mjs' : 'dist'), outside = join(f.temp, 'moved')
    renameSync(original, outside); symlinkSync(outside, original, kind === 'leaf' ? 'file' : 'dir')
    assert.throws(() => f.capture(), error('SYMLINK_FORBIDDEN'))
  })
}
for (const entry of ['src/index.ts', 'src/index.jsx', '../escape.js', 'dist/*.js']) {
  test(`unsupported registered runtime ${entry} is never resolved by Node or a build script`, options, t => {
    const f = fixture(t); f.registry.set(f.lease, { ...f.descriptor, runtimeEntry: entry })
    assert.throws(() => f.capture(), error())
  })
}
test('compilation requires explicit artifacts while the old declared-entry-only observation still works', options, t => {
  const f = fixture(t); f.manifest({ hotReload: undefined })
  assert.throws(() => f.capture(), error('COMPILATION_PROFILE_UNSUPPORTED'))
  assert.equal(f.resolver.capture(f.exec, f.id).entry, 'src/index.js')
})
test('TS/JSX artifacts cannot be smuggled into a registered JS closure', options, t => {
  const f = fixture(t); f.code('src/helper.ts', 'export const x: number = 1')
  f.manifest({ hotReload: { artifacts: ['src/index.js', 'src/helper.ts'] } })
  assert.throws(() => f.capture(), error('COMPILATION_PROFILE_UNSUPPORTED'))
})
test('the unlisted actual runtime entry counts toward the 32-file limit', options, t => {
  const f = fixture(t), artifacts = ['src/index.js']
  for (let i = 1; i < T.artifacts; i++) { const path = `src/file${i}.js`; artifacts.push(path); f.code(path, 'export {}') }
  f.manifest({ hotReload: { artifacts } })
  assert.throws(() => f.capture(), error('ARTIFACT_LIMIT'))
  f.registry.set(f.lease, { ...f.descriptor, runtimeEntry: 'src/index.js' })
  assert.equal(f.resolver.compilationInput(f.capture(), f.exec).files.length, 32)
})
test('actual runtime file and combined reads keep the original byte budgets', options, t => {
  const f = fixture(t)
  truncateSync(join(f.sourceRoot, 'dist/runtime.mjs'), T.artifactBytes + 1)
  assert.throws(() => f.capture(), error('BYTE_LIMIT'))
  f.code('dist/runtime.mjs', 'export {}')
  const artifacts = ['src/index.js', 'src/a.js', 'src/b.js', 'src/c.js']
  for (const path of artifacts) { f.code(path, ''); truncateSync(join(f.sourceRoot, path), T.artifactBytes) }
  f.manifest({ hotReload: { artifacts } })
  assert.throws(() => f.capture(), error('BYTE_LIMIT'))
})
test('invalid UTF-8 code is rejected rather than relabeled with the original hash', options, t => {
  const f = fixture(t); f.code('dist/runtime.mjs', Buffer.from([0xff, 0xfe, 0xfd]))
  assert.throws(() => f.capture(), error('TARGET_UNAVAILABLE'))
})

test('the 64-input limit releases capacity on explicit release; old capture survives compilation dispose', options, t => {
  const f = fixture(t), handles = []
  for (let i = 0; i < C.pending; i++) handles.push(f.capture())
  assert.throws(() => f.capture(), error('COMPILATION_LIMIT'))
  assert.equal(f.resolver.releaseCompilation(handles[0]), true)
  assert.equal(f.resolver.releaseCompilation(handles[0]), false)
  assert.ok(f.capture())
  f.resolver.dispose()
  assert.equal(f.resolver.releaseCompilation(handles[1]), false)
  assert.throws(() => f.capture(), error('COMPILATION_DISPOSED'))
  const snapshot = f.resolver.capture(f.exec, f.id)
  assert.equal(f.resolver.revalidate(snapshot, f.exec), snapshot)
})
test('aggregate retained code is bounded independently of 64 slots and recovers on release', options, t => {
  const f = fixture(t); f.code('src/blob.js', Buffer.alloc(3 * 1024 * 1024, 32))
  f.manifest({ hotReload: { artifacts: ['src/index.js', 'src/helper.js', 'src/blob.js'] } })
  const handles = Array.from({ length: 5 }, () => f.capture())
  assert.throws(() => f.capture(), error('COMPILATION_LIMIT'))
  f.resolver.releaseCompilation(handles[0])
  assert.ok(f.capture())
})
test('expiry closes code and frees a slot even if a caller holds the opaque handle', options, t => {
  const f = fixture(t), handle = f.capture()
  f.time(100 + C.ttlMs)
  assert.throws(() => f.resolver.compilationInput(handle, f.exec), error('COMPILATION_EXPIRED'))
  assert.equal(f.resolver.releaseCompilation(handle), false)
  assert.ok(f.capture())
})
test('a real TTL timer releases a held input even when the test clock is frozen', options, async t => {
  const f = fixture(t, { compilationTtlMs: 20 }), handle = f.capture()
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(f.resolver.releaseCompilation(handle), false)
  assert.throws(() => f.resolver.compilationInput(handle, f.exec), error('COMPILATION_EXPIRED'))
})
for (const ttl of [0, -1, C.ttlMs + 1, Infinity]) {
  test(`invalid TTL ${ttl} cannot weaken the five-minute bound`, options, t => {
    const f = fixture(t, { compilationTtlMs: ttl })
    assert.throws(() => f.capture(), error('COMPILATION_UNAVAILABLE'))
  })
}
test('backward clock closes live entries instead of extending their validity', options, t => {
  const f = fixture(t), handle = f.capture()
  f.time(99)
  assert.throws(() => f.resolver.compilationInput(handle, f.exec), error('COMPILATION_EXPIRED'))
  assert.equal(f.resolver.releaseCompilation(handle), false)
})
