import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '../config.js';
export interface ArchiveClient {
    readonly tools: readonly Tool[];
    call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult>;
}
/** Framework-independent archive access; credentials stay inside this module. */
export declare function createArchiveClient(config: Config, fetchImpl?: typeof fetch): ArchiveClient;
