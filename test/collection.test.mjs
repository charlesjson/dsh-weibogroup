import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { apply, archiveToolCatalog } from '../dist/index.js'
import document from '../dist/contracts/openapi.json' with { type: 'json' }

const operations = ['listHistoryJobs','getHistoryJob','getActiveHistoryJob','createHistoryJob','createHistoryBackfill','pauseHistoryJob','resumeHistoryJob','cancelHistoryJob','retryHistoryJob','requestGroupProfileSync','getCrawlerStatus','getGroupCollectionStatus','listNotificationChannels','getNotificationStats','listNotificationPushJobs']
test('native collection and notification tools execute strict scoped requests without exposing other writes', async t => {
  const catalog = archiveToolCatalog()
  for (const name of operations) assert.ok(catalog.operations.has(name), name)
  for (const name of ['sendGroupMessage','recallGroupMessage','createAiSummarySchedule','marketQuote']) assert.equal(catalog.operations.has(name),false,name)
  const dir = await mkdtemp(join(tmpdir(),'weibo-collection-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const token = 'wg_ai_' + 'z'.repeat(43), file = join(dir,'connection.json')
  await writeFile(file,JSON.stringify({baseUrl:'https://archive.example',apiToken:token}),{mode:0o600})
  const ctx = new Context()
  let section
  class Prompts extends Service {
    constructor(ctx) { super(ctx,'systemPrompt') }
    tools() {}
    section(value) { section=value }
  }
  await ctx.plugin(Prompts)
  await ctx.plugin(ToolRuntime,{mode:'native'})
  await ctx.plugin({name:'collection-test',inject:['tools','systemPrompt'],apply:child=>apply(child,{connectionFile:file,timeoutMs:1000,maxResponseBytes:100000,maxMessages:100})})
  t.after(()=>ctx.fiber.dispose())
  assert.match(section.text({}),/工具没有 from\/to 日期停止条件/)
  assert.match(section.text({}),/Telegram pollerState 反映命令轮询/)
  assert.equal(ctx.tools.get('weibo_createHistoryJob').isConcurrencySafe({}),false)
  assert.equal(ctx.tools.get('weibo_getNotificationStats').isConcurrencySafe({}),true)
  assert.match(ctx.tools.get('weibo_createHistoryJob').description,/微博群聊采集任务/)
  const original = globalThis.fetch
  t.after(()=>{globalThis.fetch=original})
  const requests = []
  const example = (path,method='get') => structuredClone(document.paths[path][method].responses['200'].content['application/json'].example)
  globalThis.fetch = async (input,init) => {
    const url = new URL(input)
    assert.equal(init.headers.authorization,`Bearer ${token}`)
    assert.equal(init.redirect,'manual')
    const body = init.body ? JSON.parse(init.body) : undefined
    requests.push({method:init.method,path:url.pathname,body})
    if (init.method==='POST' && url.pathname==='/api/v1/history-jobs') return Response.json(example('/api/v1/history-jobs','post'))
    if (url.pathname.endsWith('/pause')) return Response.json({...example('/api/v1/history-jobs','post'),job:{...example('/api/v1/history-jobs','post').job,status:'paused'}})
    return Response.json(example(url.pathname))
  }
  const execute = (name,args={})=>ctx.tools.execute({callId:name,name:'weibo_'+name,arguments:args,signal:new AbortController().signal})
  const created = await execute('createHistoryJob',{accountId:'account-id',groupId:'group-id',count:1,pages:1})
  assert.equal(created.isError,false,JSON.stringify(created))
  assert.deepEqual(requests[0],{method:'POST',path:'/api/v1/history-jobs',body:{accountId:'account-id',groupId:'group-id',count:1,pages:1}})
  const paused = await execute('pauseHistoryJob',{id:'1'})
  assert.equal(paused.isError,false,JSON.stringify(paused))
  assert.equal(requests.at(-1).path,'/api/v1/history-jobs/1/pause')
  for (const name of ['getCrawlerStatus','listNotificationChannels','getNotificationStats','listNotificationPushJobs']) {
    const result = await execute(name)
    assert.equal(result.isError,false,JSON.stringify(result))
    assert.ok(!JSON.stringify(result).includes(token))
  }
  const count = requests.length
  for (const args of [{accountId:'account-id',groupId:'group-id',from:'2026-01-01'},{accountId:'account-id',groupId:'group-id',ownerUserId:'other'}]) {
    assert.equal((await execute('createHistoryJob',args)).isError,true)
  }
  assert.equal(requests.length,count,'unsupported dates and owner overrides must fail before HTTP')
})
