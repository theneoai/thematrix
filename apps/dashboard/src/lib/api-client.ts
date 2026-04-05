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

// Workflow endpoints
export const api = {
  workflows: {
    list: () => fetchAPI<WorkflowRunSummary[]>('/api/workflows'),
    get: (runId: string) => fetchAPI<WorkflowRunDetail>(`/api/workflows/${runId}`),
    events: (runId: string) => fetchAPI<DomainEventDTO[]>(`/api/workflows/${runId}/events`),
  },
  agents: {
    list: () => fetchAPI<AgentSummary[]>('/api/agents'),
    get: (id: string) => fetchAPI<AgentDetail>(`/api/agents/${id}`),
  },
  tokens: {
    usage: () => fetchAPI<TokenUsageSummary[]>('/api/tokens/usage'),
    budget: (ownerId: string) => fetchAPI<TokenBudgetInfo>(`/api/tokens/budget/${ownerId}`),
  },
  cluster: {
    nodes: () => fetchAPI<ClusterNodeInfo[]>('/api/cluster/nodes'),
    health: () => fetchAPI<ClusterHealthInfo>('/api/cluster/health'),
  },
  triggers: {
    list: () => fetchAPI<TriggerRuleInfo[]>('/api/triggers'),
  },
  schedules: {
    list: () => fetchAPI<CronScheduleInfo[]>('/api/schedules'),
  },
  alerts: {
    active: () => fetchAPI<AlertInfo[]>('/api/alerts'),
    rules: () => fetchAPI<AlertRuleInfo[]>('/api/alerts/rules'),
  },
  health: () => fetchAPI<HealthInfo>('/health'),
};

// SSE event stream
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

// DTO types (matching monitor API responses)
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
}

export interface DomainEventDTO {
  eventId: string;
  type: string;
  timestamp: string;
  payload: unknown;
}

export interface AgentSummary {
  id: string;
  name: string;
  version: string;
  provider: string;
  model: string;
  status: string;
}

export interface AgentDetail extends AgentSummary {
  persona: { role: string; personality: string };
  metrics: { totalTurns: number; totalTokens: number; errors: number };
}

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
}

export interface ClusterNodeInfo {
  nodeId: string;
  hostname: string;
  status: string;
  activeTasks: number;
  cpuUsage: number;
  memoryUsage: number;
}

export interface ClusterHealthInfo {
  totalNodes: number;
  onlineNodes: number;
  totalActiveTasks: number;
  status: string;
}

export interface TriggerRuleInfo {
  id: string;
  name: string;
  channel: string;
  eventType: string;
  workflowId: string;
  enabled: boolean;
}

export interface CronScheduleInfo {
  id: string;
  name: string;
  cron: string;
  workflowId: string;
  enabled: boolean;
  nextRun?: string;
}

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
}

export interface HealthInfo {
  status: string;
  components: Record<string, { healthy: boolean; message?: string }>;
}
