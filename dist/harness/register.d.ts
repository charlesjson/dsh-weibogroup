import type { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/dsh-system-prompt';
import type { Config } from '../config.js';
import type { ArchiveClient } from '../api/client.js';
/** Host-only registration, presentation and lifecycle ownership. */
export declare function registerArchiveTools(ctx: Context, client: ArchiveClient, config: Config): void;
