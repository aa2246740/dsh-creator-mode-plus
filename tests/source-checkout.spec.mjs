import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { CORE_SOURCE_FILES, resolveSourceCheckout, resolveApproverSource } from './source-checkout.mjs'

function fixture(t) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'creator-source-locator-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
function file(path, content = '') { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content) }
function checkout(root, excluded) {
  for (const path of CORE_SOURCE_FILES) if (path !== excluded) file(resolve(root, path))
  file(resolve(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root' }))
  return root
}
function approver(root) {
  for (const path of ['src/coordinator.ts', 'src/dsh-approve-for-me.ts', 'src/approval-context.ts']) file(resolve(root, path))
  file(resolve(root, 'package.json'), JSON.stringify({ name: 'dsh-approve-for-me' }))
  return root
}

test('explicit DSHX_HARNESS selects one validated canonical checkout', t => {
  const root = fixture(t), wanted = checkout(resolve(root, 'wanted'))
  const other = checkout(resolve(root, 'other'))
  assert.equal(resolveSourceCheckout({ env: { DSHX_HARNESS: wanted }, cwd: other, packageRoot: root }), wanted)
})
test('an invalid explicit root never falls back to a valid local source', t => {
  const root = fixture(t), local = checkout(resolve(root, 'runtime'))
  assert.throws(() => resolveSourceCheckout({ env: { DSHX_HARNESS: resolve(root, 'missing') }, cwd: local, packageRoot: root }), /DSHX_HARNESS is not a usable/)
  for (const path of ['', 'relative/path']) assert.throws(() => resolveSourceCheckout({ env: { DSHX_HARNESS: path }, cwd: local }), /absolute source directory/)
})
test('external plugins/project layout resolves its sibling runtime without machine paths', t => {
  const root = fixture(t), expected = checkout(resolve(root, 'runtime'))
  assert.equal(resolveSourceCheckout({ env: {}, cwd: root, packageRoot: resolve(root, 'plugins/creator') }), expected)
})
test('a plugin physically inside checkout/my-plugins resolves that checkout', t => {
  const root = fixture(t), expected = checkout(resolve(root, 'checkout'))
  assert.equal(resolveSourceCheckout({ env: {}, cwd: root, packageRoot: resolve(expected, 'my-plugins/creator') }), expected)
})
test('different valid local candidates are ambiguous, not selected by latest modification time', t => {
  const root = fixture(t), cwd = checkout(resolve(root, 'one'))
  checkout(resolve(root, 'project/runtime'))
  assert.throws(() => resolveSourceCheckout({ env: {}, cwd, packageRoot: resolve(root, 'project/plugins/creator') }), /Ambiguous local source checkouts/)
})
test('aliases of the same canonical checkout do not create false ambiguity', t => {
  const root = fixture(t), expected = checkout(resolve(root, 'runtime'))
  symlinkSync(expected, resolve(root, 'alias'), 'dir')
  assert.equal(resolveSourceCheckout({ env: {}, cwd: resolve(root, 'alias'), packageRoot: resolve(root, 'plugins/creator') }), expected)
})
test('missing real source or missing the selected checkout TSX loader is an error, never skip', t => {
  for (const excluded of ['vendor/cordis/src/index.ts', 'packages/core/tools/src/index.ts', 'node_modules/tsx/dist/esm/api/index.mjs']) {
    const root = fixture(t), candidate = checkout(resolve(root, 'runtime'), excluded)
    assert.throws(() => resolveSourceCheckout({ env: { DSHX_HARNESS: candidate } }), /not a usable source checkout/)
  }
})
test('an unrelated package with matching filenames is rejected', t => {
  const root = checkout(fixture(t))
  file(resolve(root, 'package.json'), JSON.stringify({ name: 'not-dsh' }))
  assert.throws(() => resolveSourceCheckout({ env: { DSHX_HARNESS: root } }), /package name must be/)
})
test('no valid local layout reports a real missing-checkout failure', t => {
  const root = fixture(t)
  assert.throws(() => resolveSourceCheckout({ env: {}, cwd: root, packageRoot: resolve(root, 'plugins/creator') }), /No usable local source checkout/)
})
test('A source resolves read-only from a sibling or a canonical selected-checkout link', t => {
  const root = fixture(t), a = approver(resolve(root, 'plugins/dsh-approve-for-me'))
  const runtime = resolve(root, 'runtime')
  mkdirSync(resolve(runtime, 'my-plugins'), { recursive: true })
  symlinkSync(a, resolve(runtime, 'my-plugins/dsh-approve-for-me'), 'dir')
  assert.equal(resolveApproverSource(runtime, { env: {}, packageRoot: resolve(root, 'plugins/creator') }), a)
})
test('different A copies require explicit source selection; invalid explicit A fails hard', t => {
  const root = fixture(t), a = approver(resolve(root, 'plugins/dsh-approve-for-me'))
  const runtime = resolve(root, 'runtime')
  approver(resolve(runtime, 'my-plugins/dsh-approve-for-me'))
  const opts = { env: {}, packageRoot: resolve(root, 'plugins/creator') }
  assert.throws(() => resolveApproverSource(runtime, opts), /Ambiguous local source checkouts/)
  assert.equal(resolveApproverSource(runtime, { ...opts, env: { DSHX_APPROVER_SOURCE: a } }), a)
  assert.throws(() => resolveApproverSource(runtime, { ...opts, env: { DSHX_APPROVER_SOURCE: resolve(root, 'absent') } }), /not a usable source checkout/)
})
