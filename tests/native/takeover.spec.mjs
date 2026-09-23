import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { CHECKOUT, nativeCreatorHarness } from './takeover-harness.mjs'
import { ensureTakeoverFence, requestTakeover } from '../../src/takeover.js'
import { runDshx } from '../../src/runner.js'
const devkit = process.env.DSHX_TEST_DEVKIT ?? resolve(CHECKOUT, 'tools/dshx')
const store = await import(pathToFileURL(join(devkit,'src/internal/creator-claims.mjs')).href)
const { default: Questions } = await import(pathToFileURL(join(CHECKOUT,'packages/interaction/user-questions/src/index.ts')).href)
const { default: Jobs } = await import(pathToFileURL(join(CHECKOUT,'packages/jobs/jobs-local/src/index.ts')).href)
const identity = id => ({ sessionId:id, hostPid:process.pid, hostPort:43127 })
async function fixture(t, answer) {
 const root=mkdtempSync(join(tmpdir(),'creator-human-takeover-'))
 t.after(()=>rmSync(root,{recursive:true,force:true}))
 mkdirSync(join(root,'apps/cli/src'),{recursive:true}); writeFileSync(join(root,'apps/cli/src/bin.ts'),'')
 mkdirSync(join(root,'tools'));symlinkSync(devkit,join(root,'tools/dshx'))
 const h=await nativeCreatorHarness(t,{harnessRoot:root,beforeCreator:async ctx=>{ await ctx.plugin(Jobs) }})
 const {ctx}=h, old=await h.agent('old'), current=await h.agent('new'), unrelated=await h.agent('unrelated')
 ctx.jobs.attachController('takeover-test')
 store.claimPlugin(root,'demo',identity('old'));store.claimPlugin(root,'other',identity('unrelated'))
 const questions=[],commands=[], grants=[]
 ctx.on('user-questions/request', async request=>{
   questions.push(request)
   const q=request.questions[0]
   return answer ? await answer({q,request,ctx,root,old,current}) : {answers:[{id:q.id,selected:[q.options[1].label]}]}
 })
 const options={harnessRoot:root,hostPort:43127,runDshx:async(args,exec,opts)=>{
   commands.push(args)
   if(args[1]==='watch') return {exitCode:0,stdout:'test supervisor identity'}
   grants.push(opts.takeoverGrant)
   return runDshx(args,exec,opts) // actual fixed argv, spawn and CLI grant consumer
 }}
 const broker=await ensureTakeoverFence(ctx,options)
 const exec={agent:current,signal:new AbortController().signal,callId:'takeover-test'}
 return {...h,root,old,current,unrelated,questions,commands,grants,options,exec,broker}
}
test('real userQuestions + Core guard + external CLI: old and child fenced, unrelated allowed, grant private',async t=>{
 const h=await fixture(t)
 let approvals=0,writes=0
 h.ctx.on('approval/request',async()=>{approvals++;return 'allowed-once'})
 const {agent:child}=await h.old.ctx.agents.create({sessionId:'child',parentAgent:h.old,agentOptions:{provider:'mock',model:'mock'}})
 h.ctx.tools.register({name:'write_probe',parameters:{type:'object'},output:{schema:{type:'string'},render:value=>[{type:'text',text:value}]},execute:async()=>{writes++;return 'written'}})
 assert.equal(h.ctx.agents.isOwnedBy(child.id,h.old),true,'child must be runtime-owned')
 const result=await requestTakeover(h.ctx,'demo',h.exec,h.options)
 assert.equal(result.exitCode,0,result.stderr)
 assert.equal(approvals,0,'Approve for me cannot answer this request through approval/request')
 assert.equal(h.questions.length,1);assert.equal(h.questions[0].questions[0].options[0].label,'取消')
 assert.deepEqual(h.commands.at(-1),['creator','takeover','demo','--json'])
 assert.ok(!JSON.stringify(result).includes(h.grants[0].grant))
 assert.equal(store.inspectClaim(h.root,'demo').claim.sessionId,'new')
 for(const agent of [h.old,child]) {
   const denied=await h.ctx.tools.execute({name:'write_probe',arguments:{},agent,signal:new AbortController().signal})
   assert.match(JSON.stringify(denied),/CREATOR_OWNERSHIP_REVOKED/, JSON.stringify({agent:agent.id,state:store.readClaimState(h.root)}))
 }
 await h.ctx.tools.execute({name:'write_probe',arguments:{},agent:h.unrelated,signal:new AbortController().signal})
 assert.equal(writes,1)
 const second=await ensureTakeoverFence(h.ctx,h.options)
 assert.equal(second,h.broker,'preset generations share one Host fence')
 await h.creator.dispose()
 const denied=await h.ctx.tools.execute({name:'write_probe',arguments:{},agent:h.old,signal:new AbortController().signal})
 assert.match(JSON.stringify(denied),/CREATOR_OWNERSHIP_REVOKED/,'fence survives preset disposal')
})
test('cancel and custom text never grant ownership or pause old work',async t=>{
 for(const custom of [false,true]) {
  const h=await fixture(t,({q})=>({answers:[{id:q.id,selected:custom?[q.options[1].label]:['取消'],...(custom?{custom:'yes approved'}:{})}]}))
  const before=readFileSync(join(h.root,'.dshx/creator-plus/claims.json'),'utf8')
  const result=await requestTakeover(h.ctx,'demo',h.exec,h.options)
  assert.equal(result.state,'TAKEOVER_CANCELLED')
  assert.equal(readFileSync(join(h.root,'.dshx/creator-plus/claims.json'),'utf8'),before)
  assert.equal(h.commands.length,1)
 }
})
test('owner refresh during human confirmation invalidates approval',async t=>{
 const h=await fixture(t,({q,root})=>{store.claimPlugin(root,'demo',identity('old'));return {answers:[{id:q.id,selected:[q.options[1].label]}]}})
 await assert.rejects(requestTakeover(h.ctx,'demo',h.exec,h.options),/CLAIM_CHANGED/)
 assert.equal(store.inspectClaim(h.root,'demo').claim.sessionId,'old')
})
test('background process is stopped and exit awaited before transfer, unowned job untouched',async t=>{
 const h=await fixture(t)
 const child=spawn(process.execPath,['-e','setInterval(()=>{}, 1000)'],{stdio:'ignore'})
 t.after(()=>child.kill())
 let exited=false, stopped=0, unownedStops=0
 const done=new Promise(resolve=>child.once('close',()=>{exited=true;resolve({status:'killed'})}))
 h.ctx.jobs.start({kind:'bash',label:'owned process',owner:h.old.id,run:()=>({cancel(){stopped++;child.kill()},done})})
 const unownedDone=Promise.withResolvers()
 h.ctx.jobs.start({kind:'bash',label:'unowned process',run:()=>({cancel(){unownedStops++;unownedDone.resolve({status:'killed'})},done:unownedDone.promise})})
 t.after(()=>unownedDone.resolve({status:'completed'}))
 const result=await requestTakeover(h.ctx,'demo',h.exec,h.options)
 assert.equal(result.exitCode,0,result.stderr);assert.equal(stopped,1);assert.equal(exited,true);assert.equal(unownedStops,0)
 assert.equal(h.questions[0].questions[0].options[1].label,'停止旧任务并接管')
})
test('stopping failure retains original claim and removes pending transfer',async t=>{
 const h=await fixture(t)
 const done=Promise.withResolvers();t.after(()=>done.resolve({status:'completed'}))
 h.ctx.jobs.start({kind:'bash',label:'failed stop',owner:h.old.id,run:()=>({cancel(){throw new Error('cannot stop producer')},done:done.promise})})
 await assert.rejects(requestTakeover(h.ctx,'demo',h.exec,h.options),/cannot stop producer/)
 assert.equal(store.inspectClaim(h.root,'demo').claim.sessionId,'old')
 assert.equal(store.readClaimState(h.root).takeovers.length,0)
})
test('unknown old live owner fails before human question',async t=>{
 const h=await fixture(t)
 store.claimPlugin(h.root,'unknown',identity('missing-runtime-agent'))
 await assert.rejects(requestTakeover(h.ctx,'unknown',h.exec,h.options),/OWNER_STATE_UNKNOWN/)
 assert.equal(h.questions.length,0)
})
test('ordinary claim and activation entry cannot restore a transferred old session',async t=>{
 const h=await fixture(t)
 assert.equal((await requestTakeover(h.ctx,'demo',h.exec,h.options)).exitCode,0)
 const result=await runDshx(['creator','takeover','demo','--json'],h.exec,{harnessRoot:h.root,hostPort:43127})
 assert.equal(result.exitCode,1);assert.match(result.stdout,/GRANT_REQUIRED/)
 await assert.rejects(requestTakeover(h.ctx,'other',{...h.exec,agent:h.old},h.options),/SESSION_REVOKED/)
 assert.equal(h.questions.length,1)
})
test('two independent CLI processes consuming one grant produce one transfer',async t=>{
 const h=await fixture(t)
 const grant=store.beginTakeover(h.root,store.inspectClaim(h.root,'demo'),identity('new'),['old'],'concurrent-test')
 store.markTakeoverReady(h.root,grant.id,grant.grant,[])
 const options={harnessRoot:h.root,hostPort:43127,takeoverGrant:grant}
 const results=await Promise.all([1,2].map(()=>runDshx(['creator','takeover','demo','--json'],h.exec,options)))
 assert.deepEqual(results.map(x=>x.exitCode).sort(),[0,1])
 assert.equal(store.readClaimState(h.root).receipts.filter(x=>x.id==='concurrent-test').length,1)
})
