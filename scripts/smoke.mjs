import assert from 'node:assert/strict'
import { readOnlyCatalog } from '../dist/index.js'
import { loadConnection } from '../dist/api/connection.js'
import { authenticatedFetch } from '../dist/api/transport.js'
import { executeMcpTool } from '../dist/vendor/http-tools.js'

const connection = await loadConnection()
const catalog = readOnlyCatalog()
const options = { apiBaseUrl: connection.baseUrl, apiToken: connection.apiToken, timeoutMs: 30000, maxResponseBytes: 4194304,
  maxAutoPaginatedMessages: 100, fetch: authenticatedFetch(connection.baseUrl, new AbortController().signal) }
const call = async (name, args) => {
  const result = await executeMcpTool(catalog, name, args, options)
  assert.ok(!result.isError, `${name}: ${result.content[0]?.text}`)
  return result.structuredContent
}
const accounts = await call('listAccounts', {})
const account = accounts.accounts[0]
assert.ok(account, 'No accounts visible to this token')
const groups = await call('listGroups', { accountId: account.accountId })
const group = groups.groups[0]
assert.ok(group, 'No groups visible to this token')
const messages = await call('searchMessages', { accountId: account.accountId, groupId: group.groupId, limit: 100 })
const timeline = await call('getMessageTimeline', { accountId: account.accountId, groupId: group.groupId, period: 'monthly' })
console.log(JSON.stringify({ tools: catalog.tools.length, accounts: accounts.accounts.length, groups: groups.groups.length,
  messagesReturned: messages.messages.length, pagination: messages.pagination, timelineKeys: Object.keys(timeline), hasOpenGap: group.hasOpenGap }))
