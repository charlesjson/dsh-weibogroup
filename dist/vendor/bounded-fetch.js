export class BoundedFetchError extends Error {
    kind;
    status;
    limit;
    constructor(kind, message, status, limit) {
        super(message);
        this.kind = kind;
        this.status = status;
        this.limit = limit;
        this.name = 'BoundedFetchError';
    }
}
function parseContentLength(value) {
    if (!value || !/^\d+$/.test(value))
        return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}
async function readBoundedResponse(response, maxBytes, timeoutPromise) {
    const declaredLength = parseContentLength(response.headers.get('content-length'));
    if (declaredLength !== undefined && declaredLength > maxBytes) {
        void response.body?.cancel().catch(() => undefined);
        throw new BoundedFetchError('response_too_large', `response exceeded ${maxBytes} bytes`, response.status, maxBytes);
    }
    if (!response.body)
        return '';
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const readResult = timeoutPromise
                ? await Promise.race([reader.read(), timeoutPromise])
                : await reader.read();
            const { done, value } = readResult;
            if (done)
                break;
            total += value.byteLength;
            if (total > maxBytes) {
                void reader.cancel().catch(() => undefined);
                throw new BoundedFetchError('response_too_large', `response exceeded ${maxBytes} bytes`, response.status, maxBytes);
            }
            chunks.push(value);
        }
        return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString('utf8');
    }
    catch (error) {
        void reader.cancel().catch(() => undefined);
        throw error;
    }
    finally {
        reader.releaseLock();
    }
}
export async function boundedFetch(input, init, options) {
    // An omitted, non-finite or non-positive timeout deliberately means that
    // the caller wants to keep waiting. This is used by the interactive LLM
    // analysis path, where a slow provider response is preferable to a local
    // timeout followed by a duplicate completion request.
    const hasTimeout = options.timeoutMs !== undefined
        && Number.isFinite(options.timeoutMs)
        && options.timeoutMs > 0;
    const controller = hasTimeout ? new AbortController() : undefined;
    let timedOut = false;
    let rejectTimeout;
    const timeoutPromise = hasTimeout
        ? new Promise((_resolve, reject) => {
            rejectTimeout = reject;
        })
        : undefined;
    const timeout = hasTimeout
        ? setTimeout(() => {
            timedOut = true;
            controller?.abort();
            rejectTimeout?.(new Error('bounded fetch timed out'));
        }, options.timeoutMs)
        : undefined;
    let response;
    try {
        const responsePromise = Promise.resolve().then(() => (options.fetch ?? fetch)(input, controller ? { ...init, signal: controller.signal } : init));
        response = timeoutPromise
            ? await Promise.race([responsePromise, timeoutPromise])
            : await responsePromise;
    }
    catch {
        if (timeout !== undefined)
            clearTimeout(timeout);
        if (timedOut) {
            throw new BoundedFetchError('timeout', `request timed out after ${options.timeoutMs} ms`);
        }
        throw new BoundedFetchError('request_failed', 'request failed before a response was received');
    }
    if (options.shouldReadBody && !options.shouldReadBody(response)) {
        void response.body?.cancel().catch(() => undefined);
        if (timeout !== undefined)
            clearTimeout(timeout);
        return { response, responseText: '' };
    }
    try {
        const responseText = await readBoundedResponse(response, options.maxResponseBytes, timeoutPromise);
        if (timeout !== undefined)
            clearTimeout(timeout);
        return { response, responseText };
    }
    catch (error) {
        if (timeout !== undefined)
            clearTimeout(timeout);
        if (timedOut) {
            throw new BoundedFetchError('timeout', `response body timed out after ${options.timeoutMs} ms`, response.status);
        }
        if (error instanceof BoundedFetchError)
            throw error;
        throw new BoundedFetchError('response_read_failed', 'response body could not be read', response.status);
    }
}
