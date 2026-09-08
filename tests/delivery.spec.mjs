import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordDelivery, readDelivery, deliveryStatus, verifyDeliveryClient } from '../src/delivery.js'

function hotReloadOutput({ pluginId = 'demo', pid = 42, port = 43127 } = {}) {
 const transactionId='11111111-1111-4111-8111-111111111111'
 const hmrEntryId='dshx-hot-reload-hmr-11111111'
 const ready={version:1,transactionId,pluginId,hmrEntryId,expectedPid:pid,pid,samePid:true,phase:'READY',readyAt:'2026-09-06T01:00:00.000Z',targetGenerationIds:['generation-1'],targetGenerationStates:[{generationId:'generation-1',state:'ACTIVE'}],hmrGenerationId:'generation-2'}
 const moduleReloaded={...ready,phase:'MODULE_RELOADED',moduleReloaded:{at:'2026-09-06T01:00:01.000Z',oldGenerationIds:['generation-1'],newGenerationIds:['generation-3'],hmrEventAt:'2026-09-06T01:00:01.000Z',hmrEventMatchedGenerationIds:['generation-1'],samePid:true}}
 const hmrDisposed={...moduleReloaded,phase:'HMR_DISPOSED',hmrDisposed:{at:'2026-09-06T01:00:02.000Z',generationId:'generation-2'}}
 const observerDisposed={...hmrDisposed,phase:'OBSERVER_DISPOSED',observerDisposed:{at:'2026-09-06T01:00:03.000Z'}}
 return JSON.stringify({command:'hot-reload',ok:true,findings:[],data:{evidence:['HOST_MODULE_RELOADED'],hostRestart:false,behaviorVerified:false,result:{pluginId,profile:'web',hostPid:pid,hostPort:port,transactionId,hmrEntryId,hostRestart:false,targetScope:'root',watchRoots:['src/index.js'],journal:{status:'succeeded',automaticRecovery:false,cleanupProved:true},proof:{sameHost:true,hashBefore:'a'.repeat(64),hashAfter:'a'.repeat(64),artifactHashes:[{path:'src/index.js',before:'a'.repeat(64),after:'a'.repeat(64)}],bytesUnchanged:true,mtimeBeforeMs:100,mtimeAfterMs:200,ready,moduleReloaded,hmrDisposed,observerDisposed}}}})
}

test('same-PID hot reload stores bounded module proof but remains behavior-unverified', () => {
 const root=mkdtempSync(join(tmpdir(),'creator-delivery-hmr-'))
 try {
  const plugin=join(root,'plugin'); mkdirSync(plugin); writeFileSync(join(plugin,'index.js'),'export const value=2')
  const plan={data:{change:'server',facts:{packageDir:plugin,hasClient:false,handoff:{port:43127,launcher:'app'}},decision:{hostRestart:'not-decided'}}}
  recordDelivery(root,['activation-plan','demo'],{exitCode:0,stdout:JSON.stringify(plan)},'session-a',42)
  recordDelivery(root,['check','demo'],{exitCode:0},'session-a',42)
  recordDelivery(root,['hot-reload','demo','--profile','web','--port','43127','--json'],{exitCode:0,stdout:hotReloadOutput()},'session-a',42)

  const row=readDelivery(root,'session-a')
  assert.equal(row.hotReload.samePid,true)
  assert.equal(row.hotReload.cleanupProved,true)
  assert.equal(row.hotReload.behavior,'UNVERIFIED')
  assert.deepEqual(row.hotReload.targetGenerationStates,[{generationId:'generation-1',state:'ACTIVE'}])
  const status=deliveryStatus(row,{pid:42,port:43127})
  assert.equal(status.state,'RUNTIME_VERIFICATION_REQUIRED')
  assert.equal(status.moduleProof.transactionId,'11111111-1111-4111-8111-111111111111')
  assert.equal(status.moduleProof.evidenceState,'SAME_PID_AT_RELOAD_AND_CURRENT_PID_MATCHES')
  assert.match(status.next,/not functional acceptance/i)
  const afterRestart=deliveryStatus(row,{pid:43,port:43127})
  assert.equal(afterRestart.state,'RUNTIME_VERIFICATION_REQUIRED')
  assert.equal(afterRestart.moduleProof.evidenceState,'HISTORICAL_HOST')
  assert.equal(afterRestart.moduleProof.currentHostPidMatches,false)
  assert.match(afterRestart.next,/Historical.*Host pid 42.*current Host pid is 43/i)

  recordDelivery(root,['hot-reload','demo','--profile','web','--port','43127','--json'],{exitCode:0,stdout:hotReloadOutput()},'session-b',42)
  assert.equal(deliveryStatus(readDelivery(root,'session-b'),{pid:42,port:43127}).state,'RUNTIME_VERIFICATION_REQUIRED')
 } finally {rmSync(root,{recursive:true,force:true})}
})

