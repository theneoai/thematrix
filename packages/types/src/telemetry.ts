/**
 * OpenTelemetry 集成类型定义
 *
 * 定义 TheMatrix 的分布式追踪、指标和上下文传播接口。
 * 遵循 OpenTelemetry 语义约定, 支持 OTLP 导出。
 */

// ============================================================
// Trace Context (W3C Trace Context 兼容)
// ============================================================

export interface TraceContext {
  /** Trace ID (32 hex chars) */
  traceId: string;
  /** Span ID (16 hex chars) */
  spanId: string;
  /** Trace flags */
  traceFlags: number;
  /** Trace state (vendor-specific) */
  traceState?: string;
}

// ============================================================
// Telemetry Provider 接口
// ============================================================

export interface ITelemetryProvider {
  /** 创建 span */
  startSpan(name: string, options?: TelemetrySpanOptions): ITelemetrySpan;
  /** 获取当前活跃 span */
  getActiveSpan(): ITelemetrySpan | undefined;
  /** 在 span 上下文中执行函数 */
  withSpan<T>(name: string, fn: (span: ITelemetrySpan) => Promise<T>, options?: TelemetrySpanOptions): Promise<T>;
  /** 注入 trace context 到载体 (用于跨进程传播) */
  inject(carrier: Record<string, string>): void;
  /** 从载体提取 trace context */
  extract(carrier: Record<string, string>): TraceContext | undefined;
  /** 强制刷新所有 pending span */
  flush(): Promise<void>;
  /** 关闭 provider */
  shutdown(): Promise<void>;
}

export interface ITelemetrySpan {
  /** Span 上下文 */
  readonly context: TraceContext;
  /** 设置属性 */
  setAttribute(key: string, value: string | number | boolean): void;
  /** 批量设置属性 */
  setAttributes(attrs: Record<string, string | number | boolean>): void;
  /** 添加事件 */
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
  /** 记录异常 */
  recordException(error: Error): void;
  /** 设置状态 */
  setStatus(status: TelemetrySpanStatus): void;
  /** 结束 span */
  end(): void;
}

export interface TelemetrySpanOptions {
  /** Span 类型 */
  kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
  /** 父 span context */
  parent?: TraceContext;
  /** 初始属性 */
  attributes?: Record<string, string | number | boolean>;
}

export type TelemetrySpanStatus =
  | { code: 'ok' }
  | { code: 'error'; message?: string }
  | { code: 'unset' };

// ============================================================
// Telemetry 配置
// ============================================================

export interface TelemetryConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 服务名称 */
  serviceName?: string;
  /** OTLP 导出端点 */
  exporterEndpoint?: string;
  /** 导出协议 */
  exporterProtocol?: 'grpc' | 'http/protobuf' | 'http/json';
  /** 采样率 (0-1) */
  samplingRate?: number;
  /** 额外资源属性 */
  resourceAttributes?: Record<string, string>;
}

// ============================================================
// TheMatrix 语义约定 (Semantic Conventions)
// ============================================================

/**
 * TheMatrix 专用的 OpenTelemetry 语义属性名称。
 * 遵循 OTel 命名规范: <namespace>.<attribute>
 */
export const TelemetryAttributes = {
  // Agent 属性
  AGENT_ID: 'thematrix.agent.id',
  AGENT_NAME: 'thematrix.agent.name',
  AGENT_MODEL: 'thematrix.agent.model',
  AGENT_PROVIDER: 'thematrix.agent.provider',
  AGENT_EXECUTION_MODE: 'thematrix.agent.execution_mode',
  AGENT_ITERATION: 'thematrix.agent.iteration',

  // Workflow 属性
  WORKFLOW_ID: 'thematrix.workflow.id',
  WORKFLOW_RUN_ID: 'thematrix.workflow.run_id',
  WORKFLOW_NODE_ID: 'thematrix.workflow.node_id',
  WORKFLOW_MODE: 'thematrix.workflow.mode',

  // LLM 属性 (对齐 GenAI semantic conventions)
  LLM_SYSTEM: 'gen_ai.system',
  LLM_MODEL: 'gen_ai.request.model',
  LLM_TEMPERATURE: 'gen_ai.request.temperature',
  LLM_MAX_TOKENS: 'gen_ai.request.max_tokens',
  LLM_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  LLM_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  LLM_TOTAL_TOKENS: 'gen_ai.usage.total_tokens',

  // Tool 属性
  TOOL_NAME: 'thematrix.tool.name',
  TOOL_DURATION_MS: 'thematrix.tool.duration_ms',
  TOOL_SUCCESS: 'thematrix.tool.success',

  // Token 成本
  TOKEN_COST_USD: 'thematrix.token.cost_usd',
  TOKEN_BUDGET_REMAINING: 'thematrix.token.budget_remaining',

  // Guardrail 属性
  GUARDRAIL_ID: 'thematrix.guardrail.id',
  GUARDRAIL_TYPE: 'thematrix.guardrail.type',
} as const;

/**
 * TheMatrix Span 名称约定
 */
export const TelemetrySpanNames = {
  WORKFLOW_RUN: 'thematrix.workflow.run',
  WORKFLOW_NODE: 'thematrix.workflow.node',
  AGENT_LOOP: 'thematrix.agent.loop',
  AGENT_TURN: 'thematrix.agent.turn',
  AGENT_PLAN: 'thematrix.agent.plan',
  AGENT_REFLECT: 'thematrix.agent.reflect',
  LLM_CALL: 'thematrix.llm.call',
  TOOL_CALL: 'thematrix.tool.call',
  GUARDRAIL_CHECK: 'thematrix.guardrail.check',
  HANDOFF: 'thematrix.agent.handoff',
  MEMORY_OPERATION: 'thematrix.memory.operation',
} as const;
