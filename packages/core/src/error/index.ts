/**
 * 错误处理和异常类
 */

export class TheMatrixError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TheMatrixError';
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}

export class AgentError extends TheMatrixError {
  constructor(
    message: string,
    public readonly agentId: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'AGENT_ERROR', context);
    this.name = 'AgentError';
  }
}

export class WorkflowError extends TheMatrixError {
  constructor(
    message: string,
    public readonly workflowId: string,
    public readonly runId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'WORKFLOW_ERROR', context);
    this.name = 'WorkflowError';
  }
}

export class ValidationError extends TheMatrixError {
  constructor(
    message: string,
    public readonly field?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'VALIDATION_ERROR', context);
    this.name = 'ValidationError';
  }
}

export class ConfigurationError extends TheMatrixError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', context);
    this.name = 'ConfigurationError';
  }
}

export class LLMError extends TheMatrixError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    context?: Record<string, unknown>
  ) {
    super(message, 'LLM_ERROR', context);
    this.name = 'LLMError';
  }
}

export class TimeoutError extends TheMatrixError {
  constructor(
    message: string,
    public readonly timeoutMs: number,
    context?: Record<string, unknown>
  ) {
    super(message, 'TIMEOUT_ERROR', context);
    this.name = 'TimeoutError';
  }
}

export class ResourceNotFoundError extends TheMatrixError {
  constructor(
    message: string,
    public readonly resourceType: string,
    public readonly resourceId: string
  ) {
    super(message, 'RESOURCE_NOT_FOUND', { resourceType, resourceId });
    this.name = 'ResourceNotFoundError';
  }
}

export class QuotaExceededError extends TheMatrixError {
  constructor(
    message: string,
    public readonly limit: number,
    public readonly current: number
  ) {
    super(message, 'QUOTA_EXCEEDED', { limit, current });
    this.name = 'QuotaExceededError';
  }
}

/**
 * 错误分类和恢复建议
 */
export const ErrorRecoveryStrategy = {
  RETRY: 'retry',
  ABORT: 'abort',
  SKIP: 'skip',
  FALLBACK: 'fallback',
  MANUAL: 'manual',
} as const;

export type ErrorRecoveryStrategy = typeof ErrorRecoveryStrategy[keyof typeof ErrorRecoveryStrategy];

export interface ErrorClassification {
  strategy: ErrorRecoveryStrategy;
  retryable: boolean;
  maxRetries?: number;
  backoffMs?: number;
}

export function classifyError(error: Error): ErrorClassification {
  // LLM 错误
  if (error instanceof LLMError) {
    // 速率限制或服务器错误，可以重试
    if (error.statusCode === 429 || (error.statusCode && error.statusCode >= 500)) {
      return {
        strategy: ErrorRecoveryStrategy.RETRY,
        retryable: true,
        maxRetries: 3,
        backoffMs: 2000,
      };
    }
    // 认证或配置错误，不重试
    if (error.statusCode === 401 || error.statusCode === 403) {
      return {
        strategy: ErrorRecoveryStrategy.ABORT,
        retryable: false,
      };
    }
  }

  // 超时错误
  if (error instanceof TimeoutError) {
    return {
      strategy: ErrorRecoveryStrategy.RETRY,
      retryable: true,
      maxRetries: 2,
      backoffMs: 1000,
    };
  }

  // 资源未找到
  if (error instanceof ResourceNotFoundError) {
    return {
      strategy: ErrorRecoveryStrategy.ABORT,
      retryable: false,
    };
  }

  // 配额超限
  if (error instanceof QuotaExceededError) {
    return {
      strategy: ErrorRecoveryStrategy.FALLBACK,
      retryable: false,
    };
  }

  // 默认：可重试
  return {
    strategy: ErrorRecoveryStrategy.RETRY,
    retryable: true,
    maxRetries: 1,
    backoffMs: 1000,
  };
}
