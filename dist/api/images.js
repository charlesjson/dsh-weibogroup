import { DEFAULT_IMAGE_TIMEOUT_MS } from '../config.js';
import { imageDigest, imageResourceBinding, sniffImageMediaType, MAX_ARCHIVE_IMAGE_BYTES, } from '../vendor/image-payload.js';
import { createApiSession } from './session.js';
async function errorCode(response) {
    const reader = response.body?.getReader();
    if (!reader)
        return 'UPSTREAM_HTTP_ERROR';
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > 4096)
                return 'UPSTREAM_HTTP_ERROR';
            chunks.push(value);
        }
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return typeof parsed.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(parsed.code)
            ? parsed.code
            : 'UPSTREAM_HTTP_ERROR';
    }
    catch {
        return 'UPSTREAM_HTTP_ERROR';
    }
    finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
/** Read exactly one owner-bound archive image; neither URLs nor credentials are tool arguments. */
export async function readArchiveImage(config, key, caller, fetchImpl) {
    caller.throwIfAborted();
    const signal = AbortSignal.any([
        caller,
        AbortSignal.timeout(config.imageTimeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS),
    ]);
    const session = await createApiSession(config, signal, fetchImpl);
    const base = new URL(session.apiBaseUrl);
    base.pathname = base.pathname.replace(/\/+$/, '') + '/';
    const url = new URL('api/v1/messages/image', base);
    for (const name of ['accountId', 'groupId', 'messageId', 'assetType', 'assetKey'])
        url.searchParams.set(name, key[name]);
    url.searchParams.set('imageIndex', String(key.imageIndex ?? 0));
    const response = await session.fetch(url, {
        headers: {
            authorization: `Bearer ${session.apiToken}`,
            accept: 'image/png,image/jpeg,image/webp,image/gif',
            'accept-encoding': 'identity',
        },
    });
    if (!response.ok)
        throw new Error(`IMAGE_READ_FAILED: ${await errorCode(response)} (HTTP ${response.status})`);
    if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error('IMAGE_PARTIAL_RESPONSE');
    }
    const reader = response.body?.getReader();
    const maximum = config.maxImageBytes ?? MAX_ARCHIVE_IMAGE_BYTES;
    const chunks = [];
    let size = 0;
    try {
        if (response.headers.get('x-weibogroup-image-binding') !== imageResourceBinding(key))
            throw new Error('IMAGE_RESOURCE_MISMATCH');
        const declared = response.headers.get('content-length');
        if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum))
            throw new Error('IMAGE_TOO_LARGE');
        while (reader) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > maximum)
                throw new Error('IMAGE_TOO_LARGE');
            chunks.push(value);
        }
        signal.throwIfAborted();
        const data = Buffer.concat(chunks);
        const type = sniffImageMediaType(data);
        const actualType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        if (!type || actualType !== type)
            throw new Error('IMAGE_UNSUPPORTED_FORMAT');
        const encoding = response.headers.get('content-encoding')?.toLowerCase();
        if (declared !== null && (!encoding || encoding === 'identity') && Number(declared) !== size)
            throw new Error('IMAGE_SIZE_MISMATCH');
        const digest = imageDigest(data);
        if (response.headers.get('x-weibogroup-image-sha256') !== digest)
            throw new Error('IMAGE_DIGEST_MISMATCH');
        const count = Number(response.headers.get('x-weibogroup-image-count'));
        const preview = response.headers.get('x-weibogroup-image-preview');
        if (!Number.isInteger(count) ||
            count < 1 ||
            count > 256 ||
            (key.imageIndex ?? 0) >= count ||
            !['0', '1'].includes(preview ?? ''))
            throw new Error('IMAGE_INVALID_METADATA');
        const metadata = {
            accountId: key.accountId,
            groupId: key.groupId,
            messageId: key.messageId,
            assetType: key.assetType,
            assetKey: key.assetKey,
            imageIndex: key.imageIndex ?? 0,
            imageCount: count,
            preview: preview === '1',
            mediaType: type,
            bytes: size,
            sourceSha256: digest,
        };
        return {
            content: [
                { type: 'text', text: JSON.stringify(metadata) },
                { type: 'image', mimeType: type, data: data.toString('base64') },
            ],
            structuredContent: metadata,
        };
    }
    finally {
        await reader?.cancel().catch(() => undefined);
        reader?.releaseLock();
    }
}
