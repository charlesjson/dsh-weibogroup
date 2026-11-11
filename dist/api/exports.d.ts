import type { Config } from '../config.js';
import type { McpToolCatalog } from '../vendor/openapi-tools.js';
export interface ExportDownload {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    coverage: {
        messageCount: number;
        truncated: boolean;
        failedAssetCount?: number;
    } | null;
    data: AsyncIterable<Uint8Array>;
    signal: AbortSignal;
    close(): Promise<void>;
}
/** A fixed, authenticated route and byte stream, never a model-supplied URL. */
export declare function openExportDownload(config: Config, catalog: McpToolCatalog, id: string, source: AbortSignal, fetchImpl?: typeof fetch): Promise<ExportDownload>;
