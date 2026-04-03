/**
 * Anthropic Claude 适配器
 */
import type { 
  LLMAdapter, 
  ChatRequest, 
  ChatResponse, 
  ChatStreamChunk,
  ChatMessage,
  ToolDefinition 
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'AnthropicAdapter' });

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface AnthropicResponse {
  id: string;
  model: string;
  content: AnthropicContentBlock[];
  usage?: AnthropicUsage;
}

interface AnthropicStreamEvent {
  type: string;
  message?: { id: string };
  delta?: { type: string; text?: string };
}

export class AnthropicAdapter implements LLMAdapter {
  readonly provider = 'anthropic';
  private config: AnthropicConfig;

  constructor(config: AnthropicConfig) {
    this.config = {
      defaultModel: 'claude-3-sonnet-20240229',
      ...config,
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const systemMessage = request.messages.find(m => m.role === 'system');
    const response = await fetch(`${this.config.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model || this.config.defaultModel,
        system: systemMessage?.content,
        messages: this.formatMessages(request.messages),
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        tools: request.tools ? this.formatTools(request.tools) : undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as AnthropicResponse;
    
    return {
      id: data.id,
      model: data.model,
      content: data.content.find((c) => c.type === 'text')?.text ?? '',
      toolCalls: data.content
        .filter((c) => c.type === 'tool_use')
        .map((c) => ({
          id: c.id!,
          type: 'function' as const,
          function: {
            name: c.name!,
            arguments: JSON.stringify(c.input),
          },
        })),
      usage: {
        promptTokens: data.usage?.input_tokens ?? 0,
        completionTokens: data.usage?.output_tokens ?? 0,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const systemMessage = request.messages.find(m => m.role === 'system');
    const response = await fetch(`${this.config.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model || this.config.defaultModel,
        system: systemMessage?.content,
        messages: this.formatMessages(request.messages),
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let messageId = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data) as AnthropicStreamEvent;
              
              if (event.type === 'message_start') {
                messageId = event.message!.id;
              } else if (event.type === 'content_block_delta') {
                if (event.delta!.type === 'text_delta') {
                  yield {
                    id: messageId,
                    content: event.delta!.text,
                  };
                }
              } else if (event.type === 'message_stop') {
                yield {
                  id: messageId,
                  finishReason: 'stop',
                };
              }
            } catch (e) {
              logger.debug('Failed to parse SSE data:', data);
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

  private formatMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    
    return nonSystemMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
  }

  private formatTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }
}
