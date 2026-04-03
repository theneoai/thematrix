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
