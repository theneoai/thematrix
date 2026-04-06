/**
 * MiniMax 适配器
 *
 * MiniMax 同时支持 OpenAI 兼容协议和 Anthropic 兼容协议，本实现使用 OpenAI 兼容端点。
 *
 * API 端点：
 *   国际 (Global)  : https://api.minimax.io/v1
 *   中国大陆        : https://api.minimaxi.com/v1
 *   说明：两套 API Key 和域名独立，不可混用，否则返回 "Invalid API key"
 *
 * 认证：Authorization: Bearer <API_KEY>
 * 可选：MM-GroupId 请求头（旧版账户鉴权，新版 API Key 不需要）
 *
 * 主要文本模型（2026-04）：
 *   MiniMax-M2.7           — 最新旗舰（默认）
 *   MiniMax-M2.7-highspeed — 快速版
 *   MiniMax-M2.5           — 高性能智能体模型
 *   MiniMax-M2.5-highspeed — 快速版
 *   MiniMax-M2.1           — SOTA 代码 & 智能体
 *   MiniMax-M2.1-highspeed — 快速版
 *   MiniMax-M1             — 混合注意力推理模型，1M token 上下文
 *   MiniMax-Text-01        — 456B 参数，最长 4M 上下文
 *   MiniMax-VL-01          — 视觉多模态版本
 *
 * 在 agent.yaml 中：
 *   model:
 *     provider: minimax
 *     model: MiniMax-M2.7
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
  /**
   * 国际: https://api.minimax.io/v1
   * 大陆: https://api.minimaxi.com/v1
   * 默认使用国际端点
   */
  baseUrl?: string;
  /** 默认: MiniMax-M2.7 */
  defaultModel?: string;
  /**
   * 旧版账户 GroupId（新版 API Key 已不需要）
   * 若设置则作为 MM-GroupId 请求头发送
   */
  groupId?: string;
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

/** Redact API keys from error messages */
function redactApiKey(text: string, apiKey: string): string {
  if (!apiKey || apiKey.length < 8) return text;
  return text.replaceAll(apiKey, apiKey.slice(0, 4) + '...' + apiKey.slice(-4));
}

/** Timeout constants (ms) */
const CHAT_TIMEOUT_MS = 60_000;
const STREAM_TIMEOUT_MS = 120_000;

export class MiniMaxAdapter implements LLMAdapter {
  readonly provider = 'minimax';
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly groupId?: string;

  constructor(config: MiniMaxConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? 'https://api.minimax.io/v1').replace(/\/$/, '');
    this.defaultModel = config.defaultModel ?? 'MiniMax-M2.7';
    this.groupId = config.groupId;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
    if (this.groupId) {
      h['MM-GroupId'] = this.groupId;
    }
    return h;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          model: request.model || this.defaultModel,
          messages: this.formatMessages(request.messages),
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          tools: request.tools ? this.formatTools(request.tools) : undefined,
        }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      throw new Error(`MiniMax API request failed: ${redactApiKey(String(err), this.apiKey)}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MiniMax API error: ${response.status} - ${redactApiKey(error, this.apiKey)}`);
    }

    const data = await response.json() as MiniMaxResponse;

    if (!data.choices?.length || !data.choices[0].message) {
      throw new Error('MiniMax API returned an invalid response: missing choices or message');
    }

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          model: request.model || this.defaultModel,
          messages: this.formatMessages(request.messages),
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      throw new Error(`MiniMax API request failed: ${redactApiKey(String(err), this.apiKey)}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MiniMax API error: ${response.status} - ${redactApiKey(error, this.apiKey)}`);
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
            if (choice?.delta?.content) {
              yield { id: chunk.id, content: choice.delta.content };
            }
            if (choice?.finish_reason) {
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
    // MiniMax 未公开 tokenizer，按字符数估算
    return Math.ceil(text.length / 4);
  }

  private formatMessages(messages: ChatMessage[]): unknown[] {
    // MiniMax OpenAI-compat 端点直接支持 system/user/assistant/tool 角色
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
