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

// ============================================================
// Semantic Memory (Vector Store)
// ============================================================

export interface IVectorStore {
  /** Add documents to the store */
  upsert(collectionName: string, documents: VectorDocument[]): Promise<void>;
  /** Search for similar documents */
  query(collectionName: string, queryVector: number[], topK?: number, filter?: VectorFilter): Promise<VectorSearchResult[]>;
  /** Delete documents by IDs */
  remove(collectionName: string, ids: string[]): Promise<void>;
  /** Create a collection/namespace */
  createCollection(name: string, dimension: number): Promise<void>;
  /** Drop a collection */
  dropCollection(name: string): Promise<void>;
}

export interface VectorDocument {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorFilter {
  [key: string]: string | number | boolean | string[];
}

export interface IEmbeddingProvider {
  /** Generate embeddings for texts */
  embed(texts: string[]): Promise<number[][]>;
  /** Embedding dimension */
  readonly dimension: number;
  /** Model name */
  readonly model: string;
}

// ============================================================
// Evaluation Types
// ============================================================

export interface EvalCase {
  id: string;
  input: string;
  expectedOutput?: string;
  metadata?: Record<string, unknown>;
}

export interface EvalResult {
  caseId: string;
  agentId: string;
  output: string;
  scores: EvalScore[];
  latencyMs: number;
  tokenCount: number;
  timestamp: Date;
}

export interface EvalScore {
  metric: string;
  score: number;
  reason?: string;
}

export interface EvalSuite {
  id: string;
  name: string;
  description?: string;
  cases: EvalCase[];
  metrics: EvalMetricConfig[];
}

export interface EvalMetricConfig {
  name: string;
  /** Built-in: 'exact-match', 'contains', 'llm-judge', 'semantic-similarity', 'json-validity' */
  type: string;
  /** For llm-judge: the evaluation prompt */
  prompt?: string;
  /** For llm-judge: the model to use for evaluation */
  model?: string;
  /** Threshold for pass/fail */
  threshold?: number;
}

// ============================================================
// Policy Engine Types
// ============================================================

export interface Policy {
  id: string;
  name: string;
  description?: string;
  /** When this policy applies */
  scope: PolicyScope;
  /** Policy rules */
  rules: PolicyRule[];
  /** Action on violation */
  enforcement: 'enforce' | 'audit' | 'warn';
}

export type PolicyScope =
  | { type: 'global' }
  | { type: 'workflow'; workflowId: string }
  | { type: 'agent'; agentId: string }
  | { type: 'environment'; environment: string };

export interface PolicyRule {
  id: string;
  description: string;
  /** Condition expression (evaluated against context) */
  condition: string;
  /** Effect when condition matches */
  effect: 'allow' | 'deny';
}

export interface PolicyEvalContext {
  workflowId?: string;
  agentId?: string;
  environment?: string;
  action: string;
  resource: string;
  metadata?: Record<string, unknown>;
}

export interface PolicyEvalResult {
  allowed: boolean;
  violations: PolicyViolation[];
}

export interface PolicyViolation {
  policyId: string;
  ruleId: string;
  message: string;
  enforcement: 'enforce' | 'audit' | 'warn';
}

export interface IPolicyEngine {
  addPolicy(policy: Policy): void;
  removePolicy(policyId: string): void;
  evaluate(context: PolicyEvalContext): PolicyEvalResult;
  listPolicies(): Policy[];
}
