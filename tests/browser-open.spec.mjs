import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'
import { runDshx } from '../src/runner.js'

test('Creator exposes a no-argument browser handoff without a shell, URL or adapter path', () => {
  const tools = []
  apply({tools:{register(tool){tools.push(tool)}},webServer:{port:43127,register(){return()=>{}}},effect(){}})
  const tool = tools.find(tool => tool.name === 'dshx_browser_open')
  assert.ok(tool, 'private browser handoff is ready but no fixed execution entry exists')
  assert.deepEqual(tool.parameters.properties, {})
  assert.deepEqual(tool.parameters.required ?? [], [])
  assert.equal(tool.parameters.additionalProperties, false)
  assert.throws(() => runDshx(['browser','open','--adapter','/tmp/untrusted']), /outside bridge v2/)
  assert.throws(() => runDshx(['browser','bind']), /outside bridge v2/)
})
