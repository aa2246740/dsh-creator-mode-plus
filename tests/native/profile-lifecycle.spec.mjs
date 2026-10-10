import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeCreatorHarness } from './takeover-harness.mjs'

/** End-to-end: the actual installed guard intercepts real tool executions that
 * try to mutate the watched profile surface, while ordinary plugin writes and
 * the fixed lifecycle tools still execute. */
test('native monotonic guard denies profile writes across file tools and shell; plugin writes and dshx tools still execute', async t => {
  const root = mkdtempSync(join(tmpdir(), 'creator-profile-lifecycle-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dshHome = join(root, 'dsh-home')
  mkdirSync(join(dshHome, 'profiles', 'web'), { recursive: true })
  const patch = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
  writeFileSync(patch, '- insert: []\n')
  const workspace = join(root, 'workspace')
  mkdirSync(join(workspace, 'my-plugins', 'demo'), { recursive: true })

  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  t.after(() => { if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome })

  const harness = mkdtempSync(join(tmpdir(), 'creator-harness-root-'))
  t.after(() => rmSync(harness, { recursive: true, force: true }))
  const h = await nativeCreatorHarness(t, { harnessRoot: harness })
  const agent = await h.agent('profile-lifecycle')

  let writes = 0
  h.ctx.tools.register({ name: 'write', parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
    output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: value }] },
    execute(args) { writes++; writeFileSync(args.file_path, 'mutated'); return 'written' } })
  h.ctx.tools.register({ name: 'edit', parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
    output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: value }] },
    execute(args) { writes++; writeFileSync(args.file_path, 'mutated'); return 'edited' } })
  let shells = 0
  h.ctx.tools.register({ name: 'bash', parameters: { type: 'object', properties: { command: { type: 'string' } } },
    output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: value }] },
    execute(args) { shells++; return `ran: ${args.command}` } })
  h.ctx.on('tools/pre-execute', () => ({ kind: 'allow' }))
  const run = (name, args) => h.ctx.tools.execute({ name, arguments: args, agent, signal: new AbortController().signal })

  for (const tool of ['write', 'edit']) {
    const result = await run(tool, { file_path: patch })
    assert.match(JSON.stringify(result), /CREATOR_LIFECYCLE_ONLY/, `${tool} must deny the watched patch`)
  }
  assert.equal(writes, 0)
  assert.equal(readFileSync(patch, 'utf8'), '- insert: []\n')

  for (const command of [
    `echo "- insert: []" > "${patch}"`,
    `python -c 'open("${patch}", "w").write("x")'`,
    `node -e 'require("fs").writeFileSync("${patch}", "x")'`,
    `sh -c 'echo x > "${patch}"'`,
    `dd if=/tmp/x of="${patch}"`,
    `echo x > "$DSH_HOME/profiles/web/cordis.patch.yml"`,
    `sed -i 's/x/y/' "${patch}"`,
    `cp /tmp/x "${join(dshHome, 'profiles', 'web')}/"`,
  ]) {
    const result = await run('bash', { command })
    assert.match(JSON.stringify(result), /CREATOR_LIFECYCLE_ONLY/, `shell route must deny: ${command}`)
  }
  assert.equal(shells, 0)

  const out = join(workspace, 'my-plugins', 'demo', 'index.js')
  const allowed = await run('write', { file_path: out })
  assert.equal(allowed.isError, false, JSON.stringify(allowed))
  assert.equal(writes, 1)
  assert.equal(readFileSync(out, 'utf8'), 'mutated')

  const shell = await run('bash', { command: `echo hi > "${join(workspace, 'out.txt')}"` })
  assert.equal(shell.isError, false, JSON.stringify(shell))
  assert.equal(shells, 1)

  const read = await run('bash', { command: `cat "${patch}"` })
  assert.equal(read.isError, false, JSON.stringify(read))
  assert.equal(shells, 2)
})
