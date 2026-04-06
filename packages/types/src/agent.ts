/**
 * Agent 类型定义
 */

export type AgentStatus = 
  | 'created' 
  | 'initializing' 
  | 'running' 
  | 'paused' 
  | 'stopping' 
  | 'stopped' 
  | 'error';

export interface AgentPersona {
  systemPrompt: string;
  personality: string;
  role: string;
  temperature?: number;
  traits: Record<string, string>;
}

export interface ModelConfig {
  provider: string;
  model: string;
  apiKeyEnvVar?: string;
  baseUrl?: string;
  maxTokens?: number;
}

export interface SkillRef {
  skillId: string;
  config?: Record<string, unknown>;
}

export interface ToolPermission {
  name: string;
  permission: 'allow' | 'confirm' | 'deny';
}

export interface AgentMemoryConfig {
  persistHistory: boolean;
  maxHistoryTurns: number;
  scopes: MemoryScopeConfig[];
}

export interface MemoryScopeConfig {
  scope: 'agent-local' | 'workflow-shared' | 'global';
  access: 'read' | 'write' | 'read-write';
}

export interface AgentDefinition {
  id: string;
  name: string;
  version: string;
  persona: AgentPersona;
  model: ModelConfig;
  skills: SkillRef[];
  tools: ToolPermission[];
  memory: AgentMemoryConfig;
  maxConcurrency: number;
  turnTimeoutMs: number;
  metadata: Record<string, unknown>;
  /** Token 预算配置 (由 @thematrix/providers TokenPool 管理) */
  tokenBudget?: {
    maxTokens: number;
    maxCostUsd?: number;
    period?: 'hourly' | 'daily' | 'per-run' | 'unlimited';
  };
  /** Agent loop configuration -- enables autonomous multi-turn execution */
  loop?: AgentLoopConfig;
  /** Output schema for structured output validation */
  outputSchema?: Record<string, unknown>;
  /** Guardrail hooks applied to input/output */
  guardrails?: GuardrailConfig[];
}

// ============================================================
// Agent Loop (Agentic Execution)
// ============================================================

export type AgentExecutionMode = 'single-turn' | 'loop' | 'plan-and-execute';

export interface AgentLoopConfig {
  /** Execution mode: single-turn (legacy), loop (autonomous), plan-and-execute */
  mode: AgentExecutionMode;
  /** Maximum iterations before forced stop (safety limit) */
  maxIterations?: number;
  /** Maximum total tokens across all iterations */
  maxTotalTokens?: number;
  /** Enable self-reflection after each iteration */
  enableReflection?: boolean;
  /** Enable planning step before execution */
  enablePlanning?: boolean;
  /** Custom exit condition evaluated after each iteration */
  exitCondition?: string;
  /** Handoff targets: agents this agent can delegate to */
  handoffTargets?: string[];
  /** Enable context window management (auto-summarize when history grows large) */
  enableContextManagement?: boolean;
  /** Maximum context tokens before summarization triggers (default: 8000) */
  maxContextTokens?: number;
  /** Enable decision tracing for observability */
  enableTracing?: boolean;
}

/** A single step in an agent-generated plan */
export interface PlanStep {
  id: string;
  description: string;
  agentId?: string;
  toolName?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: unknown;
  dependsOn?: string[];
}

/** Agent-generated execution plan */
export interface AgentPlan {
  planId: string;
  goal: string;
  steps: PlanStep[];
  createdAt: Date;
  status: 'draft' | 'executing' | 'completed' | 'failed' | 'revised';
  revision?: number;
}

/** Reflection result from agent self-evaluation */
export interface ReflectionResult {
  quality: 'good' | 'acceptable' | 'poor';
  issues: string[];
  suggestion: string;
  shouldRetry: boolean;
  shouldRevise: boolean;
}

// ============================================================
// Guardrails
// ============================================================

export type GuardrailType = 'input' | 'output' | 'both';

export interface GuardrailConfig {
  id: string;
  name: string;
  type: GuardrailType;
  /** Built-in guardrail: content-safety, pii-detection, schema-validation, prompt-injection */
  builtin?: string;
  /** Custom guardrail: LLM-based evaluation prompt */
  prompt?: string;
  /** Action on violation */
  action: 'block' | 'warn' | 'rewrite';
  /** Guardrail-specific configuration */
  config?: Record<string, unknown>;
}

export interface GuardrailResult {
  guardrailId: string;
  passed: boolean;
  action: 'block' | 'warn' | 'rewrite';
  violations: GuardrailViolation[];
  rewrittenContent?: string;
}

export interface GuardrailViolation {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  span?: { start: number; end: number };
}

// ============================================================
// Agent Handoff
// ============================================================

export interface HandoffRequest {
  fromAgentId: string;
  toAgentId: string;
  reason: string;
  context: Record<string, unknown>;
  conversationHistory?: boolean;
}

export interface HandoffResult {
  accepted: boolean;
  output?: string;
  error?: string;
}

export interface AgentMetrics {
  startTime?: Date;
  endTime?: Date;
  totalTurns: number;
  totalTokens: number;
  errors: number;
}

export interface AgentInstance {
  instanceId: string;
  definitionId: string;
  workflowRunId: string;
  status: AgentStatus;
  metrics: AgentMetrics;
}

export interface AgentRef {
  ref: string;
  overrides?: Partial<AgentDefinition>;
}
