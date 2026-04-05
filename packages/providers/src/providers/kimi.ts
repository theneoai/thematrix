/**
 * KimiCode Provider Plugin
 *
 * Wraps the KimiAdapter from @thematrix/adapters as a ProviderPlugin.
 * Kimi uses an Anthropic-compatible API at https://api.kimi.com/coding.
 */

import type {
  ProviderPlugin,
  ProviderConfig,
  RuntimeAuth,
  HealthStatus,
  ModelInfo,
  LLMAdapter,
} from '@thematrix/types';
import { KimiAdapter } from '@thematrix/adapters';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'KimiCodeProvider' });

const KIMI_MODELS: ModelInfo[] = [
  {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5',
    contextWindow: 262144,
    maxOutputTokens: 8192,
    inputPricePerMToken: 1.0,
    outputPricePerMToken: 4.0,
    capabilities: ['chat', 'tool-calling', 'streaming'],
  },
  {
    id: 'kimi-k2-thinking',
    name: 'Kimi K2 Thinking',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    inputPricePerMToken: 1.5,
    outputPricePerMToken: 6.0,
    capabilities: ['chat', 'streaming'],
  },
  {
    id: 'kimi-k2-thinking-turbo',
    name: 'Kimi K2 Thinking Turbo',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    inputPricePerMToken: 1.0,
    outputPricePerMToken: 4.0,
    capabilities: ['chat', 'streaming'],
  },
  {
    id: 'kimi-k2',
    name: 'Kimi K2',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    inputPricePerMToken: 0.8,
    outputPricePerMToken: 3.0,
    capabilities: ['chat', 'tool-calling', 'streaming'],
  },
];

export const kimicodePlugin: ProviderPlugin = {
  name: 'kimicode',
  displayName: 'KimiCode (Moonshot K2)',
  models: KIMI_MODELS,

  async prepareRuntimeAuth(providerConfig: ProviderConfig): Promise<RuntimeAuth> {
    const apiKey = typeof providerConfig.apiKey === 'string'
      ? providerConfig.apiKey
      : '';

    return {
      provider: 'kimicode',
      token: apiKey,
      baseUrl: providerConfig.baseUrl ?? 'https://api.kimi.com/coding',
    };
  },

  createAdapter(auth: RuntimeAuth, model: string): LLMAdapter {
    return new KimiAdapter({
      apiKey: auth.token,
      baseUrl: auth.baseUrl,
      defaultModel: model || 'kimi-k2.5',
    });
  },

  async healthCheck(): Promise<HealthStatus> {
    try {
      const response = await fetch('https://api.kimi.com/coding/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      const healthy = response.status === 401 || response.status === 400 || response.ok;
      return {
        provider: 'kimicode',
        healthy,
        checkedAt: new Date(),
        message: healthy ? 'KimiCode API reachable' : `Unexpected status: ${response.status}`,
      };
    } catch (err) {
      logger.warn('KimiCode health check failed', err);
      return {
        provider: 'kimicode',
        healthy: false,
        checkedAt: new Date(),
        message: `Health check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
