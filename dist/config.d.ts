import z from '@deepseek-ai/schemastery';
export declare const DEFAULT_EXPORT_TIMEOUT_MS = 120000;
export declare const DEFAULT_MAX_EXPORT_BYTES: number;
export interface Config {
    connectionFile: string;
    timeoutMs: number;
    maxResponseBytes: number;
    maxMessages: number;
    exportTimeoutMs?: number;
    maxExportBytes?: number;
}
export declare const Config: z<Config>;
export declare function validateConfig(config: Config): void;
