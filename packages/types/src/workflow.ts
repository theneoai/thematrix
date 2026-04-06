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

export type ExecutionMode = 'dag' | 'state-machine' | 'dynamic';

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
  /** Dynamic workflow configuration (required when mode is 'dynamic') */
  dynamicConfig?: DynamicWorkflowConfig;
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
  type: 'task' | 'parallel' | 'choice' | 'wait' | 'approval' | 'loop' | 'sub-workflow';
  inputMapping?: Record<string, string>;
  condition?: string;
  retry?: RetryConfig;
  /** Approval gate configuration (for type: 'approval') */
  approval?: ApprovalConfig;
}

export interface ApprovalConfig {
  /** Who can approve: webhook callback, specific users, or auto-approve after timeout */
  strategy: 'webhook' | 'auto-timeout';
  /** Timeout in ms after which to auto-approve or auto-reject */
  timeoutMs?: number;
  /** Action on timeout: 'approve' or 'reject' */
  timeoutAction?: 'approve' | 'reject';
  /** Webhook URL to notify for approval */
  callbackUrl?: string;
  /** Message to include in approval request */
  message?: string;
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

export type StateType = 'task' | 'parallel' | 'choice' | 'wait' | 'succeed' | 'fail' | 'loop' | 'sub-workflow';

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

// ============================================================
// Dynamic Workflow (Orchestrator-driven)
// ============================================================

export interface DynamicWorkflowConfig {
  /** The orchestrator agent that decides routing */
  orchestratorAgentId: string;
  /** Available agents the orchestrator can delegate to */
  availableAgents: string[];
  /** Maximum total handoffs before forced termination */
  maxHandoffs?: number;
}

// ============================================================
// Environment Management
// ============================================================

export type EnvironmentName = 'development' | 'staging' | 'production' | (string & {});

export interface EnvironmentConfig {
  name: EnvironmentName;
  /** Override provider configs per environment */
  providers?: Record<string, Partial<import('./provider.js').ProviderConfig>>;
  /** Override execution backend per environment */
  execution?: {
    backend: 'local' | 'docker' | 'ssh' | 'kubernetes';
    config?: Record<string, unknown>;
  };
  /** Environment-specific variables */
  variables?: Record<string, string>;
}

// ============================================================
// Approval Gate (Human-in-the-Loop)
// ============================================================

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timed_out';

export interface ApprovalRequest {
  id: string;
  workflowRunId: string;
  nodeId: string;
  message: string;
  requestedAt: Date;
  status: ApprovalStatus;
  respondedAt?: Date;
  respondedBy?: string;
  callbackUrl?: string;
}

export interface IApprovalManager {
  requestApproval(request: Omit<ApprovalRequest, 'id' | 'status' | 'requestedAt'>): Promise<ApprovalRequest>;
  approve(approvalId: string, respondedBy?: string): Promise<void>;
  reject(approvalId: string, respondedBy?: string): Promise<void>;
  getStatus(approvalId: string): ApprovalRequest | undefined;
  waitForApproval(approvalId: string, timeoutMs?: number): Promise<ApprovalStatus>;
  listPending(): ApprovalRequest[];
}
