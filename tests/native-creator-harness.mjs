import * as desktopProfile from '../src/desktop-profile.js'
/** Actual current C apply/execute closures in actual current Cordis/native core.
 * Main-realm closed linker; only runner, profile heal, browser and LLM transport
 * are inert. No production apply, DSHX, browser request or profile writes. */
import assert from 'node:assert/strict'
import { after } from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import * as compatibility from '../src/compatibility.js'
import * as safety from '../src/safety.js'
import * as execution from '../src/development-execution.js'
import * as tasks from '../src/development-tasks.js'
import * as policy from '../src/development-policy.js'
import * as invocation from '../src/development-invocation.js'
import { resolveSourceCheckout } from './source-checkout.mjs'
export const CHECKOUT = resolveSourceCheckout()
const url = path => pathToFileURL(resolve(CHECKOUT, path)).href
const { register } = await import(url('node_modules/tsx/dist/esm/api/index.mjs'))
const unregister = register({ tsconfig: resolve(CHECKOUT, 'tsconfig.json') })
after(async () => { await unregister() })
export const { Context, Service } = await import(url('vendor/cordis/src/index.ts'))
export const { default: Sessions, SessionId } = await import(url('packages/core/session/src/index.ts'))
export const { default: Agents } = await import(url('packages/core/agent/src/index.ts'))
export const { default: AgentLoop } = await import(url('packages/core/agent-loop/src/index.ts'))
const { default: Projections } = await import(url('packages/session/session-projection/src/index.ts'))
const { default: SystemPrompt } = await import(url('packages/core/system-prompt/src/index.ts'))
export const { default: Tools } = await import(url('packages/core/tools/src/index.ts'))
const { default: Questions } = await import(url('packages/interaction/user-questions/src/index.ts'))
export const { default: Approval } = await import(url('packages/interaction/user-approval/src/index.ts'))
export const { default: SandboxPolicy } = await import(url('packages/sandbox/sandbox-policy/src/index.ts'))
export const { default: Permissions } = await import(url('packages/interaction/permission-presets/src/index.ts'))
const { default: Shell } = await import(url('packages/shell/shell/src/index.ts'))
const { default: Llm, createUserMessage } = await import(url('packages/llm/llm/src/index.ts'))
export const { MockAdapter, textResponse, toolCallResponse } = await import(url('packages/core/agent-loop/tests/mock-adapter.ts'))
export const TimeoutPolicy = await import(url('packages/guard/timeout-policy/src/index.ts'))
const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
export const call = (name = 'dshx_check', args = { name: 'demo' }, id = 'call') => toolCallResponse(id, name, args)
export const done = () => textResponse('done')
class InertShell extends Shell {
  static inject = ['sandboxPolicy']
  get sandboxMode() { return this.ctx.sandboxPolicy.defaultMode }
  resolve() { throw new Error('shell runner disabled in source wiring fixture') }
  run() { throw new Error('shell runner disabled in source wiring fixture') }
  start() { throw new Error('shell runner disabled in source wiring fixture') }
}
export async function nativeCreatorHarness(t, { script = [call(), done()], harnessRoot, extraPresets = {}, runLegacy, beforeCreator, developmentExecution = true } = {}) {
  const ctx = new Context(), runs = [], errors = [], results = [], observed = [], holds = []
  t.after(async () => {
    for (const hold of holds) hold.resolve()
    for (const agent of ctx.agents.list()) agent.cancel({ kind: 'user' })
    await ctx.fiber.dispose()
  })
  for (const plugin of [Llm, Sessions, Projections, SystemPrompt, Tools, Approval, Agents, Questions]) await ctx.plugin(plugin)
  await ctx.plugin(SandboxPolicy, { mode: 'workspace-write' }); await ctx.plugin(InertShell)
  const permissionConfig = { defaultPreset: 'workspace-write', presets: {
    'read-only': { sandbox: 'read-only', approval: 'ask' }, 'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
    'approve-for-me': { sandbox: 'workspace-write', approval: 'ask' }, 'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' }, ...extraPresets,
  } }
  const permissionFiber = await ctx.plugin(Permissions, permissionConfig)
  await ctx.plugin(TimeoutPolicy)
  // Only browser hosting is inert; the C route lifecycle code still executes.
  ctx.provide('webServer', { port: 43127, register() { return () => {} } })
  ctx.provide('connection', {})
  const run = async (args, exec, opts) => {
    runs.push({ args, exec, opts })
    return runLegacy ? await runLegacy(args, exec, opts) : { exitCode: 0, stdout: 'inert runner', stderr: '' }
  }
  ctx.provide('profileContext', { name: 'web' })
  const allowed = {
    './desktop-profile.js': desktopProfile,
    './runner.js': { currentWebPort: () => 43127, installCreatorRecovery() {},
      runDshx: run, runClaimedDshx: (_name, args, exec, opts) => run(args, exec, opts), runClientFailureDshx: run,
      resolveHarnessRoot: () => { if (!harnessRoot) throw new Error('sealed fixture requires an explicit test Host root'); return harnessRoot } },
    './takeover.js': { installTakeoverFence() {}, requestTakeover() { throw new Error('takeover not in sealed executor fixture') } },
    './preset-015.js': { healCreatorPlusPresets: () => [] }, './safety.js': safety, './compatibility.js': compatibility,
    './development-execution.js': execution, './development-tasks.js': tasks,
    './development-policy.js': policy, './development-invocation.js': invocation,
  }
  const entry = new vm.SourceTextModule(source, { identifier: 'actual-creator-index.mjs' }) // Default main realm, not a fake Map/AbortSignal realm.
  await entry.link(async specifier => {
    const exports = allowed[specifier]
    assert.ok(exports, `Unreviewed C import: ${specifier}`)
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) })
  })
  await entry.evaluate()
  await beforeCreator?.(ctx)
  const creator = await ctx.plugin(entry.namespace, { developmentExecution })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  ctx.on('agent/error', ({ error }) => errors.push(error))
  ctx.on('tools/pre-execute', (exec, next) => { observed.push(exec); return next() })
  ctx.on('tools/result', (exec, result) => results.push({ exec, result }))
  return { ctx, runs, results, observed, errors, creator, permissionFiber, permissionConfig,
    hold() { const hold = Promise.withResolvers(); holds.push(hold); return hold },
    async agent(id = 'native-c') { const { agent } = await ctx.agents.create({ sessionId: SessionId(id), agentOptions: { provider: 'mock', model: 'mock' } }); return agent },
    async run(agent) {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'exercise actual C closure' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      assert.deepEqual(errors, [])
    },
  }
}
