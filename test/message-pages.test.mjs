import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createArchiveClient } from '../dist/api/client.js'
import { MAX_MESSAGE_PAGE_BYTES } from '../dist/api/message-pages.js'
import document from '../dist/contracts/openapi.json' with { type: 'json' }

const fixture = document.paths['/api/v1/messages'].get.responses['200'].content['application/json'].example
const example = fixture.messages[0]
const signal = () => new AbortController().signal
const messages = (count, content = '原文保持完整') => Array.from({ length: count }, (_, i) => ({
  ...example, messageId: String(i + 1), messageTime: 100 + i, content,
  senderAvatarUrl: 'https://example.test/avatar.jpg',
  quote: { text: '回复原文', messageId: 'original', sender: 'Example', quotedContent: '重复正文'.repeat(100), nested: { text: '嵌套引用'.repeat(100) } },
  assets: [{ accountId: example.accountId, groupId: example.groupId, messageId: String(i + 1),
    assetKey: 'image-key', assetType: 'image', url: null, title: null, metadata: { text: '大附件数据'.repeat(100) } }],
}))

async function clientFor(t, fetcher, maxMessages = 1000) {
  const dir = await mkdtemp(join(tmpdir(), 'weibo-pages-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const connectionFile = join(dir, 'connection.json')
  await writeFile(connectionFile, JSON.stringify({ baseUrl: 'https://archive.example', apiToken: 'wg_ai_' + 'x'.repeat(43) }), { mode: 0o600 })
  return createArchiveClient({ connectionFile, timeoutMs: 1000, maxResponseBytes: 4 * 1024 * 1024, maxMessages }, fetcher)
}

function value(result) {
  assert.ok(!result.isError, JSON.stringify(result))
  const text = result.content[0].text
  assert.ok(Buffer.byteLength(text) <= MAX_MESSAGE_PAGE_BYTES)
  assert.deepEqual(JSON.parse(text), result.structuredContent)
  assert.ok(text.includes('\n'), 'result must be readable as multiline JSON')
  return result.structuredContent
}

test('context pages return every original message exactly once and expose scope/target coverage', async t => {
  const rows = messages(121)
  const seen = []
  const client = await clientFor(t, async url => {
    const query = new URL(url).searchParams
    seen.push(query)
    assert.equal(query.has('pageCursor'), false)
    assert.equal(query.has('pageSize'), false)
    assert.equal(query.has('detail'), false)
    return Response.json({ messages: rows, targetMessageId: '61' })
  })
  const args = { accountId: example.accountId, groupId: example.groupId, messageId: '61', before: 60, after: 60, pageSize: 10 }
  const returned = []
  let pageCursor, pages = 0, targetPages = 0
  do {
    const page = value(await client.call('getMessageContext', { ...args, ...(pageCursor ? { pageCursor } : {}) }, signal()))
    assert.equal(page.pagination.scope, 'requested-context-window')
    assert.equal(page.pagination.totalMessageCount, 121)
    assert.equal(page.pagination.targetIncluded, page.messages.some(m => m.messageId === '61'))
    assert.equal(page.pagination.complete, page.nextPageCursor === null)
    assert.equal(page.pagination.truncated, page.nextPageCursor !== null)
    assert.ok(page.messages.length <= 10)
    assert.equal(page.messages[0].content, rows[0].content)
    assert.equal(page.messages[0].senderAvatarUrl, undefined)
    assert.equal(page.messages[0].assets[0].metadata, undefined)
    assert.equal(page.messages[0].assets[0].assetKey, 'image-key')
    assert.equal(page.messages[0].quote.messageId, 'original')
    assert.equal(page.messages[0].quote.nested, undefined)
    returned.push(...page.messages.map(m => m.messageId))
    targetPages += Number(page.pagination.targetIncluded)
    pageCursor = page.nextPageCursor
    pages++
  } while (pageCursor)
  assert.deepEqual(returned, rows.map(m => m.messageId))
  assert.equal(targetPages, 1)
  assert.equal(pages, 13)
  assert.equal(seen.length, 13)
})

test('context defaults are normalized, and stale/mismatched/invalid cursors never silently skip evidence', async t => {
  let rows = messages(12), calls = 0
  const client = await clientFor(t, async url => {
    calls++
    const query = new URL(url).searchParams
    assert.equal(query.get('before'), '5')
    assert.equal(query.get('after'), '5')
    return Response.json({ messages: rows, targetMessageId: '6' })
  })
  const args = { accountId: example.accountId, groupId: example.groupId, messageId: '6' }
  const first = value(await client.call('getMessageContext', args, signal()))
  const last = value(await client.call('getMessageContext', { ...args, before: 5, after: 5, raw: '0', detail: 'compact', pageCursor: first.nextPageCursor }, signal()))
  assert.deepEqual(last.messages.map(m => m.messageId), ['11', '12'])
  await assert.rejects(client.call('getMessageContext', { ...args, messageId: 'other', pageCursor: first.nextPageCursor }, signal()), /invalid pageCursor/)
  await assert.rejects(client.call('getMessageContext', { ...args, pageCursor: 'broken' }, signal()), /invalid pageCursor/)
  assert.equal(calls, 2, 'scope errors must fail before HTTP')
  rows = rows.map((m, i) => i === 0 ? { ...m, content: 'changed' } : m)
  const stale = await client.call('getMessageContext', { ...args, pageCursor: first.nextPageCursor }, signal())
  assert.equal(stale.isError, true)
  assert.match(stale.content[0].text, /CONTEXT_PAGE_STALE/)
})

test('search shrinks long pages using backend cursors and preserves complete text through continuation', async t => {
  const rows = messages(23, '完整汉字正文'.repeat(150))
  const requests = []
  const client = await clientFor(t, async url => {
    const query = new URL(url).searchParams
    requests.push(query)
    const start = Number(query.get('cursor') ?? 0), limit = Number(query.get('limit'))
    const selected = rows.slice(start, start + limit)
    const nextCursor = start + selected.length < rows.length ? String(start + selected.length) : null
    return Response.json({ ...fixture, messages: selected, nextCursor, pagination: { complete: nextCursor === null, truncated: false, pagesFetched: 1, returnedMessageCount: selected.length } })
  })
  const found = []
  let cursor
  do {
    const page = value(await client.call('searchMessages', { accountId: example.accountId, groupId: example.groupId, q: 'topic', ...(cursor ? { cursor } : {}) }, signal()))
    for (const row of page.messages) assert.equal(row.content, rows[0].content)
    found.push(...page.messages.map(m => m.messageId))
    assert.equal(page.pagination.truncated, page.nextCursor !== null)
    assert.equal(page.search.appliedMode, fixture.search.appliedMode)
    cursor = page.nextCursor
  } while (cursor)
  assert.deepEqual(found, rows.map(m => m.messageId))
  assert.equal(requests[0].get('limit'), '10')
  assert.ok(requests.some(q => Number(q.get('limit')) < 10))
  assert.ok(requests.every(q => q.get('q') === 'topic'))
})

test('context byte budget reduces page size without skipping large messages', async t => {
  const rows = messages(4, '汉字'.repeat(1500))
  const client = await clientFor(t, async () => Response.json({ messages: rows, targetMessageId: '2' }))
  const args = { accountId: example.accountId, groupId: example.groupId, messageId: '2', pageSize: 20 }
  const first = value(await client.call('getMessageContext', args, signal()))
  assert.ok(first.messages.length < 4)
  const all = [...first.messages]
  let cursor = first.nextPageCursor
  while (cursor) {
    const page = value(await client.call('getMessageContext', { ...args, pageCursor: cursor }, signal()))
    all.push(...page.messages)
    cursor = page.nextPageCursor
  }
  assert.deepEqual(all.map(m => [m.messageId, m.content]), rows.map(m => [m.messageId, m.content]))
})

test('window continuations preserve direction, sender and exclusive anchors', async t => {
  const rows = messages(23)
  const client = await clientFor(t, async url => {
    const q = new URL(url).searchParams
    assert.equal(q.get('senderUid'), 'sender')
    assert.ok(!(q.has('beforeMessageId') && q.has('afterMessageId')))
    const before = q.get('beforeMessageId'), after = q.get('afterMessageId'), limit = Number(q.get('limit'))
    const selected = rows.filter(m => before ? Number(m.messageId) < Number(before) : after ? Number(m.messageId) > Number(after) : true)
    return Response.json({ messages: after ? selected.slice(0, limit) : selected.slice(-limit) })
  })
  const args = { accountId: example.accountId, groupId: example.groupId, senderUid: 'sender' }
  for (const initial of [args, { ...args, afterMessageId: '0' }]) {
    let next = initial
    const found = []
    while (next) {
      const page = value(await client.call('getMessageWindow', next, signal()))
      found.push(...page.messages.map(m => m.messageId))
      if (page.pagination.hasMore === false) break
      next = page.pagination.continuation
    }
    assert.equal(new Set(found).size, 23)
    assert.deepEqual(found.map(Number).sort((a, b) => a - b), rows.map(m => Number(m.messageId)))
  }
  await assert.rejects(client.call('getMessageWindow', { ...args, beforeMessageId: '1', afterMessageId: '2' }, signal()), /mutually exclusive/)
})

test('full/raw details remain available; oversized single messages return an actionable error', async t => {
  let rows = messages(1)
  const client = await clientFor(t, async () => Response.json({ messages: rows, targetMessageId: '1' }))
  const args = { accountId: example.accountId, groupId: example.groupId, messageId: '1', before: 0, after: 0 }
  for (const extra of [{ detail: 'full' }, { raw: '1' }]) {
    const page = value(await client.call('getMessageContext', { ...args, ...extra }, signal()))
    assert.deepEqual(page.messages, rows)
    assert.equal(page.presentation.detail, 'full')
  }
  rows = messages(1, '长'.repeat(30_000))
  const result = await client.call('getMessageContext', args, signal())
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /MESSAGE_TOO_LARGE/)
  assert.deepEqual(JSON.parse(result.content[0].text).messageKey, { accountId: example.accountId, groupId: example.groupId, messageId: '1' })
  assert.ok(result.content[0].text.length < 1000)
})

test('client enforces advertised page bounds before HTTP, including calls outside native Harness', async t => {
  let calls = 0
  const client = await clientFor(t, async () => { calls++; return Response.json(fixture) })
  for (const args of [{ limit: 21 }, { limit: 1.5 }, { limit: 0 }, { detail: 'unknown' }, { pageCursor: 'unexpected' }]) {
    await assert.rejects(client.call('searchMessages', args, signal()), /invalid arguments/)
  }
  const scope = { accountId: example.accountId, groupId: example.groupId, messageId: '1' }
  for (const pageSize of [0, 21, 1.5]) await assert.rejects(client.call('getMessageContext', { ...scope, pageSize }, signal()), /invalid arguments/)
  assert.equal(calls, 0)
  const controller = new AbortController()
  controller.abort(Error('cancelled'))
  await assert.rejects(client.call('searchMessages', {}, controller.signal), /cancelled/)
  assert.equal(calls, 0)
  for (const name of ['searchMessages', 'getMessageContext', 'getMessageWindow']) {
    const tool = client.tools.find(t => t.name === name)
    assert.ok(tool.outputSchema.properties.presentation)
    assert.match(tool.description, /24KB/)
  }
})

test('adaptive retries preserve cancellation and the total deadline', async t => {
  const rows = messages(10, '太长'.repeat(3000))
  let calls = 0
  const controller = new AbortController()
  const client = await clientFor(t, async () => {
    calls++
    controller.abort(Error('cancelled after first response'))
    return Response.json({ ...fixture, messages: rows, nextCursor: 'more' })
  })
  await assert.rejects(client.call('searchMessages', {}, controller.signal), /cancelled/)
  assert.equal(calls, 1)

  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  calls = 0
  const timed = await clientFor(t, async () => {
    calls++
    now += 2000
    return Response.json({ ...fixture, messages: rows, nextCursor: 'more' })
  })
  const result = await timed.call('searchMessages', {}, signal())
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /UPSTREAM_TIMEOUT/)
  assert.equal(calls, 1, 'shrinking must not restart the overall timeout')
})

test('configured message cap applies to context and search pages', async t => {
  const client = await clientFor(t, async url => {
    const q = new URL(url).searchParams
    if (new URL(url).pathname.endsWith('/context')) return Response.json({ messages: messages(5), targetMessageId: '1' })
    assert.equal(q.get('limit'), '2')
    return Response.json({ ...fixture, messages: messages(2), nextCursor: 'more' })
  }, 2)
  const context = value(await client.call('getMessageContext', { accountId: example.accountId, groupId: example.groupId, messageId: '1' }, signal()))
  assert.equal(context.messages.length, 2)
  assert.ok(context.nextPageCursor)
  const search = value(await client.call('searchMessages', {}, signal()))
  assert.equal(search.messages.length, 2)
  assert.equal(search.nextCursor, 'more')
})
