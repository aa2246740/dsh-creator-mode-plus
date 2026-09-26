import assert from 'node:assert/strict'
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync,
  rmSync, symlinkSync, truncateSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { stringify } from 'yaml'
import {
  createDevelopmentTargetResolver,
  DEVELOPMENT_TARGET_ENGINE,
  DEVELOPMENT_TARGET_LIMITS as LIMITS,
  DevelopmentTargetError,
} from '../src/development-target.js'

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const failure = code => error => error instanceof DevelopmentTargetError && error.eligible === false && error.code === code

function writePackage(sourceRoot, id, overrides = {}) {
  mkdirSync(join(sourceRoot, 'src'), { recursive: true })
  writeFileSync(join(sourceRoot, 'package.json'), JSON.stringify({ name: id, version: '1.0.0', main: './src/index.js', ...overrides }))
  writeFileSync(join(sourceRoot, 'src/index.js'), 'export const main = 1\n')
  writeFileSync(join(sourceRoot, 'src/helper.js'), 'export const helper = 1\n')
  writeManifest(sourceRoot, id)
}
function writeManifest(sourceRoot, id, overrides = {}) {
  writeFileSync(join(sourceRoot, 'dshx.yml'), stringify({
    id, entry: 'src/index.js', profile: 'web',
    hotReload: { artifacts: ['src/index.js', 'src/helper.js'] }, ...overrides,
  }))
}
function fixture(t, { id = 'demo-widget', internal = false } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'creator-development-target-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const harnessRoot = join(temp, 'runtime')
  const workspace = join(temp, 'workspace')
  const sourceRoot = internal ? join(harnessRoot, 'my-plugins', id) : join(temp, 'sources', id)
  mkdirSync(join(harnessRoot, 'my-plugins'), { recursive: true })
  mkdirSync(workspace, { recursive: true })
  writePackage(sourceRoot, id)
  const alias = join(harnessRoot, 'my-plugins', id)
  if (!internal) symlinkSync(sourceRoot, alias, 'dir')
  let hostRoot = harnessRoot
  const exec = { token: Symbol('fixture-execution'), agent: { session: { header: { cwd: workspace } } } }
  const resolver = createDevelopmentTargetResolver({ getHarnessRoot: () => hostRoot })
  return {
    temp, harnessRoot, workspace, sourceRoot, alias, exec, id, resolver,
    hostRoot(value) { hostRoot = value },
    capture() { return resolver.capture(exec, id) },
  }
}

for (const internal of [false, true]) {
  test(`captures a strict canonical binding and bounded hashes (${internal ? 'real directory' : 'external my-plugins link'})`, t => {
    const f = fixture(t, { internal })
    const snapshot = f.capture()
    assert.equal(snapshot.eligible, true)
    assert.equal(snapshot.binding.engine, DEVELOPMENT_TARGET_ENGINE)
    assert.equal(DEVELOPMENT_TARGET_ENGINE, 'creator-plus-v1')
    assert.deepEqual(Object.keys(snapshot.binding), ['engine', 'harnessRoot', 'workspaceRoot', 'sourceRoot', 'pluginId', 'sourceDirectoryIdentity'])
    assert.equal(snapshot.binding.pluginId, f.id)
    assert.equal(snapshot.binding.harnessRoot, realpathSync(f.harnessRoot))
    assert.equal(snapshot.binding.workspaceRoot, realpathSync(f.workspace))
    assert.equal(snapshot.binding.sourceRoot, realpathSync(f.sourceRoot))
    const stat = lstatSync(snapshot.binding.sourceRoot, { bigint: true })
    assert.deepEqual(snapshot.binding.sourceDirectoryIdentity, { dev: stat.dev.toString(), ino: stat.ino.toString() })
    for (const value of Object.values(snapshot.binding.sourceDirectoryIdentity)) assert.match(value, /^(?:0|[1-9][0-9]*)$/)
    assert.deepEqual(snapshot.files.map(file => file.path), ['package.json', 'dshx.yml', 'src/helper.js', 'src/index.js'])
    for (const file of snapshot.files) {
      assert.equal(file.sha256, digest(join(f.sourceRoot, file.path)))
      assert.equal(file.bytes, readFileSync(join(f.sourceRoot, file.path)).length)
      assert.equal(Object.hasOwn(file, 'content'), false)
    }
    assert.equal(snapshot.evidenceBoundary, 'parent-observation-only')
    assert.equal(JSON.stringify(snapshot.binding).includes('sha256'), false, 'remembered identity excludes per-operation hashes')
    assert.ok(Object.isFrozen(snapshot.binding.sourceDirectoryIdentity))
    assert.ok(Object.isFrozen(snapshot.files[0]))
    assert.throws(() => { snapshot.binding.pluginId = 'forged' }, TypeError)
    assert.equal(f.resolver.revalidate(snapshot, f.exec), snapshot)
  })
}

