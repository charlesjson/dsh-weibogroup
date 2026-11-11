import type { Tool } from '@modelcontextprotocol/sdk/types.js';
/** One policy controls exposure, host presentation and concurrency hints. */
export declare function archiveToolPolicy(tool: Tool): {
    readonly label: "查询";
    readonly readOnly: true;
} | {
    readonly label: "导出任务";
    readonly readOnly: false;
} | {
    readonly label: "监控设置";
    readonly readOnly: false;
} | {
    readonly label: "采集任务";
    readonly readOnly: false;
} | undefined;
/** Operation discovery and side-effect policy come from the API contract. */
export declare function archiveToolCatalog(): {
    operations: Map<string, import("../vendor/openapi-tools.js").McpToolOperation>;
    tools: {
        inputSchema: {
            [x: string]: unknown;
            type: "object";
            properties?: {
                [x: string]: object;
            } | undefined;
            required?: string[] | undefined;
        };
        name: string;
        description?: string | undefined;
        outputSchema?: {
            [x: string]: unknown;
            type: "object";
            properties?: {
                [x: string]: object;
            } | undefined;
            required?: string[] | undefined;
        } | undefined;
        annotations?: {
            title?: string | undefined;
            readOnlyHint?: boolean | undefined;
            destructiveHint?: boolean | undefined;
            idempotentHint?: boolean | undefined;
            openWorldHint?: boolean | undefined;
        } | undefined;
        execution?: {
            taskSupport?: "optional" | "required" | "forbidden" | undefined;
        } | undefined;
        _meta?: {
            [x: string]: unknown;
        } | undefined;
        icons?: {
            src: string;
            mimeType?: string | undefined;
            sizes?: string[] | undefined;
            theme?: "light" | "dark" | undefined;
        }[] | undefined;
        title?: string | undefined;
    }[];
};
