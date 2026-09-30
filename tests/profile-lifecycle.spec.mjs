import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CREATOR_LIFECYCLE_ONLY,
  creatorProfileMutationReason,
  profileHomeRoots,
  profileWriteReason,
} from '../src/profile-lifecycle.js'
import { canonicalTarget } from '../src/core-boundary.js'

const temp = canonicalTarget(mkdtempSync(join(tmpdir(), 'creator-profile-lifecycle-')))
process.on('exit', () => rmSync(temp, { recursive: true, force: true }))

const dshHome = join(temp, 'dsh-home')
mkdirSync(join(dshHome, 'profiles', 'web'), { recursive: true })
mkdirSync(join(dshHome, 'profiles', 'desktop'), { recursive: true })
writeFileSync(join(dshHome, 'profiles', 'web', 'cordis.patch.yml'), '- insert: []\n')
writeFileSync(join(dshHome, 'cordis.patch.yml'), '- insert: []\n')
const workspace = join(temp, 'workspace')
mkdirSync(join(workspace, 'my-plugins', 'demo', 'src'), { recursive: true })

const roots = [dshHome]
const exec = (name, args, cwd = workspace) => ({ name, arguments: args, agent: { session: { header: { cwd } } } })
const denied = reason => assert.match(reason ?? '', new RegExp(CREATOR_LIFECYCLE_ONLY))

describe('profile lifecycle write boundary', () => {
  it('denies file-tool writes to watched patch files in every profile', () => {
    for (const tool of ['write', 'edit', 'write_file', 'edit_file', 'delete_file', 'move_file', 'copy_file']) {
      denied(creatorProfileMutationReason(exec(tool, { file_path: join(dshHome, 'profiles', 'web', 'cordis.patch.yml') }), roots))
      denied(creatorProfileMutationReason(exec(tool, { file_path: join(dshHome, 'profiles', 'desktop', 'cordis.patch.yml') }), roots))
    }
  })

  it('denies writes anywhere under the profiles tree — including new files the watcher would pick up', () => {
    denied(creatorProfileMutationReason(exec('write', { file_path: join(dshHome, 'profiles', 'web', 'cordis.patch.d', 'sneaky.yml') }), roots))
    denied(creatorProfileMutationReason(exec('write', { path: join(dshHome, 'profiles', 'desktop', 'agent.cordis.yml') }), roots))
    denied(creatorProfileMutationReason(exec('write', { destination: join(dshHome, 'profiles', 'web', 'my-plugin', 'index.js') }), roots))
  })

  it('denies watched config names anywhere under the DSH home root', () => {
    denied(creatorProfileMutationReason(exec('edit', { file_path: join(dshHome, 'cordis.patch.yml') }), roots))
    denied(creatorProfileMutationReason(exec('write', { file_path: join(dshHome, '.agent-presets') }), roots))
    denied(creatorProfileMutationReason(exec('write', { file_path: join(dshHome, 'x', 'agent.cordis.yml') }), roots))
  })

  it('denies apply_patch edits to watched files', () => {
    const patch = `*** Begin Patch\n*** Update File: ${join(dshHome, 'profiles', 'web', 'cordis.patch.yml')}\n@@\n-x\n+y\n*** End Patch\n`
    denied(creatorProfileMutationReason(exec('apply_patch', { input: patch }), roots))
  })

  it('denies shell writes and copies into the profile surface', () => {
    const file = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
    denied(creatorProfileMutationReason(exec('bash', { command: `echo "- insert: []" > "${file}"` }), roots))
    denied(creatorProfileMutationReason(exec('bash', { command: `sed -i 's/x/y/' "${file}"` }), roots))
    denied(creatorProfileMutationReason(exec('bash', { command: `cp /tmp/x.yml "${join(dshHome, 'profiles', 'web')}/"` }), roots))
    denied(creatorProfileMutationReason(exec('bash', { command: `mv /tmp/x "${join(dshHome, 'profiles', 'web', 'x')}"` }), roots))
    denied(creatorProfileMutationReason(exec('bash', { command: `printf x | tee "${file}"` }), roots))
    denied(creatorProfileMutationReason(exec('terminal_send', { text: `echo x >> "${file}"` }), roots))
  })

  it('denies shell writes via a bare watched filename in a profile cwd', () => {
    const cwd = join(dshHome, 'profiles', 'web')
    denied(creatorProfileMutationReason(exec('bash', { command: `sed -i 's/x/y/' cordis.patch.yml` }, cwd), roots))
  })

  it('denies symlinked home writes through canonical resolution', () => {
    // A target spelled with .. that still lands inside profiles is caught.
    denied(creatorProfileMutationReason(
      exec('edit', { file_path: join(dshHome, 'profiles', '..', 'profiles', 'web', 'cordis.patch.yml') }), roots))
  })

  it('keeps legitimate writes available', () => {
    assert.equal(creatorProfileMutationReason(exec('write', { file_path: join(workspace, 'my-plugins', 'demo', 'src', 'index.ts') }), roots), undefined)
    assert.equal(creatorProfileMutationReason(exec('edit', { file_path: join(workspace, 'my-plugins', 'demo', 'src', 'index.ts') }), roots), undefined)
    assert.equal(creatorProfileMutationReason(exec('write', { file_path: join(dshHome, 'sessions', 'session-x', 'notes.md') }), roots), undefined)
    assert.equal(creatorProfileMutationReason(exec('write', { file_path: join(dshHome, 'scratch', 'notes.yml') }), roots), undefined)
    assert.equal(creatorProfileMutationReason(exec('bash', { command: `echo hi > "${join(workspace, 'out.txt')}"` }), roots), undefined)
    assert.equal(creatorProfileMutationReason(exec('bash', { command: `npm run build` }, workspace), roots), undefined)
    assert.equal(creatorProfileMutationReason(exec('read', { file_path: join(dshHome, 'profiles', 'web', 'cordis.patch.yml') }), roots), undefined)
    assert.equal(creatorProfileMutationReason(exec('dshx_activate_new_client', { name: 'demo' }), roots), undefined)
  })

  it('keeps read-only shell inspection of the profile surface available', () => {
    const file = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
    assert.equal(creatorProfileMutationReason(exec('bash', { command: `cat "${file}"` }), roots), undefined)
    assert.equal(creatorProfileMutationReason(exec('bash', { command: `ls -la "${join(dshHome, 'profiles')}"` }), roots), undefined)
    assert.equal(creatorProfileMutationReason(exec('bash', { command: `rg insert "${file}"` }), roots), undefined)
  })

  it('resolves protected roots from DSH_HOME and the default home', () => {
    const fromEnv = profileHomeRoots({ DSH_HOME: join(temp, 'isolated-home') }, join(temp, 'user'))
    assert.deepEqual(fromEnv, [canonicalTarget(join(temp, 'isolated-home')), canonicalTarget(join(temp, 'user', '.dsh'))])
  })

  it('profileWriteReason is path-pure', () => {
    denied(profileWriteReason(join(dshHome, 'profiles', 'web', 'cordis.patch.yml'), roots))
    assert.equal(profileWriteReason(join(workspace, 'src', 'index.ts'), roots), undefined)
  })
})
