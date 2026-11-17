import { createHash } from 'node:crypto'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { isRecord } from '../vendor/helpers.js'
import { McpToolInputError } from '../vendor/http-tools.js'

const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 20
export const MAX_MESSAGE_PAGE_BYTES = 24_000
const MESSAGE_TOOLS = new Set(['searchMessages', 'getMessageContext', 'getMessageWindow'])
type Args = Record<string, unknown>
type Execute = (args: Args) => Promise<CallToolResult>

const COMMON_GUIDANCE = 'Harness 消息列表默认精简输出：保留完整 content、身份/时间/状态、引用锚点和附件键，省略头像、附件 metadata、重复引用树和逐条搜索摘要。detail="full" 可读取完整记录；精确读取某条详情优先 getMessagesBatch(keys=[{accountId,groupId,messageId}])。分页可能因24KB预算少于请求条数，检查返回的继续参数；禁止把未读完的页当作完整证据。'
const GUIDANCE: Record<string, string> = {
  searchMessages: '每次只读一页，limit 默认10、最大20。继续时把 nextCursor 原样传入 cursor，保持账号/群/日期/查询/排序/搜索模式不变；nextCursor=null 才无下一页。统计使用 getMessageTimeline。',
  getMessageContext: 'before/after 控制目标前后的总窗口（默认各5），pageSize 默认10、最大20。首次省略 pageCursor；继续时把 nextPageCursor 传入 pageCursor，保持 accountId/groupId/messageId/before/after/raw/detail 不变。nextPageCursor=null 表示该窗口结束，不代表全部群历史。各页按时间正序；targetIncluded=false 时目标原文尚未在本页返回，不得据此核验引文。游标过期应从第一页重新读取。',
  getMessageWindow: 'limit 默认10、最大20。beforeMessageId/afterMessageId 互斥，都是消息ID，不能填搜索或上下文游标。继续向旧翻页，使用 pagination.continuation 的首条消息ID；向新翻页使用末条消息ID，保持账号/群/发送者范围不变。hasMore=null 表示未知，继续取到空页才能确认该方向已读完。',
}

/** Only the Harness-facing catalog changes; REST contracts and validators stay intact. */
export function messagePageTool(tool: Tool): Tool {
  if (!MESSAGE_TOOLS.has(tool.name)) return tool
  const properties = { ...tool.inputSchema.properties }
  properties.detail = { type: 'string', enum: ['compact', 'full'], default: 'compact', description: 'List projection. compact keeps complete message text and resource keys; full includes all REST fields. raw="1" always keeps full fields.' }
  if (tool.name === 'getMessageContext') {
    for (const field of ['before', 'after']) {
      properties[field] = { ...(properties[field] as Args), default: 5 }
    }
    properties.pageSize = { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE, description: 'Maximum messages returned on this context page; may be smaller due to the output byte budget.' }
    properties.pageCursor = { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$', description: 'Opaque nextPageCursor from the preceding context page. Keep window scope and detail unchanged; omit on first page.' }
  } else {
    properties.limit = { ...(properties.limit as Args), default: DEFAULT_PAGE_SIZE, maximum: MAX_PAGE_SIZE, description: 'Maximum messages in this one page: default 10, at most 20. May be reduced to fit the output byte budget. Follow the returned continuation when needed.' }
  }
  return {
    ...tool,
    description: `${tool.description ?? tool.name}\n${GUIDANCE[tool.name]}\n${COMMON_GUIDANCE}`,
    inputSchema: { ...tool.inputSchema, properties },
    outputSchema: {
      type: 'object', additionalProperties: true,
      required: ['messages', 'pagination', 'presentation'],
      properties: {
        messages: { type: 'array', items: { type: 'object', additionalProperties: true } },
        pagination: { type: 'object', additionalProperties: true },
        presentation: { type: 'object', additionalProperties: true },
        nextCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        nextPageCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        targetMessageId: { type: 'string' },
      },
    },
  }
}

function pick(value: Args, fields: string[]): Args {
  return Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))
}

function compactMessage(value: unknown): unknown {
  if (!isRecord(value)) return value
  const { senderAvatarUrl, senderProfileUrl, rawJson, search, ...message } = value
  if (isRecord(message.quote)) message.quote = pick(message.quote, ['messageId', 'sender', 'text'])
  if (Array.isArray(message.assets)) {
    message.assets = message.assets.map(asset => isRecord(asset)
      ? pick(asset, ['accountId', 'groupId', 'messageId', 'assetType', 'assetKey', 'url', 'title'])
      : asset)
  }
  return message
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
}

function resultWithValue(result: CallToolResult, value: Args): CallToolResult {
  return { ...result, structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorResult(code: string, error: string, extra: Args = {}): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code, error, ...extra }, null, 2) }] }
}

function tooLarge(message: unknown): CallToolResult {
  return errorResult('MESSAGE_TOO_LARGE', '单条消息或其详情超过列表24KB预算，列表未返回/跳过该条。请用 getMessagesBatch(keys=[返回的 messageKey]) 精确读取该条；普通查询保持 detail="compact"、raw="0"。', {
    messageKey: isRecord(message) ? pick(message, ['accountId', 'groupId', 'messageId']) : null,
  })
}

