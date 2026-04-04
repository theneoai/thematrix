/**
 * Base Provider Plugin - 通用 OpenAI-compatible Provider 基类
 *
 * 大多数 Provider (DeepSeek, Moonshot, Qwen, OpenRouter, vLLM 等)
 * 都兼容 OpenAI API 格式，此基类提供通用实现
 */

import type {
  ProviderPlugin,
  ProviderConfig,
  RuntimeAuth,
  HealthStatus,
  ModelInfo,
  ProviderName,
  LLMAdapter,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  ChatMessage,
  ToolDefinition,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'OpenAICompatProvider' });

interface OpenAIResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  choices: Array<{
    delta: { content?: string; role?: string };
    finish_reason?: string;
  }>;
}

/**
 * OpenAI-compatible adapter 通用实现
 */
export class OpenAICompatibleAdapter implements LLMAdapter {
  readonly provider: string;
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: {
    provider: string;
    apiKey: string;
    baseUrl: string;
    defaultModel: string;
  }) {
    this.provider = config.provider;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.defaultModel = config.defaultModel;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || this.defaultModel,
        messages: this.formatMessages(request.messages),
        tools: request.tools ? this.formatTools(request.tools) : undefined,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stop: request.stop,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.provider} API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as OpenAIResponse;
    const choice = data.choices[0];

    return {
      id: data.id,
      model: data.model,
      content: choice?.message?.content ?? '',
      toolCalls: choice?.message?.tool_calls?.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || this.defaultModel,
        messages: this.formatMessages(request.messages),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.provider} API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const chunk = JSON.parse(data) as OpenAIStreamChunk;
              const choice = chunk.choices[0];
              if (choice?.delta?.content) {
                yield { id: chunk.id, content: choice.delta.content };
              }
              if (choice?.finish_reason) {
                yield { id: chunk.id, finishReason: choice.finish_reason as 'stop' | 'length' | 'tool_calls' };
              }
            } catch {
              logger.debug('Failed to parse SSE chunk');
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async countTokens(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
  }

  private formatMessages(messages: ChatMessage[]): unknown[] {
    return messages.map(m => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.toolCalls) msg.tool_calls = m.toolCalls;
      if (m.toolResults) {
        return m.toolResults.map(r => ({
          role: 'tool',
          tool_call_id: r.toolCallId,
          content: r.content,
        }));
      }
      return msg;
    }).flat();
  }

  private formatTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }));
  }
}

/**
 * 创建 OpenAI-compatible ProviderPlugin 工厂函数
 */
export function createOpenAICompatiblePlugin(config: {
  name: ProviderName;
  displayName: string;
  defaultBaseUrl: string;
  defaultModel: string;
  models: ModelInfo[];
}): ProviderPlugin {
  return {
    name: config.name,
    displayName: config.displayName,
    models: config.models,

    async prepareRuntimeAuth(providerConfig: ProviderConfig): Promise<RuntimeAuth> {
      const apiKey = typeof providerConfig.apiKey === 'string'
        ? providerConfig.apiKey
        : '';  // SecretRef should be resolved before calling this

      return {
        provider: config.name,
        token: apiKey,
        baseUrl: providerConfig.baseUrl ?? config.defaultBaseUrl,
      };
    },

    createAdapter(auth: RuntimeAuth, model: string): LLMAdapter {
      return new OpenAICompatibleAdapter({
        provider: config.name,
        apiKey: auth.token,
        baseUrl: auth.baseUrl,
        defaultModel: model || config.defaultModel,
      });
    },

    async healthCheck(): Promise<HealthStatus> {
      return {
        provider: config.name,
        healthy: true,
        checkedAt: new Date(),
        message: 'Health check not implemented for OpenAI-compatible providers',
      };
    },
  };
}
