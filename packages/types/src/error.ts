/**
 * Unified Error Type Hierarchy
 *
 * Provides structured, recoverable error types for all TheMatrix subsystems.
 */

export enum ErrorCode {
  // Agent errors
  AGENT_TURN_TIMEOUT = 'AGENT_TURN_TIMEOUT',
  AGENT_TURN_CONCURRENT = 'AGENT_TURN_CONCURRENT',
  AGENT_TOKEN_BUDGET_EXCEEDED = 'AGENT_TOKEN_BUDGET_EXCEEDED',
  AGENT_GUARDRAIL_BLOCKED = 'AGENT_GUARDRAIL_BLOCKED',
  AGENT_GUARDRAIL_REWRITE_DEPTH = 'AGENT_GUARDRAIL_REWRITE_DEPTH',
  AGENT_TOOL_NOT_FOUND = 'AGENT_TOOL_NOT_FOUND',
  AGENT_INVALID_STATE = 'AGENT_INVALID_STATE',
  AGENT_MAX_ITERATIONS = 'AGENT_MAX_ITERATIONS',

  // Workflow errors
  WORKFLOW_CIRCULAR_DEPENDENCY = 'WORKFLOW_CIRCULAR_DEPENDENCY',
  WORKFLOW_NODE_FAILED = 'WORKFLOW_NODE_FAILED',
  WORKFLOW_TIMEOUT = 'WORKFLOW_TIMEOUT',
  WORKFLOW_CANCELLED = 'WORKFLOW_CANCELLED',
  WORKFLOW_MAX_CONCURRENT = 'WORKFLOW_MAX_CONCURRENT',
  WORKFLOW_APPROVAL_REJECTED = 'WORKFLOW_APPROVAL_REJECTED',
  WORKFLOW_APPROVAL_TIMEOUT = 'WORKFLOW_APPROVAL_TIMEOUT',
  WORKFLOW_INVALID_INPUT = 'WORKFLOW_INVALID_INPUT',

  // Provider errors
  PROVIDER_RATE_LIMITED = 'PROVIDER_RATE_LIMITED',
  PROVIDER_AUTH_FAILED = 'PROVIDER_AUTH_FAILED',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  PROVIDER_BUDGET_EXCEEDED = 'PROVIDER_BUDGET_EXCEEDED',
  PROVIDER_NOT_FOUND = 'PROVIDER_NOT_FOUND',

  // Infrastructure errors
  EXECUTOR_BACKEND_FAILED = 'EXECUTOR_BACKEND_FAILED',
  EXECUTOR_BACKEND_NOT_FOUND = 'EXECUTOR_BACKEND_NOT_FOUND',
  CLUSTER_NODE_OFFLINE = 'CLUSTER_NODE_OFFLINE',
  CLUSTER_NO_AVAILABLE_NODE = 'CLUSTER_NO_AVAILABLE_NODE',
  MEMORY_STORE_ERROR = 'MEMORY_STORE_ERROR',

  // Gateway errors
  GATEWAY_RATE_LIMITED = 'GATEWAY_RATE_LIMITED',
  GATEWAY_SIGNATURE_INVALID = 'GATEWAY_SIGNATURE_INVALID',
  GATEWAY_PARSE_ERROR = 'GATEWAY_PARSE_ERROR',

  // Protocol errors
  MCP_TOOL_NOT_FOUND = 'MCP_TOOL_NOT_FOUND',
  MCP_VALIDATION_ERROR = 'MCP_VALIDATION_ERROR',
  A2A_TASK_NOT_FOUND = 'A2A_TASK_NOT_FOUND',
  A2A_AGENT_NOT_FOUND = 'A2A_AGENT_NOT_FOUND',

  // Generic
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/** Classification of an error for retry/handling decisions */
export interface ErrorClassification {
  code: ErrorCode;
  recoverable: boolean;
  retryable: boolean;
  retryAfterMs?: number;
  /** Suggested action for the caller */
  suggestedAction?: 'retry' | 'failover' | 'abort' | 'degrade';
}

/** Base error class for all TheMatrix errors */
export class MatrixError extends Error {
  public readonly code: ErrorCode;
  public readonly recoverable: boolean;
  public readonly retryable: boolean;
  public readonly retryAfterMs?: number;
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: Date;

  constructor(
    message: string,
    code: ErrorCode,
    options?: {
      recoverable?: boolean;
      retryable?: boolean;
      retryAfterMs?: number;
      context?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'MatrixError';
    this.code = code;
    this.recoverable = options?.recoverable ?? false;
    this.retryable = options?.retryable ?? false;
    this.retryAfterMs = options?.retryAfterMs;
    this.context = options?.context;
    this.timestamp = new Date();
  }

  /** Classify this error for handling decisions */
  classify(): ErrorClassification {
    return {
      code: this.code,
      recoverable: this.recoverable,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
      suggestedAction: this.retryable ? 'retry' : this.recoverable ? 'degrade' : 'abort',
    };
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      recoverable: this.recoverable,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
    };
  }
}

/** Agent-specific errors */
export class AgentError extends MatrixError {
  public readonly agentId: string;
  public readonly instanceId?: string;

  constructor(
    message: string,
    code: ErrorCode,
    agentId: string,
    options?: {
      instanceId?: string;
      recoverable?: boolean;
      retryable?: boolean;
      retryAfterMs?: number;
      context?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, code, options);
    this.name = 'AgentError';
    this.agentId = agentId;
    this.instanceId = options?.instanceId;
  }
}

/** Workflow-specific errors */
export class WorkflowExecutionError extends MatrixError {
  public readonly workflowId: string;
  public readonly runId?: string;
  public readonly nodeId?: string;

  constructor(
    message: string,
    code: ErrorCode,
    workflowId: string,
    options?: {
      runId?: string;
      nodeId?: string;
      recoverable?: boolean;
      retryable?: boolean;
      context?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, code, options);
    this.name = 'WorkflowExecutionError';
    this.workflowId = workflowId;
    this.runId = options?.runId;
    this.nodeId = options?.nodeId;
  }
}

/** Provider-specific errors */
export class ProviderError extends MatrixError {
  public readonly provider: string;
  public readonly model?: string;

  constructor(
    message: string,
    code: ErrorCode,
    provider: string,
    options?: {
      model?: string;
      recoverable?: boolean;
      retryable?: boolean;
      retryAfterMs?: number;
      context?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, code, options);
    this.name = 'ProviderError';
    this.provider = provider;
    this.model = options?.model;
  }
}

/** Utility: check if an unknown error is a MatrixError */
export function isMatrixError(error: unknown): error is MatrixError {
  return error instanceof MatrixError;
}

/** Utility: wrap an unknown error into a MatrixError */
export function wrapError(error: unknown, code: ErrorCode = ErrorCode.INTERNAL_ERROR): MatrixError {
  if (error instanceof MatrixError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;
  return new MatrixError(message, code, { cause });
}