test('a failed or malformed hot reload removes an earlier success receipt', () => {
 const root=mkdtempSync(join(tmpdir(),'creator-delivery-hmr-failure-'))
 try {
  const plugin=join(root,'plugin'); mkdirSync(plugin); writeFileSync(join(plugin,'index.js'),'export const value=2')
  const plan={data:{change:'server',facts:{packageDir:plugin,hasClient:false,handoff:{port:43127}},decision:{hostRestart:'not-decided'}}}
  recordDelivery(root,['activation-plan','demo'],{exitCode:0,stdout:JSON.stringify(plan)},'session-a',42)
  recordDelivery(root,['check','demo'],{exitCode:0},'session-a',42)
  const args=['hot-reload','demo','--profile','web','--port','43127','--json']
  recordDelivery(root,args,{exitCode:0,stdout:hotReloadOutput()},'session-a',42)
  recordDelivery(root,args,{exitCode:1,stdout:'',stderr:'blocked'},'session-a',42)
  assert.equal(readDelivery(root,'session-a').hotReload,undefined)
  assert.equal(readDelivery(root,'session-a').hotReloadFailed.hostPid,42)
  assert.equal(deliveryStatus(readDelivery(root,'session-a'),{pid:42,port:43127}).state,'ACTIVATION_DECISION_REQUIRED')

  recordDelivery(root,args,{exitCode:0,stdout:hotReloadOutput()},'session-a',42)
  assert.throws(() => recordDelivery(root,args,{exitCode:0,stdout:'{}'},'session-a',42),/artifact-set or root-scope evidence/)
  assert.equal(readDelivery(root,'session-a').hotReload,undefined)
  assert.equal(readDelivery(root,'session-a').hotReloadFailed.hostPort,43127)
 } finally {rmSync(root,{recursive:true,force:true})}
})

test('a failed hot reload cannot revive an older restart-required plan', () => {
 const root=mkdtempSync(join(tmpdir(),'creator-delivery-hmr-no-restart-authority-'))
 try {
  const plugin=join(root,'plugin'); mkdirSync(plugin); writeFileSync(join(plugin,'index.js'),'export const value=2')
  const plan={data:{change:'server',facts:{packageDir:plugin,hasClient:false,handoff:{port:43127}},decision:{hostRestart:'required'}}}
  recordDelivery(root,['activation-plan','demo'],{exitCode:0,stdout:JSON.stringify(plan)},'session-a',42)
  recordDelivery(root,['check','demo'],{exitCode:0},'session-a',42)
  const args=['hot-reload','demo','--profile','web','--port','43127','--json']
  recordDelivery(root,args,{exitCode:1,stdout:'',stderr:'blocked'},'session-a',42)
  const status=deliveryStatus(readDelivery(root,'session-a'),{pid:42,port:43127})
  assert.equal(status.state,'ACTIVATION_DECISION_REQUIRED')
  assert.notEqual(status.state,'AWAITING_LAUNCHER_RESTART')
  assert.match(status.next,/does not restore older restart authority/i)
 } finally {rmSync(root,{recursive:true,force:true})}
})

test('hot reload rejects mismatched Host identity and incomplete cleanup proof', () => {
 const root=mkdtempSync(join(tmpdir(),'creator-delivery-hmr-mismatch-'))
 try {
  const args=['hot-reload','demo','--profile','web','--port','43127','--json']
  assert.throws(() => recordDelivery(root,args,{exitCode:0,stdout:hotReloadOutput({pid:41})},'session-a',42),/complete same-PID module evidence/)
  assert.equal(readDelivery(root,'session-a').hotReload,undefined)
  assert.equal(readDelivery(root,'session-a').hotReloadFailed.hostPid,42)
  const decoded=JSON.parse(hotReloadOutput())
  decoded.data.result.journal.cleanupProved=false
  assert.throws(() => recordDelivery(root,args,{exitCode:0,stdout:JSON.stringify(decoded)},'session-a',42),/complete same-PID module evidence/)
  assert.equal(readDelivery(root,'session-a').hotReload,undefined)
  assert.equal(deliveryStatus(readDelivery(root,'session-a'),{pid:42,port:43127}).state,'ACTIVATION_DECISION_REQUIRED')
 } finally {rmSync(root,{recursive:true,force:true})}
})

