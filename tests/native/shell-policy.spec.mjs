/** Real Cordis, Agent, Tools, sandbox provider/executor and Git. No LLM or network. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolveSourceCheckout } from './source-checkout.mjs'
const root = resolveSourceCheckout()
const imp = p => import(pathToFileURL(join(root, p)).href)
const { register } = await imp('node_modules/tsx/dist/esm/api/index.mjs')
const unregister = register({ tsconfig: join(root, 'tsconfig.json') })
after(async () => { await unregister() })
const { Context } = await imp('vendor/cordis/src/index.ts')
const { default: Sessions, SessionId } = await imp('packages/core/session/src/index.ts')
const { default: Agents } = await imp('packages/core/agent/src/index.ts')
const { default: AgentLoop } = await imp('packages/core/agent-loop/src/index.ts')
const { default: Projections } = await imp('packages/session/session-projection/src/index.ts')
const { default: SystemPrompt } = await imp('packages/core/system-prompt/src/index.ts')
const { default: Tools } = await imp('packages/core/tools/src/index.ts')
const { default: Approval } = await imp('packages/interaction/user-approval/src/index.ts')
const { default: Policy, setSandboxMode } = await imp('packages/sandbox/sandbox-policy/src/index.ts')
const { default: Provider } = await imp('packages/sandbox/sandbox-local/src/index.ts')
const { default: Subprocess } = await imp('packages/subprocess/subprocess-local/src/index.ts')
const { default: Bash } = await imp('packages/shell/bash-sandbox/src/index.ts')
const ShellEnv = await imp('packages/shell/shell-env/src/index.ts')
const ToolBash = await imp('packages/shell/tool-bash/src/index.ts')
const { default: Llm } = await imp('packages/llm/llm/src/index.ts')
const safetyPath = process.env.CREATOR_GUARD_TEST_SOURCE ?? fileURLToPath(new URL('../../src/safety.js', import.meta.url))
const { installCreatorSafetyGuard } = await import(pathToFileURL(safetyPath).href)
const options = { timeout: 30_000 }

async function harness(t) {
  const temp = mkdtempSync(join(tmpdir(), 'creator-git-policy-'))
  const workspace = join(temp, 'plugin'), official = join(temp, 'harness')
  mkdirSync(workspace); mkdirSync(join(official, 'packages/core'), { recursive: true })
  writeFileSync(join(official, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root' }))
  const core = join(official, 'packages/core/index.js'); writeFileSync(core, 'official')
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); rmSync(temp, { recursive: true, force: true }) })
  for (const plugin of [Llm,Sessions,Projections,SystemPrompt,Tools,Approval,Agents,Provider,Subprocess,ShellEnv]) await ctx.plugin(plugin)
  let policyFiber = await ctx.plugin(Policy, { mode: 'workspace-write', workspaceRoot: workspace })
  await ctx.plugin(Bash, { cwd: workspace, timeoutMs: 10_000 })
  await ctx.plugin(ToolBash, { enableRunInBackground: false })
  const guardPlugin = { inject: ['tools'], apply(scope) { installCreatorSafetyGuard(scope, () => official) } }
  let guardFiber = await ctx.plugin(guardPlugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  const { agent } = await ctx.agents.create({ sessionId: SessionId('git-policy'), meta: { cwd: workspace }, agentOptions: { provider: 'mock', model: 'mock' } })
  ctx.on('tools/pre-execute', () => ({ kind: 'allow' }))
  let terminalCalls = 0
  ctx.tools.register({ name: 'terminal_send', parameters: { type: 'object', properties: { text: { type: 'string' } } },
    output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: value }] }, execute() { terminalCalls++; return 'executed' } })
  async function run(command, args = {}, owner = agent) {
    return ctx.tools.execute({ name: 'bash', arguments: { command, description: 'Verify plugin Git release workflow', ...args }, agent: owner, signal: new AbortController().signal })
  }
  return { ctx, agent, workspace, official, core, run,
    async removePolicy() { await policyFiber.dispose() },
    async restorePolicy() { policyFiber = await ctx.plugin(Policy, { mode: 'workspace-write', workspaceRoot: workspace }) },
    async replaceGuard() { await guardFiber.dispose(); guardFiber = await ctx.plugin(guardPlugin) },
    async terminal() { return ctx.tools.execute({ name: 'terminal_send', arguments: { text: 'git push origin HEAD:main' }, agent, signal: new AbortController().signal }) },
    terminalCalls: () => terminalCalls,
  }
}
function ok(result) { assert.equal(result.isError, false, JSON.stringify(result)); assert.equal(result.value?.exitCode, 0, JSON.stringify(result)); assert.equal(result.value?.sandbox?.enforcement, 'full', JSON.stringify(result)) }

test('native Agent can commit, tag and push its plugin through the real confined bash tool', options, async t => {
  const h = await harness(t)
  assert.throws(() => h.agent.ctx.sandboxPolicy, /without inject/)
  assert.throws(() => h.agent.ctx.shell, /without inject/)
  for (const command of [
    'git init -b main', 'git config user.name "Creator regression"', 'git config user.email "creator@example.invalid"',
    'git init --bare remote.git', 'git remote add origin ./remote.git',
    'printf plugin > plugin.txt', 'git add plugin.txt', 'git -c commit.gpgsign=false commit -m "plugin release"',
    'git push origin HEAD:main', 'git -c tag.gpgsign=false tag v0.0.1', 'git push origin v0.0.1',
  ]) ok(await h.run(command))
  const git = (...args) => execFileSync('git', args, { cwd: h.workspace, encoding: 'utf8' }).trim()
  assert.equal(git('--git-dir=remote.git', 'rev-parse', 'main'), git('rev-parse', 'HEAD'))
  assert.equal(git('--git-dir=remote.git', 'rev-parse', 'v0.0.1'), git('rev-parse', 'HEAD'))
  await h.replaceGuard()
  ok(await h.run('git push origin HEAD:main')) // Same Agent, new guard generation.
})

test('automatic approval and child agents cannot write official source or select an unconfined shell', options, async t => {
  const h = await harness(t)
  const { agent: child } = await h.agent.ctx.agents.create({ sessionId: SessionId('git-policy-child'), parentAgent: h.agent, meta: { cwd: h.workspace }, agentOptions: { provider: 'mock', model: 'mock' } })
  for (const owner of [h.agent, child]) {
    const denied = await h.run(`printf changed > '${h.core}'`, {}, owner)
    assert.match(JSON.stringify(denied), /CORE_SOURCE_IMMUTABLE/)
    assert.equal(readFileSync(h.core, 'utf8'), 'official')
  }
  assert.match(JSON.stringify(await h.run('printf blocked > escaped.txt', { sandbox_permissions: 'danger-full-access', justification: 'test' })), /CORE_SOURCE_IMMUTABLE/)
  setSandboxMode(h.agent.session, 'read-only')
  const readOnly = await h.run('printf blocked > denied.txt')
  assert.notEqual(readOnly.value?.exitCode, 0, JSON.stringify(readOnly))
  assert.equal(existsSync(join(h.workspace, 'denied.txt')), false)
  setSandboxMode(h.agent.session, 'workspace-write')
  ok(await h.run('printf allowed > allowed.txt'))
})

test('missing policy stays blocked with a wiring diagnostic, then recovers on service replacement', options, async t => {
  const h = await harness(t)
  await h.removePolicy()
  const failed = JSON.stringify(await h.terminal())
  assert.match(failed, /CREATOR_SANDBOX_UNAVAILABLE/)
  assert.match(failed, /sandboxPolicy service is unavailable/)
  assert.doesNotMatch(failed, /CORE_SOURCE_IMMUTABLE/)
  assert.equal(h.terminalCalls(), 0)
  await h.restorePolicy()
  ok(await h.run('printf restored > restored.txt'))
  const recovered = await h.terminal()
  assert.equal(recovered.isError, false, JSON.stringify(recovered))
  assert.equal(h.terminalCalls(), 1)
})
