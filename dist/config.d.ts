import z from '@deepseek-ai/schemastery';
export interface Config {
    connectionFile: string;
    timeoutMs: number;
    maxResponseBytes: number;
    maxMessages: number;
}
export declare const Config: z<Config>;
export declare function validateConfig(config: Config): void;
