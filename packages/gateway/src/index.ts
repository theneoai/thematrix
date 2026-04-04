/**
 * @thematrix/gateway - Integration Gateway
 *
 * Handles incoming webhooks from external platforms and normalizes
 * them into unified TriggerEvents.
 */

// Server
export { GatewayServer, type TriggerCallback } from './server.js';

// Channel Adapters
export { GerritChannelAdapter } from './channels/gerrit.js';
export { JiraChannelAdapter } from './channels/jira.js';
export { GitLabChannelAdapter } from './channels/gitlab.js';
export { FeishuChannelAdapter } from './channels/feishu.js';
export { WeChatChannelAdapter } from './channels/wechat.js';
export { CustomChannelAdapter, type CustomAdapterConfig } from './channels/custom.js';

// Normalizer utilities
export { createTriggerEvent, resolvePath } from './normalizer.js';
