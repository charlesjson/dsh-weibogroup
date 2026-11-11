import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { apply, archiveToolCatalog } from '../dist/index.js'
import { loadConnection } from '../dist/api/connection.js'
import { authenticatedFetch } from '../dist/api/transport.js'
import { executeMcpTool } from '../dist/vendor/http-tools.js'
import document from '../dist/contracts/openapi.json' with { type: 'json' }

const token = 'wg_ai_' + 'x'.repeat(43)
const options = { apiBaseUrl: new URL('https://archive.example'), apiToken: token, timeoutMs: 1000, maxResponseBytes: 100000 }

test('catalog excludes send/recall tools but retains POST batch reads and exact input schemas', async () => {
  const catalog = archiveToolCatalog()
  assert.ok(catalog.tools.length >= 18)
  for (const name of ['sendGroupMessage', 'sendGroupImage', 'sendGroupVideo', 'recallGroupMessage']) assert.equal(catalog.operations.has(name), false)
  assert.ok(catalog.operations.has('getMessagesBatch'))
  let calls = 0
  await assert.rejects(executeMcpTool(catalog, 'searchMessages', { madeUpFilter: true }, { ...options, fetch: async () => { calls++; throw Error() } }), /invalid arguments/)
  await assert.rejects(executeMcpTool(catalog, 'sendGroupMessage', {}, options), /unknown tool/)
  assert.equal(calls, 0)
})

test('connection errors do not expose credentials and POSIX permissions are enforced', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-weibo-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'connection.json')
  await writeFile(file, JSON.stringify({ baseUrl: options.apiBaseUrl.href, apiToken: token }), { mode: 0o600 })
  assert.equal((await loadConnection(file)).apiToken, token)
  if (process.platform !== 'win32') {
    await chmod(file, 0o644)
    await assert.rejects(loadConnection(file), /chmod 600/)
    await chmod(file, 0o600)
  }
  await writeFile(file, JSON.stringify({ baseUrl: 'http://insecure.example', apiToken: token }))
  await assert.rejects(loadConnection(file), /HTTPS/)
  await writeFile(file, token)
  await assert.rejects(loadConnection(file), error => !error.message.includes(token))
})

test('redirects are not followed and cannot carry the API token to another origin', async () => {
  let calls = 0
  const fetcher = authenticatedFetch(options.apiBaseUrl, new AbortController().signal, async (_url, init) => {
    calls++; assert.equal(init.redirect, 'manual')
    return new Response(null, { status: 307, headers: { location: 'https://login.example/?secret=hidden' } })
  })
  const response = await fetcher(new URL('/api/v1/accounts', options.apiBaseUrl))
  assert.equal((await response.json()).code, 'LAZYCAT_LOGIN_REQUIRED')
  await assert.rejects(fetcher('https://other.example/api/v1/accounts'), /Cross-origin/)
  assert.equal(calls, 1)
})

test('caller cancellation is fused with HTTP timeout and reaches the actual request', async () => {
  const caller = new AbortController(), timeout = new AbortController()
  let received
  const fetcher = authenticatedFetch(options.apiBaseUrl, caller.signal, async (_url, init) => {
    received = init.signal
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
  })
  const pending = fetcher(options.apiBaseUrl, { signal: timeout.signal })
  caller.abort(new Error('cancelled by caller'))
  await assert.rejects(pending, /cancelled by caller/)
  assert.equal(received.aborted, true)
})

test('message pagination returns complete evidence or a resumable, explicit partial result', async () => {
  const example = document.paths['/api/v1/messages'].get.responses['200'].content['application/json'].example
  const run = async maximum => {
    const requests = []
    const result = await executeMcpTool(archiveToolCatalog(), 'searchMessages', { accountId: 'account-id', groupId: 'group-id', limit: 1 }, {
      ...options, maxAutoPaginatedMessages: maximum,
      fetch: async (url, init) => {
        requests.push(new URL(url))
        assert.equal(init.headers.authorization, `Bearer ${token}`)
        const last = new URL(url).searchParams.get('cursor') === 'opaque-second-page'
        return Response.json({ ...example, messages: [{ ...example.messages[0], messageId: last ? '2' : '1' }],
          nextCursor: last ? null : 'opaque-second-page',
          pagination: { complete: last, pagesFetched: 1, returnedMessageCount: 1, truncated: false } })
      },
    })
    assert.ok(!result.isError, result.content[0]?.text)
    return { value: result.structuredContent, requests }
  }
  const full = await run(10)
  assert.deepEqual(full.value.messages.map(x => x.messageId), ['1', '2'])
  assert.equal(full.value.pagination.complete, true)
  assert.equal(full.value.nextCursor, null)
  assert.equal(full.requests[1].searchParams.get('groupId'), 'group-id')
  const partial = await run(1)
  assert.equal(partial.value.pagination.complete, false)
  assert.equal(partial.value.pagination.truncated, true)
  assert.equal(partial.value.nextCursor, 'opaque-second-page')
  assert.equal(partial.requests.length, 1)
})

