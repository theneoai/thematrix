/**
 * Typed API client for @thematrix/monitor REST API
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const DEFAULT_TIMEOUT_MS = 15_000;

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: options?.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

function postAPI<T>(path: string, body?: unknown): Promise<T> {
  return fetchAPI<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
}

function putAPI<T>(path: string, body?: unknown): Promise<T> {
  return fetchAPI<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
}

function deleteAPI<T = void>(path: string): Promise<T> {
  return fetchAPI<T>(path, { method: 'DELETE' });
}

// ─── API Client ──────────────────────────────────────────────────────────────

export const api = {
  // ── Workflows ──────────────────────────────────────────────
  workflows: {
    list: () => fetchAPI<WorkflowRunSummary[]>('/api/workflows'),
    get: (runId: string) => fetchAPI<WorkflowRunDetail>(`/api/workflows/${runId}`),
    events: (runId: string) => fetchAPI<DomainEventDTO[]>(`/api/workflows/${runId}/events`),
    start: (workflowId: string, input?: Record<string, unknown>) =>
      postAPI<{ runId: string }>('/api/workflows', { workflowId, input }),
    pause: (runId: string) => postAPI<void>(`/api/workflows/${runId}/pause`),
    resume: (runId: string) => postAPI<void>(`/api/workflows/${runId}/resume`),
    cancel: (runId: string) => postAPI<void>(`/api/workflows/${runId}/cancel`),
  },

  // ── Agents ─────────────────────────────────────────────────
  agents: {
    list: () => fetchAPI<AgentSummary[]>('/api/agents'),
    get: (id: string) => fetchAPI<AgentDetail>(`/api/agents/${id}`),
    register: (definition: AgentDefinitionInput) =>
      postAPI<{ id: string }>('/api/agents', definition),
    unregister: (id: string) => deleteAPI(`/api/agents/${id}`),
    pause: (id: string) => postAPI<void>(`/api/agents/${id}/pause`),
    resume: (id: string) => postAPI<void>(`/api/agents/${id}/resume`),
    stop: (id: string) => postAPI<void>(`/api/agents/${id}/stop`),
  },

  // ── Tokens ─────────────────────────────────────────────────
  tokens: {
    usage: () => fetchAPI<TokenUsageSummary[]>('/api/tokens/usage'),
    budget: (ownerId: string) => fetchAPI<TokenBudgetInfo>(`/api/tokens/budget/${ownerId}`),
    allocateBudget: (ownerId: string, budget: TokenBudgetInput) =>
      postAPI<void>(`/api/tokens/budget/${ownerId}`, budget),
    updateBudget: (ownerId: string, budget: Partial<TokenBudgetInput>) =>
      putAPI<void>(`/api/tokens/budget/${ownerId}`, budget),
  },

  // ── Cluster ────────────────────────────────────────────────
  cluster: {
    nodes: () => fetchAPI<ClusterNodeInfo[]>('/api/cluster/nodes'),
    health: () => fetchAPI<ClusterHealthInfo>('/api/cluster/health'),
    stats: () => fetchAPI<ClusterStatsInfo>('/api/cluster/stats'),
    drainNode: (nodeId: string) => postAPI<void>(`/api/cluster/nodes/${nodeId}/drain`),
    enableNode: (nodeId: string) => postAPI<void>(`/api/cluster/nodes/${nodeId}/enable`),
    setStrategy: (strategy: string) => putAPI<void>('/api/cluster/strategy', { strategy }),
  },

  // ── Triggers ───────────────────────────────────────────────
  triggers: {
    list: () => fetchAPI<TriggerRuleInfo[]>('/api/triggers'),
    get: (id: string) => fetchAPI<TriggerRuleInfo>(`/api/triggers/${id}`),
    create: (rule: TriggerRuleInput) => postAPI<{ id: string }>('/api/triggers', rule),
    update: (id: string, rule: Partial<TriggerRuleInput>) =>
      putAPI<void>(`/api/triggers/${id}`, rule),
    delete: (id: string) => deleteAPI(`/api/triggers/${id}`),
    toggle: (id: string, enabled: boolean) =>
      putAPI<void>(`/api/triggers/${id}`, { enabled }),
  },

  // ── Schedules ──────────────────────────────────────────────
  schedules: {
    list: () => fetchAPI<CronScheduleInfo[]>('/api/schedules'),
    get: (id: string) => fetchAPI<CronScheduleInfo>(`/api/schedules/${id}`),
    create: (schedule: CronScheduleInput) => postAPI<{ id: string }>('/api/schedules', schedule),
    update: (id: string, schedule: Partial<CronScheduleInput>) =>
      putAPI<void>(`/api/schedules/${id}`, schedule),
    delete: (id: string) => deleteAPI(`/api/schedules/${id}`),
    toggle: (id: string, enabled: boolean) =>
      putAPI<void>(`/api/schedules/${id}`, { enabled }),
  },

  // ── Alerts ─────────────────────────────────────────────────
  alerts: {
    active: () => fetchAPI<AlertInfo[]>('/api/alerts'),
    acknowledge: (id: string) => postAPI<void>(`/api/alerts/${id}/acknowledge`),
    resolve: (id: string) => postAPI<void>(`/api/alerts/${id}/resolve`),
    rules: () => fetchAPI<AlertRuleInfo[]>('/api/alerts/rules'),
    createRule: (rule: AlertRuleInput) => postAPI<{ id: string }>('/api/alerts/rules', rule),
    updateRule: (id: string, rule: Partial<AlertRuleInput>) =>
      putAPI<void>(`/api/alerts/rules/${id}`, rule),
    deleteRule: (id: string) => deleteAPI(`/api/alerts/rules/${id}`),
    toggleRule: (id: string, enabled: boolean) =>
      putAPI<void>(`/api/alerts/rules/${id}`, { enabled }),
  },

  // ── Approvals ──────────────────────────────────────────────
  approvals: {
    list: () => fetchAPI<ApprovalInfo[]>('/api/approvals'),
    get: (id: string) => fetchAPI<ApprovalInfo>(`/api/approvals/${id}`),
    approve: (id: string, comment?: string) =>
      postAPI<void>(`/api/approvals/${id}/approve`, { comment }),
    reject: (id: string, reason?: string) =>
      postAPI<void>(`/api/approvals/${id}/reject`, { reason }),
  },

  // ── Policies ───────────────────────────────────────────────
  policies: {
    list: () => fetchAPI<PolicyInfo[]>('/api/policies'),
    get: (id: string) => fetchAPI<PolicyInfo>(`/api/policies/${id}`),
    create: (policy: PolicyInput) => postAPI<{ id: string }>('/api/policies', policy),
    update: (id: string, policy: Partial<PolicyInput>) =>
      putAPI<void>(`/api/policies/${id}`, policy),
    delete: (id: string) => deleteAPI(`/api/policies/${id}`),
  },

  // ── Guardrails ─────────────────────────────────────────────
  guardrails: {
    list: () => fetchAPI<GuardrailInfo[]>('/api/guardrails'),
    violations: () => fetchAPI<GuardrailViolation[]>('/api/guardrails/violations'),
  },

  // ── Providers ──────────────────────────────────────────────
  providers: {
    list: () => fetchAPI<ProviderInfo[]>('/api/providers'),
    health: () => fetchAPI<ProviderHealthInfo[]>('/api/providers/health'),
    configure: (provider: string, config: ProviderConfigInput) =>
      putAPI<void>(`/api/providers/${provider}`, config),
  },

  // ── Environments ───────────────────────────────────────────
  environments: {
    list: () => fetchAPI<EnvironmentInfo[]>('/api/environments'),
    get: (name: string) => fetchAPI<EnvironmentInfo>(`/api/environments/${name}`),
    setActive: (name: string) => postAPI<void>(`/api/environments/${name}/activate`),
  },

  // ── Eval ───────────────────────────────────────────────────
  eval: {
    suites: () => fetchAPI<EvalSuiteInfo[]>('/api/eval/suites'),
    run: (suiteId: string) => postAPI<{ runId: string }>(`/api/eval/suites/${suiteId}/run`),
    results: (runId: string) => fetchAPI<EvalResultInfo[]>(`/api/eval/runs/${runId}`),
  },

  // ── System ─────────────────────────────────────────────────
  health: () => fetchAPI<HealthInfo>('/health'),
  events: () => fetchAPI<DomainEventDTO[]>('/api/events'),
};

// ─── SSE Event Stream ────────────────────────────────────────────────────────

export interface EventStreamOptions {
  onEvent: (event: { type: string; data: unknown }) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

export function createEventStream(options: EventStreamOptions): EventSource {
  const es = new EventSource(`${API_BASE}/api/events/stream`);

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      options.onEvent(data);
    } catch {
      // skip unparseable events
    }
  };

  es.onerror = (e) => {
    options.onError?.(e);
  };

  es.onopen = () => {
    options.onOpen?.();
  };

  return es;
}

// ─── DTO Types ───────────────────────────────────────────────────────────────

// Workflow
export interface WorkflowRunSummary {
  runId: string;
  workflowId: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  nodeCount: number;
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  nodeOutputs: Record<string, unknown>;
  nodes?: WorkflowNodeInfo[];
}

export interface WorkflowNodeInfo {
  id: string;
  agentId: string;
  type: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  output?: unknown;
  error?: string;
}

export interface DomainEventDTO {
  eventId: string;
  type: string;
  timestamp: string;
  payload: unknown;
}

// Agent
export interface AgentSummary {
  id: string;
  name: string;
  version: string;
  provider: string;
  model: string;
  status: string;
}

export interface AgentDetail extends AgentSummary {
  persona: { role: string; personality: string; systemPrompt?: string };
  metrics: { totalTurns: number; totalTokens: number; errors: number };
  tools?: string[];
  guardrails?: string[];
  loopConfig?: { mode: string; maxIterations: number };
  memoryConfig?: { persistHistory: boolean; maxHistoryTurns: number };
}

export interface AgentDefinitionInput {
  name: string;
  version?: string;
  persona: { role: string; personality: string; systemPrompt?: string };
  model: { provider: string; model: string; maxTokens?: number };
  tools?: string[];
  guardrails?: string[];
  loopConfig?: { mode: string; maxIterations?: number };
}

// Token
export interface TokenUsageSummary {
  ownerId: string;
  ownerType: string;
  totalTokens: number;
  totalCostUsd: number;
}

export interface TokenBudgetInfo {
  ownerId: string;
  maxTokens: number;
  remaining: number;
  usagePercent: number;
  maxCostUsd?: number;
  period?: string;
}

export interface TokenBudgetInput {
  maxTokens: number;
  maxCostUsd?: number;
  period: 'hourly' | 'daily' | 'per-run' | 'unlimited';
  alertThreshold?: number;
}

// Cluster
export interface ClusterNodeInfo {
  nodeId: string;
  hostname: string;
  status: string;
  activeTasks: number;
  cpuUsage: number;
  memoryUsage: number;
  labels?: Record<string, string>;
}

export interface ClusterHealthInfo {
  totalNodes: number;
  onlineNodes: number;
  totalActiveTasks: number;
  status: string;
}

export interface ClusterStatsInfo {
  totalNodes: number;
  healthyNodes: number;
  drainingNodes: number;
  taskQueueSize: number;
  throughputPerHour: number;
  errorRate: number;
  avgTaskDurationMs: number;
  strategy: string;
}

// Triggers
export interface TriggerRuleInfo {
  id: string;
  name: string;
  channel: string;
  eventType: string;
  workflowId: string;
  enabled: boolean;
  cooldownMs?: number;
  maxConcurrent?: number;
}

export interface TriggerRuleInput {
  name: string;
  channel: string;
  eventType: string;
  workflowId: string;
  enabled?: boolean;
  cooldownMs?: number;
  maxConcurrent?: number;
  conditions?: { field: string; operator: string; value: string }[];
  inputMapping?: Record<string, string>;
}

// Schedules
export interface CronScheduleInfo {
  id: string;
  name: string;
  cron: string;
  workflowId: string;
  enabled: boolean;
  nextRun?: string;
  timezone?: string;
}

export interface CronScheduleInput {
  name: string;
  cron: string;
  workflowId: string;
  enabled?: boolean;
  timezone?: string;
  input?: Record<string, unknown>;
}

// Alerts
export interface AlertInfo {
  id: string;
  ruleId: string;
  severity: string;
  title: string;
  message: string;
  firedAt: string;
  status: string;
}

export interface AlertRuleInfo {
  id: string;
  name: string;
  metric: string;
  severity: string;
  enabled: boolean;
  condition?: string;
  threshold?: number;
}

export interface AlertRuleInput {
  name: string;
  metric: string;
  severity: 'info' | 'warning' | 'critical';
  enabled?: boolean;
  condition?: string;
  threshold?: number;
}

// Approvals
export interface ApprovalInfo {
  id: string;
  workflowRunId: string;
  nodeId: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected' | 'timed_out';
  requestedAt: string;
  respondedAt?: string;
  respondedBy?: string;
}

// Policies
export interface PolicyInfo {
  id: string;
  name: string;
  scope: string;
  enforcement: string;
  rules: PolicyRuleInfo[];
}

export interface PolicyRuleInfo {
  id: string;
  description: string;
  effect: 'allow' | 'deny';
  condition: Record<string, unknown>;
}

export interface PolicyInput {
  name: string;
  scope: 'global' | 'workflow' | 'agent' | 'environment';
  enforcement: 'enforce' | 'audit' | 'warn';
  rules: { description: string; effect: 'allow' | 'deny'; condition: Record<string, unknown> }[];
}

// Guardrails
export interface GuardrailInfo {
  id: string;
  name: string;
  type: 'input' | 'output' | 'both';
  builtin: boolean;
  action: 'block' | 'warn' | 'rewrite';
}

export interface GuardrailViolation {
  guardrailId: string;
  guardrailName: string;
  agentId: string;
  severity: string;
  message: string;
  timestamp: string;
  action: string;
}

// Providers
export interface ProviderInfo {
  name: string;
  displayName: string;
  models: { id: string; name: string; contextWindow: number }[];
  configured: boolean;
}

export interface ProviderHealthInfo {
  name: string;
  healthy: boolean;
  latencyMs: number;
  message?: string;
}

export interface ProviderConfigInput {
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
  rateLimit?: { rpm?: number; tpm?: number; maxConcurrent?: number };
  timeout?: number;
}

// Environments
export interface EnvironmentInfo {
  name: string;
  active: boolean;
  variables: Record<string, string>;
  providerOverrides?: Record<string, unknown>;
}

// Eval
export interface EvalSuiteInfo {
  id: string;
  name: string;
  caseCount: number;
  lastRunAt?: string;
  lastScore?: number;
}

export interface EvalResultInfo {
  caseId: string;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  scores: { metric: string; score: number; reason?: string }[];
  passed: boolean;
  latencyMs: number;
  tokenCount: number;
}

// Health
export interface HealthInfo {
  status: string;
  components: Record<string, { healthy: boolean; message?: string }>;
}
