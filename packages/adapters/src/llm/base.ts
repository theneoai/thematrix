/**
 * LLM Adapter 基类和通用实现
 */
import type { 
  LLMAdapter, 
  ChatRequest, 
  ChatResponse, 
  ChatStreamChunk,
  ChatMessage,
  ToolDefinition 
} from '@thematrix/types';

/**
 * 简单的 Token 估算（基于字符数）
 * 实际应用中应该使用各提供商的 tokenizer
 */
export function estimateTokenCount(text: string): number {
  // 粗略估计：1 token ≈ 4 个字符
  return Math.ceil(text.length / 4);
}

/**
 * 格式化消息为通用格式
 */
export function formatMessages(messages: ChatMessage[]): string {
  return messages.map(m => `${m.role}: ${m.content}`).join('\n');
}

/**
 * 模拟 LLM 适配器（用于测试）
 */
export class MockLLMAdapter implements LLMAdapter {
  readonly provider = 'mock';
  private responseDelayMs: number;

  constructor(options: { responseDelayMs?: number } = {}) {
    this.responseDelayMs = options.responseDelayMs ?? 100;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.delay();

    const content = `Mock response for: ${request.messages[request.messages.length - 1]?.content.slice(0, 50)}...`;
    const promptTokens = estimateTokenCount(formatMessages(request.messages));
    const completionTokens = estimateTokenCount(content);

    return {
      id: `mock-${Date.now()}`,
      model: request.model,
      content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const response = await this.chat(request);
    const words = response.content.split(' ');

    for (let i = 0; i < words.length; i++) {
      await this.delay(this.responseDelayMs / words.length);
      yield {
        id: response.id,
        content: words[i] + (i < words.length - 1 ? ' ' : ''),
        finishReason: i === words.length - 1 ? 'stop' : undefined,
      };
    }
  }

  async countTokens(text: string): Promise<number> {
    return estimateTokenCount(text);
  }

  private delay(ms?: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms ?? this.responseDelayMs));
  }
}

/**
 * LLM 适配器工厂
 */
export class LLMAdapterFactory {
  private adapters = new Map<string, new (config: Record<string, unknown>) => LLMAdapter>();

  register(provider: string, adapterClass: new (config: Record<string, unknown>) => LLMAdapter): void {
    this.adapters.set(provider, adapterClass);
  }

  create(provider: string, config: Record<string, unknown> = {}): LLMAdapter {
    const AdapterClass = this.adapters.get(provider);
    if (!AdapterClass) {
      // Return mock adapter as fallback
      if (provider === 'mock') {
        return new MockLLMAdapter(config);
      }
      throw new Error(`No adapter registered for provider: ${provider}`);
    }
    return new AdapterClass(config);
  }

  getRegisteredProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
}

// 全局工厂实例
export const adapterFactory = new LLMAdapterFactory();

// 注册 Mock 适配器
adapterFactory.register('mock', MockLLMAdapter);
