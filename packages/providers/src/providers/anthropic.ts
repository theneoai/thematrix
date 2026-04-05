/**
 * Anthropic Provider Plugin
 *
 * Wraps the AnthropicAdapter from @thematrix/adapters as a ProviderPlugin,
 * providing runtime auth preparation, adapter creation, and health checking.
 */

import type {
  ProviderPlugin,
  ProviderConfig,
  RuntimeAuth,
  HealthStatus,
  ModelInfo,
  LLMAdapter,
} from '@thematrix/types';
import { AnthropicAdapter } from '@thematrix/adapters';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'AnthropicProvider' });

const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    contextWindow: 200000,
    maxOutputTokens: 32000,
    inputPricePerMToken: 15,
    outputPricePerMToken: 75,
    capabilities: ['chat', 'tool-calling', 'vision', 'streaming'],
  },
  {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
    capabilities: ['chat', 'tool-calling', 'vision', 'streaming'],
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputPricePerMToken: 0.8,
    outputPricePerMToken: 4,
    capabilities: ['chat', 'tool-calling', 'vision', 'streaming'],
  },
];

export const anthropicPlugin: ProviderPlugin = {
  name: 'anthropic',
  displayName: 'Anthropic',
  models: ANTHROPIC_MODELS,

  async prepareRuntimeAuth(providerConfig: ProviderConfig): Promise<RuntimeAuth> {
    const apiKey = typeof providerConfig.apiKey === 'string'
      ? providerConfig.apiKey
      : '';

    return {
      provider: 'anthropic',
      token: apiKey,
      baseUrl: providerConfig.baseUrl ?? 'https://api.anthropic.com',
    };
  },

  createAdapter(auth: RuntimeAuth, model: string): LLMAdapter {
    return new AnthropicAdapter({
      apiKey: auth.token,
      baseUrl: auth.baseUrl,
      defaultModel: model || 'claude-opus-4-5',
    });
  },

  async healthCheck(): Promise<HealthStatus> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      // A 401 means the API is reachable (just no auth); anything else is still up
      const healthy = response.status === 401 || response.status === 400 || response.ok;
      return {
        provider: 'anthropic',
        healthy,
        checkedAt: new Date(),
        message: healthy ? 'Anthropic API reachable' : `Unexpected status: ${response.status}`,
      };
    } catch (err) {
      logger.warn('Anthropic health check failed', err);
      return {
        provider: 'anthropic',
        healthy: false,
        checkedAt: new Date(),
        message: `Health check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
