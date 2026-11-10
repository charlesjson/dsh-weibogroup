import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isRecord } from '../vendor/helpers.js';
export const DEFAULT_CONNECTION_FILE = join(homedir(), '.config/dsh-weibogroup/connection.json');
export async function loadConnection(file = DEFAULT_CONNECTION_FILE) {
    let value;
    try {
        const info = await stat(file);
        if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
            throw new Error('permissions');
        }
        value = JSON.parse(await readFile(file, 'utf8'));
    }
    catch {
        throw new Error('微博群聊连接配置不可读；请创建 connection.json 并设置权限 chmod 600，详见插件 README。');
    }
    if (!isRecord(value) || typeof value.baseUrl !== 'string'
        || typeof value.apiToken !== 'string' || !/^wg_ai_[A-Za-z0-9_-]{43}$/.test(value.apiToken)) {
        throw new Error('微博群聊连接配置无效；需要 baseUrl 和有效的只读 API Token。');
    }
    let baseUrl;
    try {
        baseUrl = new URL(value.baseUrl);
    }
    catch {
        throw new Error('微博群聊 baseUrl 必须为绝对 HTTP(S) 地址。');
    }
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password
        || baseUrl.search || baseUrl.hash)
        throw new Error('微博群聊 baseUrl 不允许包含凭据、查询参数或片段。');
    if (baseUrl.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname)) {
        throw new Error('远程微博群聊服务必须使用 HTTPS。');
    }
    return { baseUrl, apiToken: value.apiToken };
}
