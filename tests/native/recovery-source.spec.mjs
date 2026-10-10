import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CHECKOUT } from './takeover-harness.mjs'
import { deliverCreatorRecovery } from '../../src/runner.js'
const { assertV4MessageSources } = await import(pathToFileURL(resolve(CHECKOUT, 'packages/session/session-format-v3-to-v4/src/message-sources.ts')).href)
test('Creator recovery is admitted by native V4 persistence', async () => {
 const messages=[]
 await deliverCreatorRecovery({id:'creator-source-test',steer(message){messages.push(message)}}, {hostPort:43127,runDshx: async args => ({exitCode:0,stdout:JSON.stringify({data:{incidents:args[1]==='recovery' && args[2]==='pull' ? [{id:'test-incident',pluginId:'smoke',reason:'test'}] : []}})})})
 assert.equal(messages.length,1)
 const event={type:'agent/inbox/spliced',seq:0,time:1,data:{inserted:messages}}
 assert.doesNotThrow(() => assertV4MessageSources(event))
 assert.throws(() => assertV4MessageSources({...event,data:{inserted:[{...messages[0],source:{kind:'plugin',plugin:'dsh-creator-mode-plus'}}]}}), /producer-owned/)
})
