/**
 * MiniMax 适配器
 * 使用 MiniMax ChatCompletion v2 (OpenAI 兼容) 接口
 * 文档: https://platform.minimaxi.com/document/ChatCompletion%20v2
 * 可用模型: MiniMax-Text-01 | abab6.5s-chat | abab6.5g-chat | abab5.5s-chat
 *
 * 认证方式: Authorization: Bearer <apiKey>
 * 可选: 在 baseUrl 中携带 GroupId，例如:
 *   https://api.minimax.chat/v1 (需在 headers 中设置 MM-GroupId，或通过 apiKey 格式 "<groupId>:<key>" 传入)
 */
import type {
  LLMAdapter,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  ChatMessage,
  ToolDefinition,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'MiniMaxAdapter' });

export interface MiniMaxConfig {
  apiKey: string;
  /** 可选: 账户 GroupId，部分接口鉴权需要 */
  groupId?: string;
  baseUrl?: string;
  defaultModel?: string;
}

interface MiniMaxResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface MiniMaxStreamChunk {
  id: string;
  choices: Array<{
    delta: { content?: string };
    finish_reason: string | null;
  }>;
}

export class MiniMaxAdapter implements LLMAdapter {
  readonly provider = 'minimax';
  private config: Required<Omit<MiniMaxConfig, 'groupId'>> & Pick<MiniMaxConfig, 'groupId'>;

  constructor(config: MiniMaxConfig) {
    this.config = {
      baseUrl: 'https://api.minimax.chat/v1',
      defaultModel: 'MiniMax-Text-01',
      groupId: config.groupId,
      ...config,
    };
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };
    if (this.config.groupId) {
      h['MM-GroupId'] = this.config.groupId;
    }
    return h;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: request.model || this.config.defaultModel,
        messages: this.formatMessages(request.messages),
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        tools: request.tools ? this.formatTools(request.tools) : undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MiniMax API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as MiniMaxResponse;
    const choice = data.choices[0];

    return {
      id: data.id,
      model: data.model,
      content: choice.message.content ?? '',
      toolCalls: choice.message.tool_calls?.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: request.model || this.config.defaultModel,
        messages: this.formatMessages(request.messages),
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MiniMax API error: ${response.status} - ${error}`);
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
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data) as MiniMaxStreamChunk;
            const choice = chunk.choices[0];
            if (choice.delta.content) {
              yield { id: chunk.id, content: choice.delta.content };
            }
            if (choice.finish_reason) {
              yield { id: chunk.id, finishReason: choice.finish_reason as 'stop' | 'length' | 'tool_calls' };
            }
          } catch {
            logger.debug('Failed to parse SSE data:', data);
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
    // MiniMax ChatCompletion v2 supports 'system' role directly in messages array
    return messages.map(m => ({ role: m.role, content: m.content }));
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
