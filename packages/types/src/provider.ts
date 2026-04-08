/**
 * Provider & Token Pool 类型定义
 *
 * 借鉴 OpenClaw 的 Provider Plugin 模式和 SecretRef 凭证管理
 */

import type { LLMAdapter } from './llm.js';

// ============================================================
// Provider Plugin System
// ============================================================

/** 支持的 LLM 提供商 */
export type ProviderName =
  | 'openai'
  | 'anthropic'
  | 'google-gemini'
  | 'deepseek'
  | 'ollama'
  | 'vllm'
  | 'openrouter'
  | 'moonshot'
  | 'minimax'
  | 'qwen'
  | 'huggingface'
  | 'azure-openai'
  | 'opencode'
  | 'kimicode'
  | 'kimi'
  | 'cohere'
  | (string & {}); // allow custom providers

/** Provider 插件接口 (借鉴 OpenClaw prepareRuntimeAuth 模式) */
export interface ProviderPlugin {
  readonly name: ProviderName;
  readonly displayName: string;
  readonly models: ModelInfo[];

  /** 将配置凭证转换为运行时短期 token */
  prepareRuntimeAuth(config: ProviderConfig): Promise<RuntimeAuth>;

  /** 创建 LLM 适配器实例 */
  createAdapter(auth: RuntimeAuth, model: string): LLMAdapter;

  /** 健康检查 */
  healthCheck(): Promise<HealthStatus>;

  /** 获取用量快照 (可选) */
  fetchUsage?(): Promise<UsageSnapshot>;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputPricePerMToken?: number;  // USD per million tokens
  outputPricePerMToken?: number;
  capabilities?: ModelCapability[];
}

export type ModelCapability =
  | 'chat'
  | 'completion'
  | 'embedding'
  | 'vision'
  | 'tool-calling'
  | 'streaming'
  | 'json-mode';

export interface ProviderConfig {
  provider: ProviderName;
  apiKey?: string | SecretRef;
  baseUrl?: string;
  models?: string[];
  rateLimit?: RateLimitConfig;
  timeout?: number;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

/** 安全凭证引用 (借鉴 OpenClaw SecretRef 模式) */
export interface SecretRef {
  type: 'env' | 'vault' | 'file';
  ref: string;         // 环境变量名 / Vault path / 文件路径
  version?: string;    // 用于凭证轮换
}

export interface RuntimeAuth {
  provider: ProviderName;
  token: string;
  baseUrl: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface HealthStatus {
  provider: ProviderName;
  healthy: boolean;
  latencyMs?: number;
  message?: string;
  checkedAt: Date;
}

export interface UsageSnapshot {
  provider: ProviderName;
  totalTokensUsed: number;
  totalCostUsd: number;
  periodStart: Date;
  periodEnd: Date;
  breakdown?: Record<string, number>; // model → tokens
}

export interface RateLimitConfig {
  /** Requests per minute */
  rpm?: number;
  /** Tokens per minute */
  tpm?: number;
  /** Concurrent requests */
  maxConcurrent?: number;
}

// ============================================================
// Token Resource Pool
// ============================================================

export interface TokenBudget {
  maxTokens: number;
  maxCostUsd?: number;
  period: 'hourly' | 'daily' | 'per-run' | 'unlimited';
  providers?: ProviderName[];  // 允许的 providers, undefined = all
  alertThreshold?: number;     // 0-1, 达到预算百分比时告警
}

export interface TokenUsage {
  ownerId: string;
  ownerType: 'agent' | 'workflow' | 'global';
  totalTokens: number;
  totalCostUsd: number;
  periodStart: Date;
  breakdown: TokenUsageBreakdown[];
}

export interface TokenUsageBreakdown {
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  requestCount: number;
}

export interface ITokenPool {
  /** 分配预算 */
  allocate(ownerId: string, ownerType: 'agent' | 'workflow' | 'global', budget: TokenBudget): void;

  /** 消费 token (会检查预算和限流) */
  consume(ownerId: string, usage: TokenConsumption): Promise<void>;

  /** 查询用量 */
  getUsage(ownerId: string): TokenUsage | undefined;

  /** 获取剩余预算 */
  getRemainingBudget(ownerId: string): number;

  /** 检查是否允许请求 (限流) */
  canRequest(provider: ProviderName): boolean;

  /** 设置 Provider 级别限流 */
  setRateLimit(provider: ProviderName, config: RateLimitConfig): void;

  /** 重置用量 (period 结束时) */
  resetUsage(ownerId: string): void;

  /** 获取全局用量汇总 */
  getGlobalUsage(): TokenUsage[];
}

export interface TokenConsumption {
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

// ============================================================
// Provider Router
// ============================================================

export interface ProviderRouterConfig {
  /** Provider 优先级列表 */
  providers: ProviderConfig[];
  /** 失败时自动切换到下一个 provider */
  failover: boolean;
  /** 路由策略 */
  strategy: 'priority' | 'round-robin' | 'least-cost' | 'least-latency';
}

export interface IProviderRegistry {
  register(plugin: ProviderPlugin): void;
  get(provider: ProviderName): ProviderPlugin | undefined;
  list(): ProviderPlugin[];
  healthCheckAll(): Promise<HealthStatus[]>;
}
