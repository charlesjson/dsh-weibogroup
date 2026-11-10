import z from '@deepseek-ai/schemastery';
import { DEFAULT_CONNECTION_FILE } from './api/connection.js';
export const Config = z.object({
    connectionFile: z.string().default(DEFAULT_CONNECTION_FILE),
    timeoutMs: z.number().default(30_000),
    maxResponseBytes: z.number().default(4 * 1024 * 1024),
    maxMessages: z.number().default(1000),
});
export function validateConfig(config) {
    for (const [key, min, max] of [['timeoutMs', 100, 300000], ['maxResponseBytes', 1024, 67108864], ['maxMessages', 1, 10000]]) {
        if (!Number.isSafeInteger(config[key]) || config[key] < min || config[key] > max) {
            throw new Error(`dsh-weibogroup: ${key} must be an integer between ${min} and ${max}`);
        }
    }
}
