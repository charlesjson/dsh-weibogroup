import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '../config.js';
import { type MessageImageKey } from '../vendor/image-payload.js';
/** Read exactly one owner-bound archive image; neither URLs nor credentials are tool arguments. */
export declare function readArchiveImage(config: Config, key: MessageImageKey, caller: AbortSignal, fetchImpl?: typeof fetch): Promise<CallToolResult>;