test('uses only the Host callback and actual Agent header cwd, not model-shaped alternatives', t => {
  const f = fixture(t)
  assert.throws(() => createDevelopmentTargetResolver(), TypeError)
  const snapshot = f.resolver.capture({ ...f.exec, cwd: '/', arguments: { cwd: '/', harnessRoot: '/' } }, f.id)
  assert.equal(snapshot.binding.workspaceRoot.endsWith('/workspace'), true)
  assert.throws(() => f.resolver.capture({ cwd: f.workspace }, f.id), failure('MISSING_AGENT'))
  assert.throws(() => f.resolver.capture({ agent: { session: { header: {} } }, arguments: { cwd: f.workspace } }, f.id), failure('INVALID_PATH'))
})

test('revalidation rejects model-shaped, cloned, foreign-resolver and other-Agent snapshots', t => {
  const f = fixture(t)
  const snapshot = f.capture()
  assert.throws(() => f.resolver.revalidate(JSON.parse(JSON.stringify(snapshot)), f.exec), failure('UNISSUED_SNAPSHOT'))
  const other = createDevelopmentTargetResolver({ getHarnessRoot: () => f.harnessRoot })
  assert.throws(() => other.revalidate(snapshot, f.exec), failure('UNISSUED_SNAPSHOT'))
  assert.throws(() => f.resolver.revalidate(snapshot, { agent: { session: f.exec.agent.session } }), failure('AGENT_MISMATCH'))
})

test('bounds and validates the plugin selector before filesystem lookup', t => {
  const f = fixture(t)
  for (const id of ['../demo-widget', '/demo', 'Demo', 'a--b', 'a-', 'a'.repeat(129), 'demo\0widget']) {
    assert.throws(() => f.resolver.capture(f.exec, id), failure('INVALID_PLUGIN_ID'))
  }
})

for (const id of ['dsh-creator-mode-plus', 'dsh-approve-for-me', 'dsh-auto-review', 'dsh-external-plugin-devkit', 'dsh-user-approval', 'dsh-guardian-copy']) {
  test(`control target ${id} is not eligible`, t => {
    const f = fixture(t, { id })
    assert.throws(() => f.capture(), failure('PROTECTED_TARGET'))
  })
}

for (const directory of ['apps', 'packages', 'vendor', 'tools', 'native', 'scripts', 'node_modules']) {
  test(`a my-plugins alias cannot authorize Harness ${directory} sources`, t => {
    const f = fixture(t)
    const coreTarget = join(f.harnessRoot, directory, 'renamed-plugin')
    writePackage(coreTarget, f.id)
    rmSync(f.alias)
    symlinkSync(coreTarget, f.alias, 'dir')
    assert.throws(() => f.capture(), failure('PROTECTED_TARGET'))
  })
}

