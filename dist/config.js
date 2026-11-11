import z from '@deepseek-ai/schemastery';
import { DEFAULT_CONNECTION_FILE } from './api/connection.js';
export const DEFAULT_EXPORT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_EXPORT_BYTES = 64 * 1024 * 1024;
export const Config = z.object({
    connectionFile: z.string().default(DEFAULT_CONNECTION_FILE),
    timeoutMs: z.number().default(30_000),
    maxResponseBytes: z.number().default(4 * 1024 * 1024),
    maxMessages: z.number().default(1000),
    exportTimeoutMs: z.number().default(DEFAULT_EXPORT_TIMEOUT_MS),
    maxExportBytes: z.number().default(DEFAULT_MAX_EXPORT_BYTES),
});
export function validateConfig(config) {
    for (const [key, min, max] of [['timeoutMs', 100, 300000], ['maxResponseBytes', 1024, 67108864], ['maxMessages', 1, 10000]]) {
        if (!Number.isSafeInteger(config[key]) || config[key] < min || config[key] > max) {
            throw new Error(`dsh-weibogroup: ${key} must be an integer between ${min} and ${max}`);
        }
    }
    for (const [key, min, max] of [['exportTimeoutMs', 1000, 600000], ['maxExportBytes', 1, 512 * 1024 * 1024]]) {
        if (config[key] !== undefined && (!Number.isSafeInteger(config[key]) || config[key] < min || config[key] > max)) {
            throw new Error(`dsh-weibogroup: ${key} must be an integer between ${min} and ${max}`);
        }
    }
}