test('server delivery survives module/process replacement without becoming accepted', () => {
 const root=mkdtempSync(join(tmpdir(),'creator-delivery-'))
 try {
  const plugin=join(root,'plugin'); mkdirSync(plugin); writeFileSync(join(plugin,'index.js'),'export const value=1')
  const plan={data:{change:'server',facts:{packageDir:plugin,hasClient:true,handoff:{port:43127,launcher:'app'}},decision:{hostRestart:'required'}}}
  recordDelivery(root,['activation-plan','demo'],{exitCode:0,stdout:JSON.stringify(plan)},'session-a',10)
  recordDelivery(root,['check','demo'],{exitCode:0},'session-a',10)
  const row=readDelivery(root,'session-a')
  assert.equal(deliveryStatus(row,{pid:10,port:43127,startedAt:0}).state,'AWAITING_LAUNCHER_RESTART')
  assert.equal(deliveryStatus(row,{pid:11,port:43127,startedAt:row.builtAt+1}).state,'RUNTIME_VERIFICATION_REQUIRED')
  assert.equal(deliveryStatus(row,{pid:11,port:3080,startedAt:row.builtAt+1}).state,'TARGET_MISMATCH')
  assert.equal(readDelivery(root,'session-b'),undefined)
  recordDelivery(root,['check','demo'],{exitCode:0},'session-a',11)
  const repeated=readDelivery(root,'session-a')
  assert.equal(repeated.builtAt,row.builtAt)
  assert.equal(repeated.buildHostPid,10)
  assert.equal(deliveryStatus(repeated,{pid:11,port:43127,startedAt:row.builtAt+1}).state,'RUNTIME_VERIFICATION_REQUIRED')
  writeFileSync(join(plugin,'index.js'),'export const value=2')
  recordDelivery(root,['check','demo'],{exitCode:0},'session-a',11)
  assert.equal(deliveryStatus(readDelivery(root,'session-a'),{pid:11,port:43127}).state,'AWAITING_LAUNCHER_RESTART')
  recordDelivery(root,['check','demo'],{exitCode:1},'session-a',11)
  assert.equal(deliveryStatus(readDelivery(root,'session-a'),{port:43127}).state,'SOURCE_BUILD_REQUIRED')
 } finally {rmSync(root,{recursive:true,force:true})}
})

test('partial delivery states are lossless JSON for the official ToolRuntime output boundary', () => {
 const rows = [
  { pluginId:'demo', sourceBuilt:false },
  { pluginId:'demo', sourceBuilt:true, buildHostPid:42 },
  { pluginId:'demo', sourceBuilt:false, plan:{hostRestart:'not-decided',packageDir:'/plugin'} },
  { pluginId:'demo', sourceBuilt:false, hotReloadFailed:{hostPid:42,hostPort:43127} },
 ]
 for (const row of rows) {
  const status=deliveryStatus(row,{pid:42,port:43127})
  assert.deepEqual(JSON.parse(JSON.stringify(status)),status)
 }
})

test('fixed tool receipts reject incomplete, changed or preset artifact evidence', () => {
 const root=mkdtempSync(join(tmpdir(),'creator-delivery-artifacts-'))
 try {
  for (const mutate of [
   value => { delete value.proof.artifactHashes },
   value => { value.targetScope='preset' },
   value => { value.proof.artifactHashes[0].after='b'.repeat(64) },
   value => { value.watchRoots.push('src/helper.js') },
   value => { value.proof.artifactHashes[0].path='../outside.js' },
  ]) {
   const output=JSON.parse(hotReloadOutput())
   mutate(output.data.result)
   assert.throws(() => recordDelivery(root,['hot-reload','demo','--profile','web','--port','43127','--json'],
    {exitCode:0,stdout:JSON.stringify(output)},'session-a',42), /artifact-set or root-scope evidence/)
   assert.equal(readDelivery(root,'session-a').hotReload,undefined)
  }
 } finally { rmSync(root,{recursive:true,force:true}) }
})

test('an undecided server activation remains pending instead of advancing to runtime verification', () => {
 const row={
  version:1,
  sessionId:'session-a',
  pluginId:'demo',
  sourceBuilt:true,
  builtAt:100,
  buildHostPid:10,
  plan:{hostRestart:'not-decided',packageDir:'/plugin',handoff:{port:43127,launcher:'app'}},
 }
 const status=deliveryStatus(row,{pid:11,port:43127,startedAt:101})
 assert.equal(status.state,'ACTIVATION_DECISION_REQUIRED')
 assert.match(status.next,/pending.*module-HMR evidence/i)
 assert.notEqual(status.state,'RUNTIME_VERIFICATION_REQUIRED')
})