test('renaming control metadata does not make a control source directory eligible', t => {
  const f = fixture(t)
  const protectedSource = join(f.temp, 'dsh-creator-bridge', 'renamed-plugin')
  writePackage(protectedSource, f.id)
  rmSync(f.alias)
  symlinkSync(protectedSource, f.alias, 'dir')
  assert.throws(() => f.capture(), failure('PROTECTED_TARGET'))
})

test('a root/id shadow is rejected both at capture and after a pending snapshot', t => {
  const f = fixture(t)
  const snapshot = f.capture()
  writePackage(join(f.harnessRoot, f.id), f.id)
  assert.throws(() => f.capture(), failure('AMBIGUOUS_PLUGIN_ROOT'))
  assert.throws(() => f.resolver.revalidate(snapshot, f.exec), failure('TARGET_CHANGED'))
})

test('the my-plugins parent itself must not be a symlink', t => {
  const f = fixture(t)
  const directory = join(f.harnessRoot, 'my-plugins')
  const moved = join(f.temp, 'plugin-registry')
  renameSync(directory, moved)
  symlinkSync(moved, directory, 'dir')
  assert.throws(() => f.capture(), failure('INVALID_PLUGIN_ROOT'))
})

for (const file of ['package.json', 'dshx.yml', 'src/index.js', 'src/helper.js']) {
  test(`does not accept a symlink metadata/artifact leaf: ${file}`, t => {
    const f = fixture(t)
    const original = join(f.sourceRoot, file)
    const outside = join(f.temp, file.replaceAll('/', '-'))
    renameSync(original, outside)
    symlinkSync(outside, original, 'file')
    assert.throws(() => f.capture(), failure('SYMLINK_FORBIDDEN'))
  })
}

test('does not accept an intermediate artifact symlink', t => {
  const f = fixture(t)
  const outside = join(f.temp, 'outside-src')
  renameSync(join(f.sourceRoot, 'src'), outside)
  symlinkSync(outside, join(f.sourceRoot, 'src'), 'dir')
  assert.throws(() => f.capture(), failure('SYMLINK_FORBIDDEN'))
})

test('requires exact explicit package name, dshx id, entry and web profile', t => {
  const f = fixture(t)
  writePackage(f.sourceRoot, f.id, { name: 'another-plugin' })
  assert.throws(() => f.capture(), failure('IDENTITY_MISMATCH'))
  writePackage(f.sourceRoot, f.id)
  for (const override of [{ id: 'another-plugin' }, { profile: 'cli' }, { profile: undefined }]) {
    writeManifest(f.sourceRoot, f.id, override)
    assert.throws(() => f.capture(), failure('IDENTITY_MISMATCH'))
  }
  writeManifest(f.sourceRoot, f.id, { entry: undefined })
  assert.throws(() => f.capture(), failure('INVALID_ARTIFACT_PATH'))
  rmSync(join(f.sourceRoot, 'dshx.yml'))
  assert.throws(() => f.capture(), failure('TARGET_UNAVAILABLE'))
})

test('supports the declared-entry-only default, without inferring undeclared code', t => {
  const f = fixture(t)
  writeManifest(f.sourceRoot, f.id, { hotReload: undefined })
  assert.deepEqual(f.capture().files.map(file => file.path), ['package.json', 'dshx.yml', 'src/index.js'])
})

test('rejects ambiguous YAML, aliases and executable/custom tags', t => {
  const f = fixture(t)
  const initial = readFileSync(join(f.sourceRoot, 'dshx.yml'), 'utf8')
  for (const yaml of [
    `${initial}\nid: ${f.id}\n`,
    `${initial}\nconfig: &reused { x: 1 }\nother: *reused\n`,
    `${initial}\nconfig: !!js process.exit()\n`,
    `${initial}\n---\nid: ${f.id}\n`,
  ]) {
    writeFileSync(join(f.sourceRoot, 'dshx.yml'), yaml)
    assert.throws(() => f.capture(), failure('INVALID_MANIFEST'))
  }
})

