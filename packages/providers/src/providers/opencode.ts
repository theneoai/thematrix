/**
 * OpenCode Provider Plugin
 *
 * Wraps the OpenCodeAdapter from @thematrix/adapters as a ProviderPlugin.
 * OpenCode is a generic OpenAI-compatible adapter for services like
 * DeepSeek, Qwen-Coder, local Ollama, etc.
 */

import type {
  ProviderPlugin,
  ProviderConfig,
  RuntimeAuth,
  HealthStatus,
  ModelInfo,
  LLMAdapter,
} from '@thematrix/types';
import { OpenCodeAdapter } from '@thematrix/adapters';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'OpenCodeProvider' });

const OPENCODE_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat (via OpenCode)',
    contextWindow: 64000,
    maxOutputTokens: 8192,
    inputPricePerMToken: 0.27,
    outputPricePerMToken: 1.1,
    capabilities: ['chat', 'tool-calling', 'streaming'],
  },
  {
    id: 'qwen-coder-turbo',
    name: 'Qwen Coder Turbo (via OpenCode)',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    inputPricePerMToken: 0.5,
    outputPricePerMToken: 2.0,
    capabilities: ['chat', 'streaming'],
  },
];

export const opencodePlugin: ProviderPlugin = {
  name: 'opencode',
  displayName: 'OpenCode (OpenAI-compatible)',
  models: OPENCODE_MODELS,

  async prepareRuntimeAuth(providerConfig: ProviderConfig): Promise<RuntimeAuth> {
    const apiKey = typeof providerConfig.apiKey === 'string'
      ? providerConfig.apiKey
      : '';

    const baseUrl = providerConfig.baseUrl;
    if (!baseUrl) {
      throw new Error('OpenCode provider requires a baseUrl pointing to an OpenAI-compatible endpoint');
    }

    return {
      provider: 'opencode',
      token: apiKey,
      baseUrl,
    };
  },

  createAdapter(auth: RuntimeAuth, model: string): LLMAdapter {
    return new OpenCodeAdapter({
      apiKey: auth.token,
      baseUrl: auth.baseUrl,
      defaultModel: model || undefined,
    });
  },

  async healthCheck(): Promise<HealthStatus> {
    // OpenCode targets vary; no single endpoint to check
    return {
      provider: 'opencode',
      healthy: true,
      checkedAt: new Date(),
      message: 'OpenCode is a generic adapter; health depends on the configured endpoint',
    };
  },
};
