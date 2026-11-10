import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpToolCatalog } from './openapi-tools.js';
export declare const DEFAULT_MAX_AUTO_PAGINATED_MESSAGES = 2000;
export interface McpHttpExecutionOptions {
    apiBaseUrl: URL;
    apiToken: string;
    timeoutMs: number;
    maxResponseBytes: number;
    /** Maximum messages returned by the MCP adapter's chronological search aggregation. */
    maxAutoPaginatedMessages?: number;
    fetch?: typeof fetch;
}
export declare class McpToolInputError extends Error {
    constructor(message: string);
}
export declare function executeMcpTool(catalog: McpToolCatalog, toolName: string, args: Record<string, unknown>, options: McpHttpExecutionOptions): Promise<CallToolResult>;
