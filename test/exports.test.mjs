import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createHash } from 'node:crypto'
import { createArchiveClient } from '../dist/api/client.js'
import { registerExportDownload } from '../dist/harness/exports.js'
import { archiveToolCatalog } from '../dist/api/catalog.js'

const id = '12345678-1234-1234-1234-123456789abc'
const token = 'wg_ai_' + 'x'.repeat(43)
const bytes = Buffer.from('\ufeffid,content\n1,你好\n')
const job = { id, kind: 'messages', accountId: 'a', groupId: 'g', format: 'csv', status: 'ready', createdAt: 1,
  finishedAt: 2, expiresAt: 9999999999999, filename: 'export.csv', contentType: 'text/csv; charset=utf-8', size: bytes.length, errorCode: null,
  result: { messageCount: 1, rowLimit: 10, truncated: false } }

async function fixture(t, respond, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'weibo-export-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const config = { connectionFile: join(dir, 'connection.json'), timeoutMs: 1000, maxResponseBytes: 100000, maxMessages: 100, ...overrides }
  await writeFile(config.connectionFile, JSON.stringify({ baseUrl: 'https://archive.example/prefix', apiToken: token }), { mode: 0o600 })
  const calls = []
  const client = createArchiveClient(config, async (input, init) => {
    const url = new URL(input)
    calls.push(url)
    assert.equal(init.headers.authorization, `Bearer ${token}`)
    assert.equal(init.redirect, 'manual')
    assert.equal(url.origin, 'https://archive.example')
    return respond(url, init)
  })
  return { client, config, calls }
}
const normal = url => url.pathname.endsWith('/download')
  ? new Response(bytes, { headers: { 'content-type': job.contentType, 'content-length': String(bytes.length) } })
  : Response.json({ job })

test('catalog permits file-generation writes but excludes Weibo sends and binary JSON tools', () => {
  const catalog = archiveToolCatalog()
  assert.equal(catalog.tools.length, 29)
  assert.equal(catalog.operations.get('createMessageExport').tool.annotations.readOnlyHint, false)
  assert.equal(catalog.operations.get('createUserExport').tool._meta['weibogroup/capability'], 'export')
  for (const name of ['sendGroupMessage', 'sendGroupImage', 'recallGroupMessage', 'sendGroupVideo', 'downloadExportFile', 'marketQuote']) assert.equal(catalog.operations.has(name), false)
})

test('authenticated export download preserves UTF-8 bytes and filename without returning a bearer URL', async t => {
  const { client, calls } = await fixture(t, normal)
  const download = await client.openExport(id, new AbortController().signal)
  try {
    const received = []; for await (const chunk of download.data) received.push(chunk)
    assert.deepEqual(Buffer.concat(received), bytes)
    assert.equal(download.filename, 'export.csv')
    assert.equal(download.size, bytes.length)
    assert.deepEqual(download.coverage, { messageCount: 1, truncated: false })
    assert.deepEqual(calls.map(url => url.pathname), [`/prefix/api/v1/exports/${id}`, `/prefix/api/v1/exports/${id}/download`])
    assert.ok(calls.every(url => !url.search))
  } finally { await download.close() }
})

test('one export keeps the same credential snapshot when its configuration rotates after metadata', async t => {
  const rotatedToken = 'wg_ai_' + 'y'.repeat(43)
  const { client, config, calls } = await fixture(t, async url => {
    if (!url.pathname.endsWith('/download')) {
      await writeFile(config.connectionFile, JSON.stringify({ baseUrl: 'https://other.example', apiToken: rotatedToken }), { mode: 0o600 })
    }
    return normal(url)
  })
  const download = await client.openExport(id, new AbortController().signal)
  try {
    const received = []; for await (const chunk of download.data) received.push(chunk)
    assert.deepEqual(Buffer.concat(received), bytes)
    assert.equal(calls.length, 2)
    assert.ok(calls.every(url => url.origin === 'https://archive.example'))
  } finally { await download.close() }
})

test('not-ready and oversized exports fail before the binary request', async t => {
  for (const [metadata, overrides, message] of [[{ ...job, status: 'running' }, {}, /EXPORT_NOT_READY/], [{ ...job, status: 'failed', errorCode: 'NO_MESSAGES' }, {}, /EXPORT_JOB_FAILED: NO_MESSAGES/], [job, { maxExportBytes: 1 }, /EXPORT_TOO_LARGE/]]) {
    const { client, calls } = await fixture(t, () => Response.json({ job: metadata }), overrides)
    await assert.rejects(client.openExport(id, new AbortController().signal), message)
    assert.equal(calls.length, 1)
  }
})

