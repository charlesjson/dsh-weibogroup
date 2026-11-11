import type { Context } from '@deepseek-ai/cordis';
import type { ArchiveClient } from '../api/client.js';
import { type Config } from '../config.js';
/** Publish downloaded bytes as a durable native file attachment. */
export declare function registerExportDownload(ctx: Context, client: ArchiveClient, config: Config): void;
