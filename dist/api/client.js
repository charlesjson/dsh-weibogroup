import { readArchiveImage } from './images.js';
import { executeMcpTool } from '../vendor/http-tools.js';
import { createApiSession } from './session.js';
import { archiveToolCatalog } from './catalog.js';
import { openExportDownload } from './exports.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { McpToolInputError } from '../vendor/http-tools.js';
import { executeMessagePage, messagePageTool } from './message-pages.js';
/** Framework-independent archive access; credentials stay inside this module. */
export function createArchiveClient(config, fetchImpl) {
    const catalog = archiveToolCatalog();
    const tools = catalog.tools.map(messagePageTool);
    const validator = new AjvJsonSchemaValidator();
    const validators = new Map(tools.filter((tool, index) => tool !== catalog.tools[index])
        .map(tool => [tool.name, validator.getValidator(tool.inputSchema)]));
    return {
        tools,
        readImage: (key, signal) => readArchiveImage(config, key, signal, fetchImpl),
        openExport: (id, signal) => openExportDownload(config, catalog, id, signal, fetchImpl),
        async call(name, args, signal) {
            const validation = validators.get(name)?.(args);
            if (validation && !validation.valid) {
                throw new McpToolInputError(`invalid arguments for ${name}: ${validation.errorMessage}`);
            }
            args = validation?.data ?? args;
            const deadline = Date.now() + config.timeoutMs;
            const session = await createApiSession(config, signal, fetchImpl);
            return executeMessagePage(name, args, pageArgs => {
                signal.throwIfAborted();
                const remaining = deadline - Date.now();
                if (remaining <= 0)
                    return Promise.resolve({ isError: true,
                        content: [{ type: 'text', text: JSON.stringify({ code: 'UPSTREAM_TIMEOUT', error: 'Message paging exceeded its end-to-end deadline' }) }],
                    });
                return executeMcpTool(catalog, name, pageArgs, {
                    ...session,
                    timeoutMs: remaining,
                    maxAutoPaginatedMessages: Math.min(config.maxMessages, typeof pageArgs.limit === 'number' ? pageArgs.limit : 100),
                });
            }, config.maxMessages);
        },
    };
}
