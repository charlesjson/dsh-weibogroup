import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArchiveClient } from '../dist/api/client.js'
import document from '../dist/contracts/openapi.json' with { type: 'json' }

test('archive client is independent of Harness and re-reads rotated credentials for each call', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'weibo-client-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const connectionFile = join(dir, 'connection.json')
  const token = suffix => 'wg_ai_' + suffix.repeat(43)
  const store = async apiToken => writeFile(connectionFile, JSON.stringify({ baseUrl: 'https://archive.example', apiToken }), { mode: 0o600 })
  const seen = []
  const client = createArchiveClient({ connectionFile, timeoutMs: 1000, maxResponseBytes: 100000, maxMessages: 1000 }, async (_url, init) => {
    seen.push(init.headers.authorization)
    return Response.json(document.paths['/api/v1/accounts'].get.responses['200'].content['application/json'].example)
  })
  await store(token('a'))
  assert.equal((await client.call('listAccounts', {}, new AbortController().signal)).isError, undefined)
  await store(token('b'))
  assert.equal((await client.call('listAccounts', {}, new AbortController().signal)).isError, undefined)
  assert.deepEqual(seen, [`Bearer ${token('a')}`, `Bearer ${token('b')}`])
  assert.ok(client.tools.find(tool => tool.name === 'listUserMessageStats').inputSchema.properties.from)
  assert.ok(client.tools.find(tool => tool.name === 'getKeywordStats').inputSchema.properties.to)
})
