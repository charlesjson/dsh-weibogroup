import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { apply, archiveToolCatalog } from '../dist/index.js'
import document from '../dist/contracts/openapi.json' with { type: 'json' }

test('native Harness monitor writes use strict contracts and keep credentials inside the adapter', async t => {
  const catalog = archiveToolCatalog()
  for (const name of ['listNotificationTargets', 'listMonitorRules', 'getMonitorRule', 'createMonitorRule', 'updateMonitorRule', 'deleteMonitorRule', 'listMonitorRuleHits', 'listMonitorRulePushJobs']) assert.ok(catalog.operations.has(name), name)
  assert.equal(catalog.operations.get('deleteMonitorRule').tool.annotations.destructiveHint, true)
  for (const name of ['sendGroupMessage', 'sendGroupImage', 'recallGroupMessage']) assert.equal(catalog.operations.has(name), false)
  const dir = await mkdtemp(join(tmpdir(), 'weibo-monitor-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const token = 'wg_ai_' + 'x'.repeat(43)
  const file = join(dir, 'connection.json')
  await writeFile(file, JSON.stringify({ baseUrl: 'https://archive.example', apiToken: token }), { mode: 0o600 })
  const ctx = new Context()
  let section
  class Prompts extends Service {
    constructor(ctx) { super(ctx, 'systemPrompt') }
    tools() {}
    section(value) { section = value }
  }
  await ctx.plugin(Prompts)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin({ name: 'monitor-test', inject: ['tools', 'systemPrompt'], apply: child => apply(child, { connectionFile: file, timeoutMs: 1000, maxResponseBytes: 100000, maxMessages: 100 }) })
  assert.match(section.text({}), /已入队通知仍可能送达/)
  t.after(() => ctx.fiber.dispose())
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const requests = []
  let stored = structuredClone(document.paths['/api/v1/monitor-rules'].post.responses['201'].content['application/json'].example.rule)
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers.authorization, `Bearer ${token}`)
    assert.equal(init.redirect, 'manual')
    const request = { method: init.method, path: new URL(url).pathname, body: init.body ? JSON.parse(init.body) : undefined }
    requests.push(request)
    assert.ok(!JSON.stringify(request).includes(token))
    if (init.method === 'DELETE') return Response.json({ ok: true })
    if (init.method === 'PATCH') stored = { ...stored, ...request.body,
      ...(request.body.enabled === undefined ? {} : { enabled: request.body.enabled ? 1 : 0 }) }
    return Response.json({ rule: stored }, { status: init.method === 'POST' ? 201 : 200 })
  }
  const execute = (name, args) => ctx.tools.execute({ callId: name, name: 'weibo_' + name, arguments: args, signal: new AbortController().signal })
  const create = await execute('createMonitorRule', { platform: 'telegram', keywords: ['故障'], enabled: false, sourceAccounts: ['account-id'], sourceGroups: ['group-id'], destinations: [{ targetId: 1 }] })
  assert.equal(create.isError, false, JSON.stringify(create))
  assert.equal(ctx.tools.get('weibo_createMonitorRule').isConcurrencySafe({}), false)
  assert.equal(ctx.tools.get('weibo_getMonitorRule').isConcurrencySafe({}), true)
  const update = await execute('updateMonitorRule', { id: '1', enabled: false, keywords: ['降价'] })
  assert.equal(update.isError, false, JSON.stringify(update))
  assert.deepEqual(requests[1], { method: 'PATCH', path: '/api/v1/monitor-rules/1', body: { enabled: false, keywords: ['降价'] } })
  const before = requests.length
  const invalid = await execute('createMonitorRule', { platform: 'telegram', ownerUserId: 'other', keywords: ['x'], destinations: [{ targetId: 1 }] })
  assert.equal(invalid.isError, true)
  assert.equal(requests.length, before)
  const deleted = await execute('deleteMonitorRule', { id: '1' })
  assert.equal(deleted.isError, false, JSON.stringify(deleted))
  assert.equal(requests.at(-1).method, 'DELETE')
  assert.ok(!JSON.stringify([create, update, deleted]).includes(token))
})
