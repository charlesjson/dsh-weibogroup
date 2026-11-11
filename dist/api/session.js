import { loadConnection } from './connection.js';
import { authenticatedFetch } from './transport.js';
/** One credential snapshot and cancellation scope for a complete API operation. */
export async function createApiSession(config, signal, fetchImpl) {
    signal.throwIfAborted();
    const connection = await loadConnection(config.connectionFile);
    signal.throwIfAborted();
    return {
        apiBaseUrl: connection.baseUrl,
        apiToken: connection.apiToken,
        timeoutMs: config.timeoutMs,
        maxResponseBytes: config.maxResponseBytes,
        fetch: authenticatedFetch(connection.baseUrl, signal, fetchImpl),
    };
}
