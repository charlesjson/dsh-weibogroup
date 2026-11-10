import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { JsonSchemaValidator } from '@modelcontextprotocol/sdk/validation';
declare const HTTP_METHODS: readonly ["get", "post", "put", "patch", "delete"];
type HttpMethodName = (typeof HTTP_METHODS)[number];
export type McpHttpMethod = Uppercase<HttpMethodName>;
export type McpArgumentLocation = 'path' | 'query' | 'body';
export interface McpArgumentBinding {
    name: string;
    location: McpArgumentLocation;
    required: boolean;
    style?: string;
    explode?: boolean;
}
export interface McpToolOperation {
    name: string;
    method: McpHttpMethod;
    routePath: string;
    arguments: readonly McpArgumentBinding[];
    hasRequestBody: boolean;
    tool: Tool;
    validateArguments: JsonSchemaValidator<Record<string, unknown>>;
    validateOutput?: JsonSchemaValidator<Record<string, unknown>>;
}
export interface McpToolCatalog {
    tools: Tool[];
    operations: ReadonlyMap<string, McpToolOperation>;
}
export declare class McpCatalogError extends Error {
    constructor(message: string);
}
export declare function buildMcpToolCatalog(document: unknown): McpToolCatalog;
export {};