test('a failed undecided plan replaces a stale required receipt at the recordDelivery boundary', () => {
 const root=mkdtempSync(join(tmpdir(),'creator-delivery-plan-'))
 try {
  const plugin=join(root,'plugin'); mkdirSync(plugin); writeFileSync(join(plugin,'index.js'),'export const value=1')
  const required={data:{change:'server',facts:{packageDir:plugin,hasClient:false,handoff:{port:43127,launcher:'app'}},decision:{hostRestart:'required'}}}
  recordDelivery(root,['activation-plan','demo'],{exitCode:0,stdout:JSON.stringify(required)},'session-a',10)
  recordDelivery(root,['check','demo'],{exitCode:0},'session-a',10)

  const undecided={findings:[{level:'error',code:'activation-blocker'}],data:{change:'server',facts:{packageDir:plugin,hasClient:false,handoff:{port:43127,launcher:'app'}},decision:{hostRestart:'not-decided'}}}
  recordDelivery(root,['activation-plan','demo'],{exitCode:1,stdout:JSON.stringify(undecided)},'session-a',11)

  const row=readDelivery(root,'session-a')
  assert.equal(row.sourceBuilt,true)
  assert.equal(row.plan.hostRestart,'not-decided')
  assert.equal(row.planFailed,true)
  const status=deliveryStatus(row,{pid:11,port:43127,startedAt:row.builtAt+1})
  assert.equal(status.state,'ACTIVATION_DECISION_REQUIRED')
  assert.notEqual(status.state,'RUNTIME_VERIFICATION_REQUIRED')
 } finally {rmSync(root,{recursive:true,force:true})}
})

test('an ordinary failed plan clears stale activation authority without clearing source build proof', () => {
 const root=mkdtempSync(join(tmpdir(),'creator-delivery-plan-'))
 try {
  const plugin=join(root,'plugin'); mkdirSync(plugin); writeFileSync(join(plugin,'index.js'),'export const value=1')
  const required={data:{change:'server',facts:{packageDir:plugin,hasClient:false,handoff:{port:43127,launcher:'app'}},decision:{hostRestart:'required'}}}
  recordDelivery(root,['activation-plan','demo'],{exitCode:0,stdout:JSON.stringify(required)},'session-a',10)
  recordDelivery(root,['check','demo'],{exitCode:0},'session-a',10)

  recordDelivery(root,['activation-plan','demo'],{exitCode:1,stdout:JSON.stringify({data:{}})},'session-a',11)

  const row=readDelivery(root,'session-a')
  assert.equal(row.sourceBuilt,true)
  assert.equal(row.plan,undefined)
  assert.equal(row.planFailed,true)
  const status=deliveryStatus(row,{pid:11,port:43127,startedAt:row.builtAt+1})
  assert.equal(status.state,'ACTIVATION_PLAN_REQUIRED')
  assert.match(status.next,/plan.*pending/i)
  assert.notEqual(status.state,'RUNTIME_VERIFICATION_REQUIRED')
 } finally {rmSync(root,{recursive:true,force:true})}
})

test('authenticated proof follows the manifest URL and rejects unauthorized or missing bundles', async () => {
 const row={pluginId:'demo',plan:{hasClient:true}}
 const seen=[]
 const request=async (url,options)=>{
  seen.push(String(url));
  if(seen.length===1)return new Response('',{status:302,headers:{location:'/', 'set-cookie':'session=fixture; HttpOnly'}})
  assert.equal(options.headers.cookie,'session=fixture')
  if(seen.length===2)return new Response('<script>globalThis["__DSH_BOOT__"]={"entries":[{"id":"demo","url":"/plugins/demo/client.js?rev=abc"}]}</script>')
  return new Response('window.__ModuleLoader__.load({})')
 }
 assert.equal((await verifyDeliveryClient(row,3000,'http://127.0.0.1:3000/?token=fixture',request)).state,'CLIENT_MANIFEST_PRESENT')
 assert.equal(seen[2],'http://127.0.0.1:3000/plugins/demo/client.js?rev=abc')
 assert.equal((await verifyDeliveryClient(row,3000,'http://127.0.0.1:3000/',async()=>new Response('',{status:401}))).state,'WEB_AUTH_REQUIRED')
 assert.equal((await verifyDeliveryClient(row,3000,'https://example.com/')).state,'TARGET_MISMATCH')
})
