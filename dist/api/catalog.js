import document from '../contracts/openapi.json' with { type: 'json' };
import { buildMcpToolCatalog } from '../vendor/openapi-tools.js';
/** Operation discovery and side-effect policy come from the API contract. */
export function readOnlyCatalog() {
    const all = buildMcpToolCatalog(document);
    const operations = new Map([...all.operations].filter(([, operation]) => operation.tool.annotations?.readOnlyHint === true));
    return { operations, tools: [...operations.values()].map(operation => operation.tool) };
}
