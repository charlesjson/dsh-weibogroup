import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client';
import { imageQuerySchema } from '../vendor/image-payload.js';
import { DEFAULT_IMAGE_TIMEOUT_MS } from '../config.js';
/** Let the host MCP bridge prove vision support and admit durable image content. */
export function registerImageRead(ctx, client, config) {
    const definition = createMcpToolDefinition(ctx, {
        name: 'weibo_readMessageImage',
        rawName: 'readMessageImage',
        description: 'Read one owned archived message image into durable Harness image content, using accountId/groupId/messageId and exact assetType/assetKey from message assets. Never supply an arbitrary URL. imageIndex selects an embedded picture; default 0. A vision-capable active model and the attachment store are required to actually see the image. If the host says image unavailable, report that limitation and never guess the picture. preview=true denotes a thumbnail. GIF admission can retain a static frame. Tokens and account cookies stay inside the client/server.',
        inputSchema: imageQuerySchema,
        call: (args, execution) => client.readImage({
            accountId: String(args.accountId),
            groupId: String(args.groupId),
            messageId: String(args.messageId),
            assetType: String(args.assetType),
            assetKey: String(args.assetKey),
            imageIndex: typeof args.imageIndex === 'number' ? args.imageIndex : 0,
        }, execution.signal),
    });
    definition.timeoutMs = config.imageTimeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS;
    definition.isConcurrencySafe = () => true;
    definition.presentCall = () => ({ card: 'generic', kind: 'read', title: '读取归档消息图片' });
    ctx.tools.register(definition);
}
