import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const MAX_MESSAGE_PAGE_BYTES = 24000;
type Args = Record<string, unknown>;
type Execute = (args: Args) => Promise<CallToolResult>;
/** Only the Harness-facing catalog changes; REST contracts and validators stay intact. */
export declare function messagePageTool(tool: Tool): Tool;
/** Paging owns output shape, never authorization or backend validation. */
export declare function executeMessagePage(name: string, args: Args, execute: Execute, maxMessages: number): Promise<CallToolResult>;
export {};
