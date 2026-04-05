/**
 * @thematrix/providers - LLM Provider 管理与 Token 资源池
 *
 * 支持 12+ LLM Provider，Token 预算分配与限流，Provider 路由与故障转移
 */

export { ProviderRegistry } from './registry.js';
export { TokenPool } from './pool.js';
export { ProviderRouter } from './router.js';
export { SecretManager } from './secret.js';

// Provider plugins
export { OpenAICompatibleAdapter, createOpenAICompatiblePlugin } from './providers/base.js';
export {
  openaiPlugin,
  anthropicPlugin,
  azureOpenaiPlugin,
  googleGeminiPlugin,
  deepseekPlugin,
  ollamaPlugin,
  vllmPlugin,
  openrouterPlugin,
  moonshotPlugin,
  minimaxPlugin,
  qwenPlugin,
  huggingfacePlugin,
  opencodePlugin,
  kimicodePlugin,
  allProviderPlugins,
} from './providers/all.js';

// Re-export types
export type {
  ProviderPlugin,
  ProviderConfig,
  ProviderName,
  RuntimeAuth,
  HealthStatus,
  ModelInfo,
  SecretRef,
  TokenBudget,
  TokenUsage,
  TokenConsumption,
  RateLimitConfig,
  ProviderRouterConfig,
  ITokenPool,
  IProviderRegistry,
} from '@thematrix/types';
