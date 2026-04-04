/**
 * Workflow 类型定义
 */

import type { AgentRef } from './agent.js';

export type WorkflowStatus = 
  | 'draft' 
  | 'pending' 
  | 'running' 
  | 'paused' 
  | 'completed' 
  | 'failed' 
  | 'cancelled' 
  | 'timed_out';

export type ExecutionMode = 'dag' | 'state-machine';

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  mode: ExecutionMode;
  agents: Record<string, AgentRef>;
  dag?: DAGDefinition;
  stateMachine?: StateMachineDefinition;
  sharedMemory: WorkflowMemoryConfig;
  schedule?: ScheduleConfig;
  integrations?: IntegrationConfig[];
  timeoutMs?: number;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  /** 执行后端配置 (Local / Docker / SSH / K8s) */
  execution?: {
    backend: 'local' | 'docker' | 'ssh' | 'kubernetes';
    config?: Record<string, unknown>;
    parallelism?: number;
  };
}

export interface DAGDefinition {
  nodes: DAGNode[];
  edges: DAGEdge[];
}

export interface DAGNode {
  id: string;
  agentId: string;
  type: 'task' | 'parallel' | 'choice' | 'wait';
  inputMapping?: Record<string, string>;
  condition?: string;
  retry?: RetryConfig;
}

export interface DAGEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface RetryConfig {
  maxRetries: number;
  retryDelayMs: number;
}

export interface StateMachineDefinition {
  initialState: string;
  states: Record<string, StateDefinition>;
}

export type StateType = 'task' | 'parallel' | 'choice' | 'wait' | 'succeed' | 'fail';

export interface StateDefinition {
  type: StateType;
  agentId?: string;
  inputMapping?: Record<string, string>;
  next?: string;
  choices?: ChoiceRule[];
  retry?: RetryConfig;
  seconds?: number;
  timestamp?: string;
}

export interface ChoiceRule {
  condition: string;
  next: string;
}

export interface WorkflowMemoryConfig {
  kvStore: 'in-memory' | 'sqlite';
  persistent: boolean;
}

export interface ScheduleConfig {
  cron?: string;
  startAt?: string;
  maxDurationMs?: number;
  timezone?: string;
}

export interface IntegrationConfig {
  type: 'webhook-in' | 'webhook-out' | 'mcp';
  id: string;
  config: Record<string, unknown>;
}

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  status: WorkflowStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  context: WorkflowContext;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface WorkflowContext {
  variables: Record<string, unknown>;
  nodeOutputs: Record<string, unknown>;
}
