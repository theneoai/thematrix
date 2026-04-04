/**
 * KimiCode (Moonshot Kimi K2) 适配器
 *
 * KimiCode 使用 Anthropic 兼容协议（非 OpenAI）：
 *   Base URL : https://api.kimi.com/coding
 *   Endpoint : https://api.kimi.com/coding/v1/messages
 *   Auth     : x-api-key: sk-kimi-xxx  +  anthropic-version: 2023-06-01
 *
 * 可用模型：
 *   kimi-k2.5          — 最新旗舰模型，256K 上下文，多模态（默认）
 *   kimi-k2-thinking   — 推理增强版
 *   kimi-k2-thinking-turbo — 推理增强快速版
 *   kimi-k2            — 基础 K2 模型
 *   kimi-k2-0905       — K2 日期快照版本
 *
 * 在 agent.yaml 中：
 *   model:
 *     provider: kimicode
 *     model: kimi-k2.5
 */
import type { LLMAdapter, ChatRequest, ChatResponse, ChatStreamChunk } from '@thematrix/types';
import { AnthropicAdapter } from './anthropic.js';

export interface KimiConfig {
  apiKey: string;
  /** 默认: https://api.kimi.com/coding */
  baseUrl?: string;
  /** 默认: kimi-k2.5 */
  defaultModel?: string;
}

export class KimiAdapter implements LLMAdapter {
  readonly provider = 'kimicode';
  private inner: AnthropicAdapter;

  constructor(config: KimiConfig) {
    this.inner = new AnthropicAdapter({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? 'https://api.kimi.com/coding',
      defaultModel: config.defaultModel ?? 'kimi-k2.5',
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
