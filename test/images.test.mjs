import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createArchiveClient } from '../dist/api/client.js'
import { registerImageRead } from '../dist/harness/images.js'
import { imageDigest, imageResourceBinding } from '../dist/vendor/image-payload.js'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=',
  'base64',
)
const key = {
  accountId: 'account-id',
  groupId: 'group-id',
  messageId: 'message-id',
  assetType: 'image',
  assetKey: 'image-key',
}
const token = 'wg_ai_' + 'z'.repeat(43)
const imageHeaders = {
  'content-type': 'image/png',
  'content-length': String(png.length),
  'x-weibogroup-image-binding': imageResourceBinding(key),
  'x-weibogroup-image-sha256': imageDigest(png),
  'x-weibogroup-image-count': '1',
  'x-weibogroup-image-preview': '0',
}
async function fixture(t, respond, overrides = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'archive-image-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const config = {
    connectionFile: join(folder, 'connection.json'),
    timeoutMs: 1000,
    maxResponseBytes: 100000,
    maxMessages: 100,
    ...overrides,
  }
  await writeFile(
    config.connectionFile,
    JSON.stringify({ baseUrl: 'https://archive.example/prefix', apiToken: token }),
    { mode: 0o600 },
  )
  const calls = []
  const client = createArchiveClient(config, async (url, init) => {
    calls.push(new URL(url))
    assert.equal(init.headers.authorization, 'Bearer ' + token)
    assert.equal(init.redirect, 'manual')
    return respond(url, init)
  })
  return { client, config, calls }
}
test('image read stays on the configured origin, binds its exact resource and returns verified raster data', async (t) => {
  const { client, calls } = await fixture(t, () => new Response(png, { headers: imageHeaders }))
  const value = await client.readImage(key, new AbortController().signal)
  assert.equal(value.content[1].type, 'image')
  assert.equal(value.content[1].data, png.toString('base64'))
  assert.equal(value.content[1].mimeType, 'image/png')
  assert.equal(value.structuredContent.bytes, png.length)
  assert.equal(value.structuredContent.preview, false)
  assert.equal(calls[0].pathname, '/prefix/api/v1/messages/image')
  assert.equal(calls[0].searchParams.get('assetKey'), key.assetKey)
  assert.ok(!calls[0].href.includes(token))
  assert.ok(!JSON.stringify(value).includes(token))
})
test('image download rejects resource swaps, corruption, wrong media, partial data and byte limits', async (t) => {
  for (const [headers, body, error, status = 200, config = {}] of [
    [{ ...imageHeaders, 'x-weibogroup-image-binding': '0'.repeat(64) }, png, /IMAGE_RESOURCE_MISMATCH/],
    [{ ...imageHeaders, 'x-weibogroup-image-sha256': '0'.repeat(64) }, png, /IMAGE_DIGEST_MISMATCH/],
    [{ ...imageHeaders, 'content-type': 'text/html' }, png, /IMAGE_UNSUPPORTED_FORMAT/],
    [{ ...imageHeaders, 'content-length': String(png.length + 1) }, png, /IMAGE_SIZE_MISMATCH/],
    [imageHeaders, png, /IMAGE_PARTIAL_RESPONSE/, 206],
    [imageHeaders, png, /IMAGE_TOO_LARGE/, 200, { maxImageBytes: png.length - 1 }],
    [
      { ...imageHeaders, 'content-length': undefined },
      Buffer.concat([png, png]),
      /IMAGE_TOO_LARGE/,
      200,
      { maxImageBytes: png.length + 1 },
    ],
  ]) {
    const clean = Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined))
    const { client } = await fixture(t, () => new Response(body, { status, headers: clean }), config)
    await assert.rejects(client.readImage(key, new AbortController().signal), error)
  }
})
test('image redirects/errors never forward credentials or upstream response text', async (t) => {
  for (const response of [
    () => new Response(null, { status: 307, headers: { location: 'https://other.example/?private=hidden' } }),
    () => Response.json({ code: 'IMAGE_NOT_FOUND', error: 'private upstream error' }, { status: 404 }),
  ]) {
    const { client, calls } = await fixture(t, response)
    await assert.rejects(
      client.readImage(key, new AbortController().signal),
      (error) =>
        !error.message.includes('private upstream') &&
        !error.message.includes(token) &&
        !error.message.includes('other.example'),
    )
    assert.equal(calls.length, 1)
  }
})
test('cancellation interrupts an in-progress image response', async (t) => {
  const controller = new AbortController()
  let start
  const ready = new Promise((resolve) => {
    start = resolve
  })
  const { client } = await fixture(
    t,
    (_url, init) =>
      new Response(
        new ReadableStream({
          start(out) {
            init.signal.addEventListener('abort', () => out.error(init.signal.reason), { once: true })
            start()
          },
        }),
        { headers: imageHeaders },
      ),
  )
  const pending = client.readImage(key, controller.signal)
  await ready
  controller.abort(new Error('cancel-image'))
  await assert.rejects(pending, /cancel-image/)
})
for (const vision of [true, false])
  test(`native image projection ${vision ? 'admits visual content' : 'reports unavailable for a text-only route'}`, async (t) => {
    const { client, config } = await fixture(t, () => new Response(png, { headers: imageHeaders }))
    const ctx = new Context()
    let saved = 0
    class Prompts extends Service {
      constructor(ctx) {
        super(ctx, 'systemPrompt')
      }
      tools() {}
      section() {}
    }
    class Llm extends Service {
      constructor(ctx) {
        super(ctx, 'llm')
      }
      async resolveModelInfo() {
        return { inputModalities: vision ? ['text', 'image'] : ['text'] }
      }
    }
    class Attachments extends Service {
      constructor(ctx) {
        super(ctx, 'attachments')
      }
      async saveImages(images) {
        saved += images.length
        return images.map((img) => ({
          attachmentId: AttachmentId(createHash('sha256').update(img.data).digest('hex')),
          mediaType: img.mediaType,
          bytes: img.data.length,
          width: 1,
          height: 1,
        }))
      }
    }
    await ctx.plugin(Prompts)
    await ctx.plugin(Llm)
    await ctx.plugin(Attachments)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin({
      name: 'image-test',
      inject: ['tools', 'attachments'],
      apply: (child) => registerImageRead(child, client, config),
    })
    t.after(() => ctx.fiber.dispose())
    const agent = {
      ctx,
      options: { provider: 'test', model: vision ? 'vision' : 'text' },
      session: { requestHeader: () => ({ config: { provider: 'test', model: vision ? 'vision' : 'text' } }) },
    }
    const result = await ctx.tools.execute({
      callId: 'image-test',
      name: 'weibo_readMessageImage',
      arguments: key,
      signal: new AbortController().signal,
      agent,
    })
    assert.equal(result.isError, false, JSON.stringify(result))
    const images = result.content.filter((block) => block.type === 'image')
    if (vision) {
      assert.equal(saved, 1)
      assert.equal(images.length, 1)
      assert.equal(images[0].attachment.mediaType, 'image/png')
    } else {
      assert.equal(saved, 0)
      assert.equal(images.length, 0)
      assert.match(JSON.stringify(result.content), /image unavailable|image input/)
    }
    assert.ok(!JSON.stringify(result.content).includes(png.toString('base64')))
    assert.ok(!JSON.stringify(result).includes(token))
  })
