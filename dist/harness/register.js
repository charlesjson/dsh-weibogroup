import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client';
import '@deepseek-ai/dsh-system-prompt';
import { archiveToolPolicy } from '../api/catalog.js';
import { ARCHIVE_INSTRUCTIONS } from './instructions.js';
import { registerExportDownload } from './exports.js';
/** Host-only registration, presentation and lifecycle ownership. */
export function registerArchiveTools(ctx, client, config) {
    ctx.systemPrompt.section({
        name: 'tool:weibogroup', order: 650,
        text: ({ scope }) => ctx.tools.get('weibo_listAccounts', scope) ? ARCHIVE_INSTRUCTIONS : '',
    });
    for (const tool of client.tools) {
        const policy = archiveToolPolicy(tool);
        if (!policy)
            continue;
        const definition = createMcpToolDefinition(ctx, {
            name: `weibo_${tool.name}`, rawName: tool.name,
            description: `[微博群聊${policy.label}] ${tool.description ?? tool.name}`
                + (tool.name === 'searchMessages' ? '\nHarness 每次只读取请求的一页，limit=10 最多返回10条；完整统计请使用服务端 timeline，确需更多原文时显式继续 nextCursor。' : ''),
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            call: (args, execution) => client.call(tool.name, args, execution.signal),
        });
        definition.timeoutMs = config.timeoutMs;
        definition.isConcurrencySafe = () => policy.readOnly;
        definition.presentCall = () => ({ card: 'generic', kind: policy.readOnly ? 'read' : 'execute', title: `微博群聊 · ${tool.title ?? tool.name}` });
        ctx.tools.register(definition);
    }
    ctx.inject(['attachments'], fileCtx => registerExportDownload(fileCtx, client, config));
}
