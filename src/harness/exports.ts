import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ArchiveClient } from '../api/client.js'
import { DEFAULT_EXPORT_TIMEOUT_MS, type Config } from '../config.js'

/** Publish downloaded bytes as a durable native file attachment. */
export function registerExportDownload(ctx: Context, client: ArchiveClient, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'weibo_downloadExport',
    description: 'Download a ready owned export into a durable Harness file attachment. Pass the id from createMessageExport/createUserExport or getExportJob. The Token stays inside the plugin; no URL, credentials, file path or binary/base64 argument is needed. Check getExportJob.result.truncated and failedAssetCount before describing the export as complete.',
    parameters: { id: { type: 'string', required: true, description: 'Export job UUID returned by the archive API.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', required: true }, contentType: { type: 'string', required: true },
        coverage: { required: true, oneOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, properties: {
          messageCount: { type: 'integer', required: true }, truncated: { type: 'boolean', required: true }, failedAssetCount: { type: 'integer' },
        } }] },
        attachment: { type: 'object', required: true, additionalProperties: false, properties: {
          attachmentId: { type: 'string', required: true }, name: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
        } },
      } },
      render: (_args, value) => {
        const coverage = value.coverage ? `${value.coverage.messageCount} 条消息；${value.coverage.truncated ? '达到条数上限，结果已截断' : '未触及条数上限'}${value.coverage.failedAssetCount ? `；${value.coverage.failedAssetCount} 个附件获取失败` : ''}` : '旧任务未记录覆盖信息，完整性未知'
        return [
          { type: 'text', text: `导出文件已下载：${value.attachment.name}（${value.attachment.bytes} 字节）。${coverage}` },
          { type: 'file', attachment: { ...value.attachment, attachmentId: AttachmentId(value.attachment.attachmentId) } },
        ]
      },
    },
    async execute(args, execution) {
      const download = await client.openExport(args.id, execution.signal)
      try {
        const attachment = await ctx.attachments.saveFileStream({ data: download.data, signal: download.signal, name: download.filename })
        return { id: args.id, contentType: download.contentType, coverage: download.coverage, attachment }
      } finally { await download.close() }
    },
    timeoutMs: config.exportTimeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS,
    presentCall: () => ({ card: 'generic', kind: 'read', title: '下载微博群聊导出文件' }),
  }))
}
