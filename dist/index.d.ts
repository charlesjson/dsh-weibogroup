import type { Context } from '@deepseek-ai/cordis';
import { type Config } from './config.js';
export { Config } from './config.js';
export { archiveToolCatalog } from './api/catalog.js';
export declare const name = "weibo-group";
export declare const inject: string[];
export declare function apply(ctx: Context, config: Config): void;
