import { DEFAULT_EXPORT_TIMEOUT_MS, DEFAULT_MAX_EXPORT_BYTES } from '../config.js';
import { executeMcpTool } from '../vendor/http-tools.js';
import { isRecord } from '../vendor/helpers.js';
import { createApiSession } from './session.js';
/** A fixed, authenticated route and byte stream, never a model-supplied URL. */
export async function openExportDownload(config, catalog, id, source, fetchImpl) {
    source.throwIfAborted();
    const signal = AbortSignal.any([source, AbortSignal.timeout(config.exportTimeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS)]);
    const session = await createApiSession(config, signal, fetchImpl);
    const result = await executeMcpTool(catalog, 'getExportJob', { id }, session);
    if (result.isError)
        throw new Error(result.content.filter(block => block.type === 'text').map(block => block.text).join('\n'));
    const job = result.structuredContent?.job;
    if (!isRecord(job))
        throw new Error('EXPORT_INVALID_METADATA');
    if (job.id !== id)
        throw new Error('EXPORT_JOB_MISMATCH');
    if (job.status === 'failed')
        throw new Error(`EXPORT_JOB_FAILED: ${typeof job.errorCode === 'string' && /^[A-Z0-9_]+$/.test(job.errorCode) ? job.errorCode : 'EXPORT_FAILED'}`);
    if (job.status !== 'ready')
        throw new Error('EXPORT_NOT_READY: 请先查询任务状态，等待 ready 后下载。');
    const { filename, contentType, size } = job;
    if (typeof filename !== 'string' || !filename || filename.length > 512 || typeof contentType !== 'string'
        || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0)
        throw new Error('EXPORT_INVALID_METADATA');
    const maximum = config.maxExportBytes ?? DEFAULT_MAX_EXPORT_BYTES;
    const expectedBytes = size;
    const summary = job.result;
    const coverage = isRecord(summary) && typeof summary.messageCount === 'number' && typeof summary.truncated === 'boolean'
        ? { messageCount: summary.messageCount, truncated: summary.truncated,
            ...(typeof summary.failedAssetCount === 'number' ? { failedAssetCount: summary.failedAssetCount } : {}) } : null;
    if (size > maximum)
        throw new Error(`EXPORT_TOO_LARGE: 文件超过下载上限 ${maximum} 字节，请缩小导出范围。`);
    const base = new URL(session.apiBaseUrl);
    base.pathname = base.pathname.replace(/\/+$/, '') + '/';
    const url = new URL(`api/v1/exports/${encodeURIComponent(id)}/download`, base);
    const response = await session.fetch(url, { headers: { authorization: `Bearer ${session.apiToken}`, accept: contentType, 'accept-encoding': 'identity' } });
    const close = async () => { await response.body?.cancel().catch(() => undefined); };
    if (!response.ok) {
        await close();
        throw new Error(`EXPORT_DOWNLOAD_FAILED: HTTP ${response.status}`);
    }
    const actualType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    const expectedType = contentType.split(';')[0]?.trim().toLowerCase();
    const declared = response.headers.get('content-length');
    const encoding = response.headers.get('content-encoding')?.toLowerCase();
    if (actualType !== expectedType && actualType !== 'application/octet-stream') {
        await close();
        throw new Error('EXPORT_CONTENT_TYPE_MISMATCH');
    }
    // Fetch exposes decoded bytes; a transforming proxy's wire length can differ.
    if ((!encoding || encoding === 'identity') && declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== size)) {
        await close();
        throw new Error('EXPORT_SIZE_MISMATCH');
    }
    async function* chunks() {
        let received = 0;
        const reader = response.body?.getReader();
        try {
            if (reader)
                while (true) {
                    signal.throwIfAborted();
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    received += value.byteLength;
                    if (received > maximum || received > expectedBytes)
                        throw new Error('EXPORT_TOO_LARGE');
                    yield value;
                }
            signal.throwIfAborted();
            if (received !== expectedBytes)
                throw new Error('EXPORT_SIZE_MISMATCH');
        }
        finally {
            await reader?.cancel().catch(() => undefined);
            reader?.releaseLock();
        }
    }
    return { id, filename, contentType, size, coverage, data: chunks(), signal, close };
}