test('real Cordis effects register native Harness definitions and dispose cleanly', async () => {
  const ctx = new Context(), definitions = new Map(), sections = new Map()
  class Tools extends Service {
    constructor(ctx) { super(ctx, 'tools') }
    register(definition) {
      definitions.set(definition.name, definition)
      this.ctx.effect(() => () => definitions.delete(definition.name))
      return () => definitions.delete(definition.name)
    }
    get(name) { return definitions.get(name) }
  }
  class Prompts extends Service {
    constructor(ctx) { super(ctx, 'systemPrompt') }
    section(section) { sections.set(section.name, section); this.ctx.effect(() => () => sections.delete(section.name)) }
  }
  await ctx.plugin(Tools)
  await ctx.plugin(Prompts)
  const fork = ctx.plugin({ name: 'weibo-test', inject: ['tools', 'systemPrompt'], apply: child => apply(child, { connectionFile: '/missing', timeoutMs: 1000, maxResponseBytes: 100000, maxMessages: 1000 }) })
  await fork
  assert.equal(definitions.size, archiveToolCatalog().tools.length)
  assert.match(sections.get('tool:weibogroup').text({}), /领取回执金额不等于/)
  const tool = definitions.get('weibo_listAccounts')
  assert.ok(tool.output.schema)
  assert.equal(tool.isConcurrencySafe({}), true)
  await assert.rejects(tool.execute({}, { signal: new AbortController().signal }), /连接配置/)
  await fork.dispose()
  assert.equal(definitions.size, 0)
  assert.equal(sections.size, 0)
  await ctx.fiber.dispose()
})

test('actual Harness ToolRuntime validates and executes a registered archive query', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-weibo-runtime-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'connection.json')
  await writeFile(file, JSON.stringify({ baseUrl: options.apiBaseUrl.href, apiToken: token }), { mode: 0o600 })
  const ctx = new Context()
  class Prompts extends Service {
    constructor(ctx) { super(ctx, 'systemPrompt') }
    tools() {}
    section() {}
  }
  await ctx.plugin(Prompts)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin({ name: 'weibo-test', inject: ['tools', 'systemPrompt'], apply: child => apply(child, {
    connectionFile: file, timeoutMs: 1000, maxResponseBytes: 100000, maxMessages: 100,
  }) })
  t.after(() => ctx.fiber.dispose())
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let searchRequests = 0
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers.authorization, `Bearer ${token}`)
    if (new URL(url).pathname === '/api/v1/messages') {
      searchRequests++
      const example = document.paths['/api/v1/messages'].get.responses['200'].content['application/json'].example
      return Response.json({ ...example, nextCursor: 'more-archive-history', pagination: {
        complete: false, pagesFetched: 1, returnedMessageCount: 1, truncated: false,
      } })
    }
    assert.equal(new URL(url).pathname, '/api/v1/accounts')
    return Response.json(document.paths['/api/v1/accounts'].get.responses['200'].content['application/json'].example)
  }
  assert.ok(ctx.tools.schemas().some(tool => tool.name === 'weibo_listAccounts'))
  const result = await ctx.tools.execute({ callId: 'weibo-fixture-call', name: 'weibo_listAccounts', arguments: {}, signal: new AbortController().signal })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.match(JSON.stringify(result), /Research account/)
  const search = await ctx.tools.execute({ callId: 'weibo-small-sample', name: 'weibo_searchMessages', arguments: { limit: 1 }, signal: new AbortController().signal })
  assert.equal(search.isError, false, JSON.stringify(search))
  assert.equal(searchRequests, 1, 'limit=1 must not expand into the complete archive')
  assert.ok(ctx.tools.get('weibo_listGroupMembers').parameters.properties.q)
  assert.ok(ctx.tools.get('weibo_listGroups').parameters.properties.q)
})
