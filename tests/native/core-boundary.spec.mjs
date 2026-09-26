import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeCreatorHarness } from './takeover-harness.mjs'

test('native monotonic guard denies official-source writes after automatic approval; plugin writes still execute', async t => {
  const root = mkdtempSync(join(tmpdir(), 'creator-core-write-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'packages/core'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root' }))
  const target = join(root, 'packages/core/index.ts')
  writeFileSync(target, 'official')
  const h = await nativeCreatorHarness(t, { harnessRoot: root })
  const agent = await h.agent('core-boundary')
  const { agent: child } = await agent.ctx.agents.create({ sessionId: 'core-child', parentAgent: agent, agentOptions: { provider: 'mock', model: 'mock' } })
  let writes = 0
  h.ctx.tools.register({ name: 'write', parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
    output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: value }] },
    execute(args) { writes++; writeFileSync(args.file_path, 'plugin write'); return 'written' } })
  h.ctx.on('tools/pre-execute', () => ({ kind: 'allow' }))
  for (const owner of [agent, child]) {
    const result = await h.ctx.tools.execute({ name: 'write', arguments: { file_path: target }, agent: owner, signal: new AbortController().signal })
    assert.match(JSON.stringify(result), /CORE_SOURCE_IMMUTABLE/)
  }
  assert.equal(writes, 0)
  assert.equal(readFileSync(target, 'utf8'), 'official')
  mkdirSync(join(root, 'my-plugins/demo'), { recursive: true })
  const output = join(root, 'my-plugins/demo/result.txt')
  const allowed = await h.ctx.tools.execute({ name: 'write', arguments: { file_path: output }, agent, signal: new AbortController().signal })
  assert.equal(allowed.isError, false, JSON.stringify(allowed))
  assert.equal(readFileSync(output, 'utf8'), 'plugin write')
})
