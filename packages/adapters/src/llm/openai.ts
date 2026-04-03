/**
 * OpenAI 适配器
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

const logger = new Logger({ prefix: 'OpenAIAdapter' });

export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        function: {
          name: string;
          arguments: string;
        };
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

interface OpenAIStreamChunk {
  id: string;
  choices: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
}

export class OpenAIAdapter implements LLMAdapter {
  readonly provider = 'openai';
  private config: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    this.config = {
      defaultModel: 'gpt-4',
      ...config,
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.config.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
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
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as OpenAIResponse;
    const choice = data.choices[0];
    
    return {
      id: data.id,
      model: data.model,
      content: choice.message.content ?? '',
      toolCalls: choice.message.tool_calls?.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const response = await fetch(`${this.config.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
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
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

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
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const chunk = JSON.parse(data) as OpenAIStreamChunk;
              const choice = chunk.choices[0];
              
              if (choice.delta.content) {
                yield {
                  id: chunk.id,
                  content: choice.delta.content,
                };
              }

              if (choice.finish_reason) {
                yield {
                  id: chunk.id,
                  finishReason: choice.finish_reason as 'stop' | 'length' | 'tool_calls',
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
    // OpenAI uses tiktoken, approximate with character count
    return Math.ceil(text.length / 4);
  }

  private formatMessages(messages: ChatMessage[]): unknown[] {
    return messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.toolCalls && { tool_calls: m.toolCalls }),
      ...(m.toolResults && { tool_results: m.toolResults }),
    }));
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