test('bounds YAML nesting before materializing its JS object', t => {
  const f = fixture(t)
  let config = 'leaf'
  for (let i = 0; i <= LIMITS.yamlDepth; i += 1) config = { nested: config }
  writeManifest(f.sourceRoot, f.id, { config })
  assert.throws(() => f.capture(), failure('MANIFEST_LIMIT'))
})

test('rejects traversal/glob/dependency/declaration artifact paths and non-files', t => {
  const f = fixture(t)
  for (const path of ['../outside.js', '/tmp/outside.js', 'C:/outside.js', 'src\\index.js', 'src/../index.js', 'src//index.js', 'src/*.js', 'src/index.d.ts', 'node_modules/a.js', 'src/./index.js', '', `${'a/'.repeat(65)}index.js`]) {
    writeManifest(f.sourceRoot, f.id, { hotReload: { artifacts: ['src/index.js', path] } })
    assert.throws(() => f.capture(), failure('INVALID_ARTIFACT_PATH'))
  }
  writeManifest(f.sourceRoot, f.id, { hotReload: { artifacts: ['src/index.js', 'src/folder.js'] } })
  mkdirSync(join(f.sourceRoot, 'src/folder.js'))
  assert.throws(() => f.capture(), failure('NOT_REGULAR_FILE'))
})

test('bounds artifact count and requires uniqueness and entry membership', t => {
  const f = fixture(t)
  for (const artifacts of [[], Array.from({ length: 33 }, (_, index) => `src/${index}.js`)]) {
    writeManifest(f.sourceRoot, f.id, { hotReload: { artifacts } })
    assert.throws(() => f.capture(), failure('ARTIFACT_LIMIT'))
  }
  for (const artifacts of [['src/helper.js'], ['src/index.js', 'src/index.js']]) {
    writeManifest(f.sourceRoot, f.id, { hotReload: { artifacts } })
    assert.throws(() => f.capture(), failure('INVALID_MANIFEST'))
  }
  writeManifest(f.sourceRoot, f.id, { hotReload: { artifacts: ['src/index.js'], unknown: true } })
  assert.throws(() => f.capture(), failure('INVALID_MANIFEST'))
})

test('bounds metadata and individual artifact reads before reading oversized sparse files', t => {
  const f = fixture(t)
  truncateSync(join(f.sourceRoot, 'package.json'), LIMITS.metadataBytes + 1)
  assert.throws(() => f.capture(), failure('BYTE_LIMIT'))
  writePackage(f.sourceRoot, f.id)
  truncateSync(join(f.sourceRoot, 'src/index.js'), LIMITS.artifactBytes + 1)
  assert.throws(() => f.capture(), failure('BYTE_LIMIT'))
})

test('bounds total snapshot bytes independently of the per-artifact limit', t => {
  const f = fixture(t)
  const artifacts = ['src/index.js']
  for (let i = 0; i < 4; i += 1) {
    const path = `src/large-${i}.js`
    artifacts.push(path)
    writeFileSync(join(f.sourceRoot, path), '')
    truncateSync(join(f.sourceRoot, path), LIMITS.artifactBytes)
  }
  writeManifest(f.sourceRoot, f.id, { hotReload: { artifacts } })
  assert.throws(() => f.capture(), failure('BYTE_LIMIT'))
})

test('bounds absolute paths and symlink chains/loops', t => {
  const f = fixture(t)
  const excessiveRoot = createDevelopmentTargetResolver({ getHarnessRoot: () => `/${'x'.repeat(LIMITS.pathBytes)}` })
  assert.throws(() => excessiveRoot.capture(f.exec, f.id), failure('INVALID_PATH'))
  rmSync(f.alias)
  for (let i = 0; i <= LIMITS.symlinks; i += 1) {
    symlinkSync(i === LIMITS.symlinks ? f.sourceRoot : join(f.temp, `link-${i + 1}`), join(f.temp, `link-${i}`), 'dir')
  }
  symlinkSync(join(f.temp, 'link-0'), f.alias, 'dir')
  assert.throws(() => f.capture(), failure('LINK_LIMIT'))
  rmSync(f.alias)
  symlinkSync(join(f.temp, 'loop'), f.alias, 'dir')
  symlinkSync(f.alias, join(f.temp, 'loop'), 'dir')
  assert.throws(() => f.capture(), failure('LINK_LIMIT'))
})

