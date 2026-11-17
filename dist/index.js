import { assertHostMethods } from './host-api.js';
import { validateConfig } from './config.js';
import { createArchiveClient } from './api/client.js';
import { registerArchiveTools } from './harness/register.js';
export { Config } from './config.js';
export { archiveToolCatalog } from './api/catalog.js';
export const name = 'weibo-group';
export const inject = ['tools', 'systemPrompt'];
export function apply(ctx, config) {
    assertHostMethods('dsh-weibogroup', ctx, ['effect', 'inject', 'tools.register', 'tools.get', 'systemPrompt.section']);
    validateConfig(config);
    registerArchiveTools(ctx, createArchiveClient(config), config);
}
