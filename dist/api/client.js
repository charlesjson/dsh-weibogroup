import { executeMcpTool } from '../vendor/http-tools.js';
import { createApiSession } from './session.js';
import { archiveToolCatalog } from './catalog.js';
import { openExportDownload } from './exports.js';
/** Framework-independent archive access; credentials stay inside this module. */
export function createArchiveClient(config, fetchImpl) {
    const catalog = archiveToolCatalog();
    return {
        tools: catalog.tools,
        openExport: (id, signal) => openExportDownload(config, catalog, id, signal, fetchImpl),
        async call(name, args, signal) {
            const session = await createApiSession(config, signal, fetchImpl);
            return executeMcpTool(catalog, name, args, {
                ...session,
                maxAutoPaginatedMessages: Math.min(config.maxMessages, typeof args.limit === 'number' ? args.limit : 100),
            });
        },
    };
}
