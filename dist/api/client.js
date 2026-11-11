import { executeMcpTool } from '../vendor/http-tools.js';
import { loadConnection } from './connection.js';
import { authenticatedFetch } from './transport.js';
import { archiveToolCatalog } from './catalog.js';
import { openExportDownload } from './exports.js';
/** Framework-independent archive access; credentials stay inside this module. */
export function createArchiveClient(config, fetchImpl) {
    const catalog = archiveToolCatalog();
    return {
        tools: catalog.tools,
        openExport: (id, signal) => openExportDownload(config, catalog, id, signal, fetchImpl),
        async call(name, args, signal) {
            signal.throwIfAborted();
            const connection = await loadConnection(config.connectionFile);
            signal.throwIfAborted();
            return executeMcpTool(catalog, name, args, {
                apiBaseUrl: connection.baseUrl, apiToken: connection.apiToken,
                timeoutMs: config.timeoutMs, maxResponseBytes: config.maxResponseBytes,
                maxAutoPaginatedMessages: Math.min(config.maxMessages, typeof args.limit === 'number' ? args.limit : 100),
                fetch: authenticatedFetch(connection.baseUrl, signal, fetchImpl),
            });
        },
    };
}
