import { Context } from '@deepseek-ai/cordis'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply } from '../dist/index.js'

test('a missing host API is reported before any plugin effects are registered', async () => {
  const effects = []
  const ctx = { effect: () => { effects.push('registered') }, inject: () => { effects.push('registered') }, tools: { register: () => { effects.push('registered') }, get: () => { effects.push('registered') } }, systemPrompt: { section: () => { effects.push('registered') } } }
  delete ctx.tools.register
  await assert.rejects(async () => apply(ctx, {}), error => {
    assert.equal(error.code, 'DSH_API_UNSUPPORTED')
    assert.deepEqual(error.missingMethods, ['tools.register'])
    assert.match(error.message, /dsh-weibogroup/)
    return true
  })
  assert.deepEqual(effects, [])
})

test('an unavailable optional attachment API leaves the core tools active', async t => {
  const ctx = new Context(), tools = new Map(), warnings = []
  t.after(() => ctx.fiber.dispose())
  t.mock.method(console, 'warn', warning => warnings.push(warning))
  ctx.provide('tools', { register: tool => tools.set(tool.name, tool), get: name => tools.get(name) })
  ctx.provide('systemPrompt', { section() {} })
  ctx.provide('attachments', {})
  await ctx.plugin({ apply, inject: ['tools', 'systemPrompt'] }, { connectionFile: '/missing-test-connection', timeoutMs: 1000, maxResponseBytes: 100000, maxMessages: 100 })
  assert.ok(tools.has('weibo_listAccounts'))
  assert.equal(tools.has('weibo_downloadExport'), false)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /attachments.saveFileStream/)
})
