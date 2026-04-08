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

/** Redact API keys from error messages */
function redactApiKey(text: string, apiKey: string): string {
  if (!apiKey || apiKey.length < 8) return text;
  return text.replaceAll(apiKey, apiKey.slice(0, 4) + '...' + apiKey.slice(-4));
}

/** Timeout constants (ms) */
const CHAT_TIMEOUT_MS = 60_000;
const STREAM_TIMEOUT_MS = 120_000;

export class AnthropicAdapter implements LLMAdapter {
  readonly provider = 'anthropic';
  private config: AnthropicConfig;

  constructor(config: AnthropicConfig) {
    this.config = {
      defaultModel: 'claude-opus-4-5',
      ...config,
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const systemMessage = request.messages.find(m => m.role === 'system');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
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
        signal: controller.signal,
      });
    } catch (err: unknown) {
      throw new Error(`Anthropic API request failed: ${redactApiKey(String(err), this.config.apiKey)}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${redactApiKey(error, this.config.apiKey)}`);
    }

    const data = await response.json() as AnthropicResponse;

    if (!data.content || !Array.isArray(data.content)) {
      throw new Error('Anthropic API returned an invalid response: missing content array');
    }

    return {
      id: data.id,
      model: data.model,
      content: data.content.find((c) => c.type === 'text')?.text ?? '',
      toolCalls: data.content
        .filter((c) => c.type === 'tool_use' && c.id && c.name)
        .map((c) => ({
          id: c.id as string,
          type: 'function' as const,
          function: {
            name: c.name as string,
            arguments: JSON.stringify(c.input ?? {}),
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
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
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      throw new Error(`Anthropic API request failed: ${redactApiKey(String(err), this.config.apiKey)}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${redactApiKey(error, this.config.apiKey)}`);
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
                messageId = event.message?.id ?? messageId;
              } else if (event.type === 'content_block_delta') {
                if (event.delta?.type === 'text_delta') {
                  yield {
                    id: messageId,
                    content: event.delta.text,
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

  private formatMessages(messages: ChatMessage[]): unknown[] {
    return messages
      .filter(m => m.role !== 'system')
      .flatMap((m): unknown[] => {
        // tool role → user message containing tool_result blocks
        if (m.role === 'tool') {
          if (m.toolResults && m.toolResults.length > 0) {
            return [{
              role: 'user',
              content: m.toolResults.map(r => ({
                type: 'tool_result',
                tool_use_id: r.toolCallId,
                content: r.content,
              })),
            }];
          }
          // Fallback: plain user message (shouldn't happen in normal flow)
          return [{ role: 'user', content: m.content }];
        }
        // assistant with tool calls → structured content with tool_use blocks
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          const content: unknown[] = [];
          if (m.content) content.push({ type: 'text', text: m.content });
          for (const call of m.toolCalls) {
            let input: unknown = {};
            try { input = JSON.parse(call.function.arguments); } catch { /* keep empty */ }
            content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
          }
          return [{ role: 'assistant', content }];
        }
        // plain user / assistant messages
        return [{ role: m.role, content: m.content }];
      });
  }

  private formatTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }
}
