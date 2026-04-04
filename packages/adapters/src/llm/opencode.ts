/**
 * OpenCode 适配器
 * 兼容 OpenAI 协议的通用代码模型适配器
 * 支持任意 OpenAI 兼容端点（如 Qwen-Coder、DeepSeek-Coder、本地部署等）
 * 在 agent.yaml 中 provider: opencode 并通过 baseUrl 指定具体服务端点
 */
import type { LLMAdapter, ChatRequest, ChatResponse, ChatStreamChunk } from '@thematrix/types';
import { OpenAIAdapter } from './openai.js';

export interface OpenCodeConfig {
  apiKey: string;
  /** 必填：OpenAI 兼容服务的基础 URL，例如 https://api.deepseek.com/v1 */
  baseUrl: string;
  defaultModel?: string;
}

export class OpenCodeAdapter implements LLMAdapter {
  readonly provider = 'opencode';
  private inner: OpenAIAdapter;

  constructor(config: OpenCodeConfig) {
    this.inner = new OpenAIAdapter({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      defaultModel: config.defaultModel ?? 'gpt-4',
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
