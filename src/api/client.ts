import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import type { Config } from '../config.js'
import { executeMcpTool } from '../vendor/http-tools.js'
import { createApiSession } from './session.js'
import { archiveToolCatalog } from './catalog.js'
import { openExportDownload, type ExportDownload } from './exports.js'

export interface ArchiveClient {
  readonly tools: readonly Tool[]
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult>
  openExport(id: string, signal: AbortSignal): Promise<ExportDownload>
}

/** Framework-independent archive access; credentials stay inside this module. */
export function createArchiveClient(config: Config, fetchImpl?: typeof fetch): ArchiveClient {
  const catalog = archiveToolCatalog()
  return {
    tools: catalog.tools,
    openExport: (id, signal) => openExportDownload(config, catalog, id, signal, fetchImpl),
    async call(name, args, signal) {
      const session = await createApiSession(config, signal, fetchImpl)
      return executeMcpTool(catalog, name, args, {
        ...session,
        maxAutoPaginatedMessages: Math.min(config.maxMessages, typeof args.limit === 'number' ? args.limit : 100),
      })
    },
  }
}