test('accepts leading relative links but rejects ambiguous named-link/../ targets', t => {
  const f = fixture(t)
  rmSync(f.alias)
  symlinkSync(`../../sources/${f.id}`, f.alias, 'dir')
  assert.equal(f.capture().binding.sourceRoot, realpathSync(f.alias))
  const route = join(f.temp, 'route')
  const destination = join(f.temp, 'destination')
  mkdirSync(route)
  mkdirSync(join(destination, 'deep'), { recursive: true })
  writePackage(join(destination, 'actual'), f.id)
  symlinkSync(join(destination, 'deep'), join(route, 'linked'), 'dir')
  rmSync(f.alias)
  symlinkSync(`${route}/linked/../actual`, f.alias, 'dir')
  assert.equal(realpathSync.native(f.alias), realpathSync.native(join(destination, 'actual')))
  assert.throws(() => f.capture(), failure('AMBIGUOUS_LINK_PATH'))
})

test('directory identity, not case-sensitive spelling, protects core on case-insensitive filesystems', t => {
  const f = fixture(t)
  const core = join(f.harnessRoot, 'packages', 'renamed-plugin')
  writePackage(core, f.id)
  const differentCase = join(f.temp, 'RUNTIME', 'packages', 'renamed-plugin')
  if (!existsSync(differentCase)) { t.skip('fixture filesystem is case-sensitive'); return }
  assert.equal(lstatSync(differentCase, { bigint: true }).ino, lstatSync(core, { bigint: true }).ino)
  rmSync(f.alias)
  symlinkSync(differentCase, f.alias, 'dir')
  assert.throws(() => f.capture(), failure('PROTECTED_TARGET'))
})

test('an unlisted new checkout directory is still core, not an eligible external package', t => {
  const f = fixture(t)
  const core = join(f.harnessRoot, 'new-core-component', 'renamed-plugin')
  writePackage(core, f.id)
  rmSync(f.alias)
  symlinkSync(core, f.alias, 'dir')
  assert.throws(() => f.capture(), failure('PROTECTED_TARGET'))
})

test('revalidation detects alias retargeting and alias replacement even to identical content', t => {
  const f = fixture(t)
  const snapshot = f.capture()
  const elsewhere = join(f.temp, 'another-source')
  cpSync(f.sourceRoot, elsewhere, { recursive: true })
  renameSync(f.alias, `${f.alias}-retired`)
  symlinkSync(elsewhere, f.alias, 'dir')
  assert.throws(() => f.resolver.revalidate(snapshot, f.exec), failure('TARGET_CHANGED'))
  const current = f.capture()
  assert.notEqual(current.binding.sourceRoot, snapshot.binding.sourceRoot)
  renameSync(f.alias, `${f.alias}-second-retired`)
  symlinkSync(elsewhere, f.alias, 'dir')
  assert.throws(() => f.resolver.revalidate(current, f.exec), failure('TARGET_CHANGED'))
})

test('a same-path replacement source directory changes the canonical dev/ino binding', t => {
  const f = fixture(t)
  const snapshot = f.capture()
  const retired = `${f.sourceRoot}-retired`
  renameSync(f.sourceRoot, retired)
  cpSync(retired, f.sourceRoot, { recursive: true })
  assert.throws(() => f.resolver.revalidate(snapshot, f.exec), failure('TARGET_CHANGED'))
  const current = f.capture()
  assert.equal(current.binding.sourceRoot, snapshot.binding.sourceRoot)
  assert.notDeepEqual(current.binding.sourceDirectoryIdentity, snapshot.binding.sourceDirectoryIdentity)
})

