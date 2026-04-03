/**
 * LLM Adapter 类型定义
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCallRequest[];
  toolResults?: ToolCallResult[];
}

export interface ToolCallRequest {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolCallResult {
  toolCallId: string;
  content: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
}

export interface ChatResponse {
  id: string;
  model: string;
  content: string;
  toolCalls?: ToolCallRequest[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ChatStreamChunk {
  id: string;
  content?: string;
  toolCall?: ToolCallRequest;
  finishReason?: 'stop' | 'length' | 'tool_calls';
}

export interface LLMAdapter {
  readonly provider: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk>;
  countTokens(text: string): Promise<number>;
}

export interface LLMAdapterConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
}
