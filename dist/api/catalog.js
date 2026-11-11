import document from '../contracts/openapi.json' with { type: 'json' };
import { buildMcpToolCatalog } from '../vendor/openapi-tools.js';
const QUERY_POLICY = { label: '查询', readOnly: true };
const WRITE_POLICIES = {
    export: { label: '导出任务', readOnly: false },
    monitor: { label: '监控设置', readOnly: false },
};
/** One policy controls exposure, host presentation and concurrency hints. */
export function archiveToolPolicy(tool) {
    if (tool.annotations?.readOnlyHint === true)
        return QUERY_POLICY;
    const capability = tool._meta?.['weibogroup/capability'];
    if (capability === 'export' || capability === 'monitor')
        return WRITE_POLICIES[capability];
    return undefined;
}
/** Operation discovery and side-effect policy come from the API contract. */
export function archiveToolCatalog() {
    const all = buildMcpToolCatalog(document);
    const operations = new Map([...all.operations].filter(([, operation]) => archiveToolPolicy(operation.tool)));
    return { operations, tools: [...operations.values()].map(operation => operation.tool) };
}