for (const file of ['package.json', 'dshx.yml', 'src/index.js', 'src/helper.js']) {
  test(`changed ${file} invalidates a pending snapshot, while a fresh version keeps the same binding`, t => {
    const f = fixture(t)
    const snapshot = f.capture()
    const path = join(f.sourceRoot, file)
    if (file === 'package.json') writeFileSync(path, JSON.stringify({ name: f.id, version: '2.0.0', main: './src/index.js' }))
    else if (file === 'dshx.yml') writeManifest(f.sourceRoot, f.id, { marker: '[new version]' })
    else writeFileSync(path, 'export const changed = 2\n')
    assert.throws(() => f.resolver.revalidate(snapshot, f.exec), failure('TARGET_CHANGED'))
    const current = f.capture()
    assert.deepEqual(current.binding, snapshot.binding, 'content digests are not remembered target identity')
    assert.notEqual(current.files.find(item => item.path === file).sha256, snapshot.files.find(item => item.path === file).sha256)
    assert.equal(f.resolver.revalidate(current, f.exec), current)
  })
}

test('new declared artifacts and post-capture symlink insertion are revalidated', t => {
  const f = fixture(t)
  const snapshot = f.capture()
  writeFileSync(join(f.sourceRoot, 'src/third.js'), 'export const third = 3\n')
  writeManifest(f.sourceRoot, f.id, { hotReload: { artifacts: ['src/index.js', 'src/helper.js', 'src/third.js'] } })
  assert.throws(() => f.resolver.revalidate(snapshot, f.exec), failure('TARGET_CHANGED'))
  const current = f.capture()
  const path = join(f.sourceRoot, 'src/third.js')
  renameSync(path, join(f.temp, 'third.js'))
  symlinkSync(join(f.temp, 'third.js'), path, 'file')
  assert.throws(() => f.resolver.revalidate(current, f.exec), failure('TARGET_CHANGED'))
})

test('revalidation also checks the current Host root and actual Agent cwd', t => {
  const f = fixture(t)
  const snapshot = f.capture()
  const otherWorkspace = join(f.temp, 'workspace-two')
  mkdirSync(otherWorkspace)
  f.exec.agent.session.header.cwd = otherWorkspace
  assert.throws(() => f.resolver.revalidate(snapshot, f.exec), failure('TARGET_CHANGED'))
  f.exec.agent.session.header.cwd = f.workspace
  f.hostRoot(join(f.temp, 'missing-harness'))
  assert.throws(() => f.resolver.revalidate(snapshot, f.exec), failure('TARGET_CHANGED'))
})

test('the second observation catches source edits between locate/hash passes', t => {
  const f = fixture(t)
  let visits = 0
  const resolver = createDevelopmentTargetResolver({ getHarnessRoot() {
    visits += 1
    if (visits === 2) writeFileSync(join(f.sourceRoot, 'src/helper.js'), 'export const raced = true\n')
    return f.harnessRoot
  } })
  assert.throws(() => resolver.capture(f.exec, f.id), failure('TARGET_CHANGED'))
})

test('a successful parent revalidate does NOT pin the bytes a later child reads', t => {
  const f = fixture(t)
  const snapshot = f.capture()
  f.resolver.revalidate(snapshot, f.exec)
  // This deliberately happens AFTER validation. No child receipt, native file
  // lock, expected-digest argument, or prevention capability is being invented.
  writeFileSync(join(f.sourceRoot, 'src/index.js'), 'export const laterChildReadsDifferentBytes = true\n')
  assert.notEqual(digest(join(f.sourceRoot, 'src/index.js')), snapshot.files.find(file => file.path === 'src/index.js').sha256)
  assert.equal(snapshot.evidenceBoundary, 'parent-observation-only')
  assert.throws(() => f.resolver.revalidate(snapshot, f.exec), failure('TARGET_CHANGED'))
})
