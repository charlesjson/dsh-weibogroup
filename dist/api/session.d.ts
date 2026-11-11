import type { Config } from '../config.js';
/** One credential snapshot and cancellation scope for a complete API operation. */
export declare function createApiSession(config: Config, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<{
    apiBaseUrl: URL;
    apiToken: string;
    timeoutMs: number;
    maxResponseBytes: number;
    fetch: typeof fetch;
}>;
