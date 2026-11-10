/**
 * Shared outbound HTTP adapter for integrations that need bounded response
 * memory and may optionally bound request lifetime. Callers receive response
 * metadata and a decoded body only after the complete body has passed the byte
 * limit.
 */
export type BoundedFetchFailureKind = 'timeout' | 'request_failed' | 'response_too_large' | 'response_read_failed';
export declare class BoundedFetchError extends Error {
    readonly kind: BoundedFetchFailureKind;
    readonly status?: number | undefined;
    readonly limit?: number | undefined;
    constructor(kind: BoundedFetchFailureKind, message: string, status?: number | undefined, limit?: number | undefined);
}
export interface BoundedFetchOptions {
    /** Omit or disable to wait without a wall-clock deadline. */
    timeoutMs?: number;
    maxResponseBytes: number;
    fetch?: typeof fetch;
    shouldReadBody?: (response: Response) => boolean;
}
export interface BoundedFetchResult {
    response: Response;
    responseText: string;
}
export declare function boundedFetch(input: string | URL, init: RequestInit, options: BoundedFetchOptions): Promise<BoundedFetchResult>;
