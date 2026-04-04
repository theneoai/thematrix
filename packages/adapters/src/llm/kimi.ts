/**
 * Kimi (Moonshot AI) 适配器
 * API 兼容 OpenAI，基础 URL: https://api.moonshot.cn/v1
 * 可用模型: moonshot-v1-8k | moonshot-v1-32k | moonshot-v1-128k
 */
import type { LLMAdapter, ChatRequest, ChatResponse, ChatStreamChunk } from '@thematrix/types';
import { OpenAIAdapter } from './openai.js';

export interface KimiConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

export class KimiAdapter implements LLMAdapter {
  readonly provider = 'kimicode';
  private inner: OpenAIAdapter;

  constructor(config: KimiConfig) {
    this.inner = new OpenAIAdapter({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? 'https://api.moonshot.cn/v1',
      defaultModel: config.defaultModel ?? 'moonshot-v1-8k',
    });
  }

  chat(request: ChatRequest): Promise<ChatResponse> {
    return this.inner.chat(request);
  }

  chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    return this.inner.chatStream(request);
  }

  countTokens(text: string): Promise<number> {
    return this.inner.countTokens(text);
  }
}
