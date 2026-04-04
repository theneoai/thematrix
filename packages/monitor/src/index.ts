/**
 * @thematrix/monitor - REST API + SSE for real-time monitoring
 */

export { MonitorAPI } from './api.js';
export type {
  MonitorDataProviders,
  WorkflowRunSummary,
  AgentInstanceSummary,
  TokenUsageSummary,
  TokenBudget,
  TriggerRuleSummary,
  ScheduleSummary,
} from './api.js';

export { SSEManager } from './websocket.js';

export { AlertManager } from './alerts.js';
export type { AlertCallback } from './alerts.js';

export { HealthAggregator } from './health.js';
export type { HealthStatus, HealthCheckResult, AggregatedHealth } from './health.js';

export { MonitorServer } from './server.js';
export type { MonitorServerOptions } from './server.js';
