import { boundedFetch, BoundedFetchError } from './bounded-fetch.js';
import { isRecord } from './helpers.js';
const JSON_CONTENT_TYPE = 'application/json';
const UPSTREAM_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
export const DEFAULT_MAX_AUTO_PAGINATED_MESSAGES = 2_000;
const MAX_AUTO_PAGINATION_PAGES = 256;
export class McpToolInputError extends Error {
    constructor(message) {
        super(message);
        this.name = 'McpToolInputError';
    }
}
function ensureExecutionOptions(options) {
    if (options.apiBaseUrl.protocol !== 'http:' && options.apiBaseUrl.protocol !== 'https:') {
        throw new McpToolInputError('apiBaseUrl must use http or https');
    }
    if (!options.apiToken.trim())
        throw new McpToolInputError('apiToken must not be blank');
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
        throw new McpToolInputError('timeoutMs must be a positive safe integer');
    }
    if (!Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes <= 0) {
        throw new McpToolInputError('maxResponseBytes must be a positive safe integer');
    }
    if (options.maxAutoPaginatedMessages !== undefined
        && (!Number.isSafeInteger(options.maxAutoPaginatedMessages) || options.maxAutoPaginatedMessages <= 0)) {
        throw new McpToolInputError('maxAutoPaginatedMessages must be a positive safe integer');
    }
}
function scalarToString(value, name) {
    if (typeof value === 'string')
        return value;
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    throw new McpToolInputError(`argument ${name} must be a string, finite number, or boolean`);
}
function pathArgumentToString(value, name) {
    const rendered = scalarToString(value, name);
    if (rendered === '.' || rendered === '..') {
        throw new McpToolInputError(`unsafe dot-segment path argument: ${name}`);
    }
    return rendered;
}
function operationUrl(baseUrl, operation, args) {
    let route = operation.routePath;
    for (const binding of operation.arguments) {
        if (binding.location !== 'path')
            continue;
        const value = args[binding.name];
        if (value === undefined)
            throw new McpToolInputError(`required path argument is missing: ${binding.name}`);
        route = route.split(`{${binding.name}}`).join(encodeURIComponent(pathArgumentToString(value, binding.name)));
    }
    if (/\{[^{}]+\}/.test(route))
        throw new McpToolInputError(`unresolved route parameter in ${operation.routePath}`);
    const normalizedBase = new URL(baseUrl.toString());
    normalizedBase.search = '';
    normalizedBase.hash = '';
    if (!normalizedBase.pathname.endsWith('/'))
        normalizedBase.pathname += '/';
    const url = new URL(route.replace(/^\/+/, ''), normalizedBase);
    const expectedPathPrefix = `${normalizedBase.pathname}api/v1/`;
    if (url.origin !== normalizedBase.origin || !url.pathname.startsWith(expectedPathPrefix)) {
        throw new McpToolInputError(`resolved route escaped the configured AI API prefix: ${operation.routePath}`);
    }
    for (const binding of operation.arguments) {
        if (binding.location !== 'query')
            continue;
        const value = args[binding.name];
        if (value === undefined)
            continue;
        appendQueryArgument(url.searchParams, binding, value);
    }
    return url;
}
function appendQueryArgument(params, binding, value) {
    if (!Array.isArray(value)) {
        params.append(binding.name, scalarToString(value, binding.name));
        return;
    }
    const values = value.map((item) => scalarToString(item, binding.name));
    if (binding.explode === false) {
        params.append(binding.name, values.join(','));
        return;
    }
    for (const item of values)
        params.append(binding.name, item);
}
function requestBody(operation, args) {
    if (!operation.hasRequestBody)
        return undefined;
    const body = {};
    for (const binding of operation.arguments) {
        if (binding.location !== 'body')
            continue;
        const value = args[binding.name];
        if (value !== undefined)
            body[binding.name] = value;
    }
    return body;
}
function textResult(operation, status, value, isError) {
    const errorCode = isError && typeof value.code === 'string' ? value.code : undefined;
    return {
        content: [{ type: 'text', text: JSON.stringify(value) }],
        ...(isError ? {} : { structuredContent: value }),
        ...(isError ? { isError: true } : {}),
        _meta: {
            operationId: operation.name,
            ...(status === undefined ? {} : { httpStatus: status }),
            ...(errorCode ? { errorCode } : {}),
        },
    };
}
function adapterError(operation, code, error, status) {
    return textResult(operation, status, { code, error }, true);
}
function parseJson(text) {
    return JSON.parse(text);
}
function upstreamHttpError(operation, response, responseText) {
    let code = 'UPSTREAM_HTTP_ERROR';
    try {
        const parsed = parseJson(responseText);
        if (isRecord(parsed) && typeof parsed.code === 'string' && UPSTREAM_ERROR_CODE_PATTERN.test(parsed.code)) {
            code = parsed.code;
        }
    }
    catch {
        // A reverse proxy may return plain text/HTML. Never forward that body to the AI client.
    }
    return adapterError(operation, code, `REST API returned HTTP ${response.status}`, response.status);
}
function isChronologicalMessageSearch(operation, args) {
    if (operation.name !== 'searchMessages'
        || operation.method !== 'GET'
        || operation.routePath !== '/api/v1/messages')
        return false;
    if (args.raw === '1')
        return false;
    if (args.sort === 'relevance')
        return false;
    return args.searchMode === undefined || args.searchMode === 'lexical';
}
function messagePageValue(value, operation, status) {
    if (!Array.isArray(value.messages)
        || (value.nextCursor !== null && typeof value.nextCursor !== 'string')
        || !Object.hasOwn(value, 'nextCursor')) {
        return {
            error: adapterError(operation, 'UPSTREAM_INVALID_RESPONSE', 'REST API message search response did not contain a valid nextCursor', status),
        };
    }
    const sourcePagination = value.pagination;
    return {
        messages: value.messages,
        nextCursor: value.nextCursor,
        search: value.search ?? null,
        sourceTruncated: isRecord(sourcePagination) && sourcePagination.truncated === true,
        sourceIncomplete: isRecord(sourcePagination) && sourcePagination.complete === false,
    };
}
function supportsPaginationMetadata(operation) {
    const outputSchema = operation.tool.outputSchema;
    const properties = isRecord(outputSchema) ? outputSchema.properties : undefined;
    return isRecord(properties) && Object.hasOwn(properties, 'pagination');
}
function buildAggregatedMessagePage(template, messages, nextCursor, pagesFetched, truncated, includePagination) {
    const aggregate = {
        ...template,
        messages,
        nextCursor,
    };
    if (includePagination)
        aggregate.pagination = {
            complete: !truncated && nextCursor === null,
            pagesFetched,
            returnedMessageCount: messages.length,
            truncated,
        };
    return aggregate;
}
async function executeSingleMcpTool(operation, args, options) {
    const url = operationUrl(options.apiBaseUrl, operation, args);
    const body = requestBody(operation, args);
    let serializedBody;
    try {
        serializedBody = body === undefined ? undefined : JSON.stringify(body);
    }
    catch {
        throw new McpToolInputError(`arguments for ${operation.name} are not JSON serializable`);
    }
    let response;
    let responseText;
    try {
        ({ response, responseText } = await boundedFetch(url, {
            method: operation.method,
            headers: {
                accept: JSON_CONTENT_TYPE,
                authorization: `Bearer ${options.apiToken}`,
                ...(serializedBody === undefined ? {} : { 'content-type': JSON_CONTENT_TYPE }),
            },
            ...(serializedBody === undefined ? {} : { body: serializedBody }),
        }, {
            timeoutMs: options.timeoutMs,
            maxResponseBytes: options.maxResponseBytes,
            fetch: options.fetch,
        }));
    }
    catch (error) {
        if (error instanceof BoundedFetchError && error.kind === 'timeout') {
            return {
                ok: false,
                result: adapterError(operation, 'UPSTREAM_TIMEOUT', `REST API did not finish responding within ${options.timeoutMs} ms`, error.status),
            };
        }
        if (error instanceof BoundedFetchError && error.kind === 'response_too_large') {
            return {
                ok: false,
                result: adapterError(operation, 'UPSTREAM_RESPONSE_TOO_LARGE', `REST API response exceeded ${error.limit ?? options.maxResponseBytes} bytes`, error.status),
            };
        }
        if (error instanceof BoundedFetchError && error.kind === 'request_failed') {
            return {
                ok: false,
                result: adapterError(operation, 'UPSTREAM_UNREACHABLE', 'REST API request failed before a response was received'),
            };
        }
        return {
            ok: false,
            result: adapterError(operation, 'UPSTREAM_RESPONSE_READ_FAILED', 'REST API response could not be read', error instanceof BoundedFetchError ? error.status : undefined),
        };
    }
    if (!response.ok)
        return { ok: false, result: upstreamHttpError(operation, response, responseText) };
    let parsed;
    try {
        parsed = parseJson(responseText);
    }
    catch {
        return {
            ok: false,
            result: adapterError(operation, 'UPSTREAM_INVALID_JSON', 'REST API returned a non-JSON success response', response.status),
        };
    }
    if (!isRecord(parsed)) {
        return {
            ok: false,
            result: adapterError(operation, 'UPSTREAM_INVALID_RESPONSE', 'REST API success response must be a JSON object', response.status),
        };
    }
    const outputValidation = operation.validateOutput?.(parsed);
    if (outputValidation && !outputValidation.valid) {
        return {
            ok: false,
            result: adapterError(operation, 'UPSTREAM_INVALID_RESPONSE', 'REST API success response did not match the advertised output schema', response.status),
        };
    }
    return {
        ok: true,
        page: {
            status: response.status,
            value: outputValidation?.data ?? parsed,
        },
    };
}
async function executeAutoPaginatedMessageSearch(operation, initialArgs, options) {
    const maximumMessages = options.maxAutoPaginatedMessages ?? DEFAULT_MAX_AUTO_PAGINATED_MESSAGES;
    const maximumPages = Math.min(MAX_AUTO_PAGINATION_PAGES, Math.max(1, maximumMessages));
    const messages = [];
    let messageBodyBytes = 0;
    const seenCursors = new Set();
    let requestCursor = typeof initialArgs.cursor === 'string'
        ? initialArgs.cursor
        : undefined;
    let nextCursor = null;
    let pagesFetched = 0;
    let sourceTruncated = false;
    let template;
    let lastStatus;
    const deadline = Date.now() + options.timeoutMs;
    const requestedPageLimit = typeof initialArgs.limit === 'number' ? initialArgs.limit : 100;
    const pageLimit = Math.max(1, Math.min(requestedPageLimit, maximumMessages));
    const includePagination = supportsPaginationMetadata(operation);
    while (true) {
        const remainingTimeoutMs = deadline - Date.now();
        if (remainingTimeoutMs <= 0) {
            return adapterError(operation, 'UPSTREAM_TIMEOUT', 'MCP pagination exceeded its end-to-end deadline');
        }
        const pageOptions = remainingTimeoutMs < options.timeoutMs
            ? { ...options, timeoutMs: remainingTimeoutMs }
            : options;
        const pageArgs = { ...initialArgs };
        const remainingPageLimit = Math.min(pageLimit, maximumMessages - messages.length);
        if (remainingPageLimit !== initialArgs.limit)
            pageArgs.limit = remainingPageLimit;
        if (requestCursor === undefined)
            delete pageArgs.cursor;
        else
            pageArgs.cursor = requestCursor;
        const pageExecution = await executeSingleMcpTool(operation, pageArgs, pageOptions);
        if (!pageExecution.ok) {
            return pageExecution.result;
        }
        lastStatus = pageExecution.page.status;
        const page = messagePageValue(pageExecution.page.value, operation, pageExecution.page.status);
        if ('error' in page)
            return page.error;
        pagesFetched += 1;
        sourceTruncated = sourceTruncated || page.sourceTruncated;
        if (page.sourceIncomplete && page.nextCursor === null)
            sourceTruncated = true;
        template ??= { ...pageExecution.page.value, search: page.search };
        if (messages.length + page.messages.length > maximumMessages) {
            if (messages.length === 0) {
                return adapterError(operation, 'MCP_MESSAGE_LIMIT_EXCEEDED', `Chronological search page exceeds the MCP message limit of ${maximumMessages}`, lastStatus);
            }
            nextCursor = requestCursor ?? null;
            sourceTruncated = true;
            break;
        }
        // Serialize each page once. Re-serializing the complete accumulated history
        // on every iteration makes a many-page walk quadratic in output bytes.
        const pageBodyBytes = Buffer.byteLength(JSON.stringify(page.messages), 'utf8') - 2;
        const candidateBodyBytes = messageBodyBytes + pageBodyBytes
            + (messages.length > 0 && page.messages.length > 0 ? 1 : 0);
        const emptyAggregate = buildAggregatedMessagePage(template, [], page.nextCursor, pagesFetched, sourceTruncated, includePagination);
        if (Buffer.byteLength(JSON.stringify(emptyAggregate), 'utf8') + candidateBodyBytes > options.maxResponseBytes) {
            if (messages.length === 0) {
                return adapterError(operation, 'UPSTREAM_RESPONSE_TOO_LARGE', `Aggregated REST response exceeded ${options.maxResponseBytes} bytes`, lastStatus);
            }
            nextCursor = requestCursor ?? null;
            sourceTruncated = true;
            break;
        }
        messages.push(...page.messages);
        messageBodyBytes = candidateBodyBytes;
        nextCursor = page.nextCursor;
        if (nextCursor === null)
            break;
        if (seenCursors.has(nextCursor)) {
            return adapterError(operation, 'MCP_PAGINATION_STALLED', 'REST API returned a repeated message cursor', lastStatus);
        }
        seenCursors.add(nextCursor);
        if (messages.length >= maximumMessages || pagesFetched >= maximumPages) {
            sourceTruncated = true;
            break;
        }
        requestCursor = nextCursor;
    }
    const aggregate = buildAggregatedMessagePage(template ?? { search: null }, messages, nextCursor, pagesFetched, sourceTruncated, includePagination);
    const outputValidation = operation.validateOutput?.(aggregate);
    if (outputValidation && !outputValidation.valid) {
        return adapterError(operation, 'UPSTREAM_INVALID_RESPONSE', 'Aggregated REST message search response did not match the advertised output schema', lastStatus);
    }
    return textResult(operation, lastStatus, outputValidation?.data ?? aggregate, false);
}
export async function executeMcpTool(catalog, toolName, args, options) {
    ensureExecutionOptions(options);
    const operation = catalog.operations.get(toolName);
    if (!operation)
        throw new McpToolInputError(`unknown tool: ${toolName}`);
    const validation = operation.validateArguments(args);
    if (!validation.valid) {
        throw new McpToolInputError(`invalid arguments for ${toolName}: ${validation.errorMessage}`);
    }
    if (isChronologicalMessageSearch(operation, validation.data)) {
        return executeAutoPaginatedMessageSearch(operation, validation.data, options);
    }
    const pageExecution = await executeSingleMcpTool(operation, validation.data, options);
    return pageExecution.ok
        ? textResult(operation, pageExecution.page.status, pageExecution.page.value, false)
        : pageExecution.result;
}
