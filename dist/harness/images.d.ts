import type { Context } from '@deepseek-ai/cordis';
import type { ArchiveClient } from '../api/client.js';
import { type Config } from '../config.js';
/** Let the host MCP bridge prove vision support and admit durable image content. */
export declare function registerImageRead(ctx: Context, client: ArchiveClient, config: Config): void;
