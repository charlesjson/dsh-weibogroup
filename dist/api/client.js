import { executeMcpTool } from '../vendor/http-tools.js';
import { loadConnection } from './connection.js';
import { authenticatedFetch } from './transport.js';
import { readOnlyCatalog } from './catalog.js';
/** Framework-independent archive access; credentials stay inside this module. */
export function createArchiveClient(config, fetchImpl) {
    const catalog = readOnlyCatalog();
    return {
        tools: catalog.tools,
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
