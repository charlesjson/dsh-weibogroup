import { hostMethodsAvailable } from '../host-api.js'
import { registerImageRead } from './images.js'
import type { Context } from '@deepseek-ai/cordis'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import '@deepseek-ai/dsh-system-prompt'
import type { Config } from '../config.js'
import type { ArchiveClient } from '../api/client.js'
import { archiveToolPolicy } from '../api/catalog.js'
import { ARCHIVE_INSTRUCTIONS } from './instructions.js'
import { registerExportDownload } from './exports.js'

/** Host-only registration, presentation and lifecycle ownership. */
export function registerArchiveTools(ctx: Context, client: ArchiveClient, config: Config): void {
  ctx.systemPrompt.section({
    name: 'tool:weibogroup',
    order: 650,
    text: ({ scope }) => (ctx.tools.get('weibo_listAccounts', scope) ? ARCHIVE_INSTRUCTIONS : ''),
  })
  for (const tool of client.tools) {
    const policy = archiveToolPolicy(tool)
    if (!policy) continue
    const definition = createMcpToolDefinition(ctx, {
      name: `weibo_${tool.name}`,
      rawName: tool.name,
      description: `[微博群聊${policy.label}] ${tool.description ?? tool.name}`,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      call: (args, execution) => client.call(tool.name, args, execution.signal),
    })
    definition.timeoutMs = config.timeoutMs
    definition.isConcurrencySafe = () => policy.readOnly
    definition.presentCall = () => ({
      card: 'generic',
      kind: policy.readOnly ? 'read' : 'execute',
      title: `微博群聊 · ${tool.title ?? tool.name}`,
    })
    ctx.tools.register(definition)
  }
  ctx.inject(['attachments'], (fileCtx) => {
    if (!hostMethodsAvailable('dsh-weibogroup/attachments', fileCtx, ['attachments.saveFileStream'])) return
    registerExportDownload(fileCtx, client, config)
    registerImageRead(fileCtx, client, config)
  })
}
