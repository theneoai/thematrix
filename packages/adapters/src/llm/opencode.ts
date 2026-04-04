/**
 * OpenCode 适配器
 * 兼容 OpenAI 协议的通用代码模型适配器
 * 支持任意 OpenAI 兼容端点（如 Qwen-Coder、DeepSeek-Coder、本地部署等）
 *
 * 常见服务端点示例：
 *   DeepSeek  : https://api.deepseek.com/v1  model: deepseek-chat / deepseek-coder
 *   Qwen-Coder: https://dashscope.aliyuncs.com/compatible-mode/v1  model: qwen-coder-turbo
 *   本地 Ollama: http://localhost:11434/v1  model: <模型名>
 *
 * 在 agent.yaml 中：
 *   model:
 *     provider: opencode
 *     model: deepseek-chat   # 必须明确指定，无默认值
 */
import type { LLMAdapter, ChatRequest, ChatResponse, ChatStreamChunk } from '@thematrix/types';
import { OpenAIAdapter } from './openai.js';

export interface OpenCodeConfig {
  apiKey: string;
  /** 必填：OpenAI 兼容服务的基础 URL，例如 https://api.deepseek.com/v1 */
  baseUrl: string;
  /**
   * 默认模型 ID。OpenCode 是通用适配器，强烈建议在 agent.yaml 的 model.model 字段明确指定。
   * 此处仅作最后兜底，避免未指定时 API 返回 400。
   */
  defaultModel?: string;
}

export class OpenCodeAdapter implements LLMAdapter {
  readonly provider = 'opencode';
  private inner: OpenAIAdapter;

  constructor(config: OpenCodeConfig) {
    if (!config.defaultModel) {
      // No universal default exists — each OpenAI-compatible service has its own model names.
      // The caller must set model.model in agent.yaml; this fallback is intentionally left empty
      // so the LLM service returns a clear error rather than silently using a wrong model.
    }
    this.inner = new OpenAIAdapter({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      defaultModel: config.defaultModel,
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
