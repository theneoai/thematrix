/**
 * Memory 类型定义
 */
import type { ToolCallRequest, ToolCallResult } from './llm.js';

export type MemoryScope = 'agent-local' | 'workflow-shared' | 'global';

export interface MemoryEntry {
  key: string;
  value: unknown;
  createdAt: Date;
  expiresAt?: Date;
}

export interface VectorMemoryEntry {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  score?: number;
}

export interface ConversationTurn {
  turnId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCallRequest[];
  toolResults?: ToolCallResult[];
  timestamp: Date;
}

// Re-export ToolCall types from llm.ts
export type { ToolCallRequest as ToolCall, ToolCallResult as ToolResult } from './llm.js';

export interface IMemoryManager {
  // KV store
  get(scope: MemoryScope, ownerId: string, key: string): Promise<unknown | undefined>;
  set(scope: MemoryScope, ownerId: string, key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(scope: MemoryScope, ownerId: string, key: string): Promise<boolean>;
  list(scope: MemoryScope, ownerId: string, prefix?: string): Promise<MemoryEntry[]>;
  
  // Vector memory
  embed(scope: MemoryScope, ownerId: string, content: string, metadata?: Record<string, unknown>): Promise<string>;
  search(scope: MemoryScope, ownerId: string, query: string, topK?: number): Promise<VectorMemoryEntry[]>;
  
  // Conversation history
  appendTurn(agentInstanceId: string, turn: ConversationTurn): Promise<string>;
  getHistory(agentInstanceId: string, limit?: number): Promise<ConversationTurn[]>;
  clearHistory(agentInstanceId: string): Promise<void>;
}