test('download rejects MIME, declared-length, streamed overflow and incomplete-byte mismatches', async t => {
  for (const [headers, body, error] of [
    [{ 'content-type': 'text/html' }, bytes, /EXPORT_CONTENT_TYPE_MISMATCH/],
    [{ 'content-type': job.contentType, 'content-length': '1' }, bytes, /EXPORT_SIZE_MISMATCH/],
    [{ 'content-type': job.contentType }, Buffer.concat([bytes, Buffer.from('extra')]), /EXPORT_TOO_LARGE/],
    [{ 'content-type': job.contentType }, bytes.subarray(1), /EXPORT_SIZE_MISMATCH/],
  ]) {
    const { client } = await fixture(t, url => url.pathname.endsWith('/download') ? new Response(body, { headers }) : Response.json({ job }))
    await assert.rejects(async () => {
      const download = await client.openExport(id, new AbortController().signal)
      try { for await (const _chunk of download.data) {} } finally { await download.close() }
    }, error)
  }
})

test('caller cancellation reaches the download body stream', async t => {
  const controller = new AbortController()
  let started
  const bodyStarted = new Promise(resolve => { started = resolve })
  const { client } = await fixture(t, (url, init) => {
    if (!url.pathname.endsWith('/download')) return Response.json({ job })
    const stream = new ReadableStream({ start(output) {
      init.signal.addEventListener('abort', () => output.error(init.signal.reason), { once: true })
      started()
    } })
    return new Response(stream, { headers: { 'content-type': job.contentType } })
  })
  const download = await client.openExport(id, controller.signal)
  const reading = (async () => { for await (const _chunk of download.data) {} })()
  await bodyStarted
  controller.abort(new Error('cancelled-export'))
  await assert.rejects(reading, /cancelled-export/)
  await download.close()
})

test('actual Harness runtime publishes a durable file attachment from the streamed export', async t => {
  const { client, config } = await fixture(t, normal)
  const ctx = new Context()
  class Prompts extends Service { constructor(ctx) { super(ctx, 'systemPrompt') } tools() {} section() {} }
  let saved
  class Attachments extends Service {
    constructor(ctx) { super(ctx, 'attachments') }
    async saveFileStream({ data, name, signal }) {
      const chunks = []; for await (const chunk of data) { signal.throwIfAborted(); chunks.push(chunk) }
      saved = Buffer.concat(chunks)
      return { attachmentId: AttachmentId(createHash('sha256').update(saved).digest('hex')), name, bytes: saved.length }
    }
  }
  await ctx.plugin(Prompts); await ctx.plugin(ToolRuntime, { mode: 'native' }); await ctx.plugin(Attachments)
  await ctx.plugin({ name: 'export-test', inject: ['tools', 'attachments'], apply: child => registerExportDownload(child, client, config) })
  t.after(() => ctx.fiber.dispose())
  const result = await ctx.tools.execute({ callId: 'download-case', name: 'weibo_downloadExport', arguments: { id }, signal: new AbortController().signal })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.deepEqual(saved, bytes)
  const file = result.content.find(block => block.type === 'file')
  assert.equal(file.attachment.name, 'export.csv')
  assert.equal(file.attachment.bytes, bytes.length)
  assert.ok(!JSON.stringify(result).includes(token))
})

test('binary redirects and mismatched metadata cannot change the export identity or destination', async t => {
  const redirect = await fixture(t, url => url.pathname.endsWith('/download')
    ? new Response(null, { status: 307, headers: { location: 'https://other.example/private' } })
    : Response.json({ job }))
  await assert.rejects(redirect.client.openExport(id, new AbortController().signal), /EXPORT_DOWNLOAD_FAILED/)
  assert.equal(redirect.calls.length, 2)
  const mismatch = await fixture(t, () => Response.json({ job: { ...job, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } }))
  await assert.rejects(mismatch.client.openExport(id, new AbortController().signal), /EXPORT_JOB_MISMATCH/)
  assert.equal(mismatch.calls.length, 1)
})