function bytes(result: CallToolResult): number {
  return Buffer.byteLength(result.content.map(block => block.type === 'text' ? block.text : '').join('\n'))
}

/** Paging owns output shape, never authorization or backend validation. */
export async function executeMessagePage(name: string, args: Args, execute: Execute, maxMessages: number): Promise<CallToolResult> {
  if (!MESSAGE_TOOLS.has(name)) return execute(args)
  const { detail = 'compact', pageSize = DEFAULT_PAGE_SIZE, pageCursor, ...rest } = args
  const full = detail === 'full' || rest.raw === '1'
  const presentation = {
    detail: full ? 'full' : 'compact',
    messageTextTruncated: false,
    ...(full ? {} : { omittedFields: ['senderAvatarUrl', 'senderProfileUrl', 'rawJson', 'search', 'assets.metadata', 'quote.nested', 'quote.quotedContent'], detailTool: 'getMessagesBatch' }),
    maxPageBytes: MAX_MESSAGE_PAGE_BYTES,
  }
  const project = (messages: unknown[]) => full ? messages : messages.map(compactMessage)
  if (name === 'getMessageContext') {
    rest.before ??= 5
    rest.after ??= 5
    rest.raw ??= '0'
    const scope = digest([rest.accountId, rest.groupId, rest.messageId, rest.before, rest.after, rest.raw, detail])
    let cursor: { scope: string; snapshot: string; offset: number } | undefined
    if (pageCursor !== undefined) {
      try {
        const value = JSON.parse(Buffer.from(String(pageCursor), 'base64url').toString('utf8'))
        if (!isRecord(value) || value.v !== 1 || value.scope !== scope || typeof value.snapshot !== 'string'
          || !Number.isSafeInteger(value.offset) || Number(value.offset) < 1) throw Error()
        cursor = { scope, snapshot: value.snapshot, offset: Number(value.offset) }
      } catch {
        throw new McpToolInputError('invalid pageCursor: reuse the returned context cursor with the same window and detail')
      }
    }
    const result = await execute(rest)
    if (result.isError || !result.structuredContent) return result
    const original = result.structuredContent
    const messages = original.messages as unknown[]
    const snapshot = digest(messages)
    if (cursor && (cursor.snapshot !== snapshot || cursor.offset >= messages.length)) {
      return errorResult('CONTEXT_PAGE_STALE', '上下文窗口已变化，不能可靠继续该游标；省略 pageCursor 从第一页重新读取。')
    }
    const start = cursor?.offset ?? 0
    let count = Math.min(Number(pageSize), maxMessages, messages.length - start)
    while (true) {
      const page = project(messages.slice(start, start + count))
      const end = start + count
      const nextPageCursor = end < messages.length
        ? Buffer.from(JSON.stringify({ v: 1, scope, snapshot, offset: end })).toString('base64url') : null
      const value = {
        ...original, messages: page, nextPageCursor, presentation,
        pagination: {
          scope: 'requested-context-window', complete: nextPageCursor === null, truncated: nextPageCursor !== null,
          returnedMessageCount: count, totalMessageCount: messages.length,
          targetIncluded: page.some(message => isRecord(message) && message.messageId === rest.messageId),
        },
      }
      const output = resultWithValue(result, value)
      if (bytes(output) <= MAX_MESSAGE_PAGE_BYTES) return output
      if (count <= 1) return tooLarge(messages[start])
      count--
    }
  }
  let limit = Math.min(Number(rest.limit ?? DEFAULT_PAGE_SIZE), maxMessages)
  if (name === 'getMessageWindow' && rest.beforeMessageId && rest.afterMessageId) {
    throw new McpToolInputError('beforeMessageId and afterMessageId are mutually exclusive; supply only one message ID')
  }
  // Retry the same backend cursor with a smaller limit, so its own next cursor
  // still starts immediately after every returned message (no client slicing).
  while (true) {
    const result = await execute({ ...rest, limit })
    if (result.isError || !result.structuredContent) return result
    const original = result.structuredContent
    const messages = original.messages as unknown[]
    const page = project(messages)
    let pagination: Args
    if (name === 'searchMessages') {
      const source = isRecord(original.pagination) ? original.pagination : {}
      const more = original.nextCursor !== null
      pagination = { ...source, complete: !more && source.complete !== false && source.truncated !== true,
        truncated: more || source.truncated === true, returnedMessageCount: messages.length }
    } else {
      const older = !rest.afterMessageId
      const anchor = messages[older ? 0 : messages.length - 1]
      pagination = {
        direction: older ? 'older' : 'newer', returnedMessageCount: messages.length,
        hasMore: messages.length < limit ? false : null,
        continuation: isRecord(anchor) ? {
          ...pick(rest, ['accountId', 'groupId', 'senderUid']), limit,
          [older ? 'beforeMessageId' : 'afterMessageId']: anchor.messageId,
        } : null,
      }
    }
    const output = resultWithValue(result, { ...original, messages: page, pagination, presentation })
    if (bytes(output) <= MAX_MESSAGE_PAGE_BYTES) return output
    if (limit <= 1) return tooLarge(messages[0])
    limit = Math.max(1, Math.floor(limit / 2))
  }
}
