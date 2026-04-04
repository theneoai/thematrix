/**
 * MonitorAPI - HTTP REST API server for monitoring
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { URL } from 'node:url';
import type { DomainEvent, ClusterNode, ClusterStats, AlertRule, Alert } from '@thematrix/types';
import { Logger } from '@thematrix/utils';

// ============================================================
// Data Provider Types
// ============================================================

export interface WorkflowRunSummary {
  runId: string;
  workflowId: string;
  status: string;
  startedAt: Date;
  completedAt?: Date;
  nodeCount: number;
}

export interface AgentInstanceSummary {
  instanceId: string;
  agentId: string;
  status: string;
  startedAt: Date;
  currentTask?: string;
}

export interface TokenUsageSummary {
  totalTokensUsed: number;
  totalCost: number;
  byProvider: Record<string, { tokens: number; cost: number }>;
}

export interface TokenBudget {
  ownerId: string;
  limit: number;
  used: number;
  remaining: number;
}

export interface TriggerRuleSummary {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
}

export interface ScheduleSummary {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
}

export interface MonitorDataProviders {
  getWorkflowRuns?: () => Promise<WorkflowRunSummary[]>;
  getWorkflowRun?: (runId: string) => Promise<WorkflowRunSummary | undefined>;
  getWorkflowEvents?: (runId: string) => Promise<DomainEvent[]>;
  getAgents?: () => Promise<AgentInstanceSummary[]>;
  getAgent?: (instanceId: string) => Promise<AgentInstanceSummary | undefined>;
  getTokenUsage?: () => Promise<TokenUsageSummary>;
  getTokenBudget?: (ownerId: string) => Promise<TokenBudget | undefined>;
  getClusterNodes?: () => Promise<ClusterNode[]>;
  getClusterHealth?: () => Promise<ClusterStats>;
  getTriggers?: () => Promise<TriggerRuleSummary[]>;
  getSchedules?: () => Promise<ScheduleSummary[]>;
  getActiveAlerts?: () => Alert[];
  getAlertRules?: () => AlertRule[];
  getMetrics?: () => Promise<string>;
}

// ============================================================
// Route Matching
// ============================================================

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>;
}

// ============================================================
// MonitorAPI
// ============================================================

export class MonitorAPI {
  private readonly logger = new Logger({ prefix: 'MonitorAPI' });
  private readonly routes: Route[] = [];
  private readonly providers: MonitorDataProviders;
  private server: Server | null = null;

  constructor(providers: MonitorDataProviders) {
    this.providers = providers;
    this.registerRoutes();
  }

  /** Get the underlying HTTP server (created on first call) */
  getOrCreateServer(): Server {
    if (!this.server) {
      this.server = createServer((req, res) => this.handleRequest(req, res));
    }
    return this.server;
  }

  /** Attach to an existing HTTP server */
  attachToServer(server: Server): void {
    this.server = server;
  }

  // ----------------------------------------------------------
  // Route Registration
  // ----------------------------------------------------------

  private registerRoutes(): void {
    // Workflow routes
    this.route('GET', '/api/workflows', this.handleListWorkflows.bind(this));
    this.route('GET', '/api/workflows/:runId', this.handleGetWorkflow.bind(this));
    this.route('GET', '/api/workflows/:runId/events', this.handleGetWorkflowEvents.bind(this));

    // Agent routes
    this.route('GET', '/api/agents', this.handleListAgents.bind(this));
    this.route('GET', '/api/agents/:instanceId', this.handleGetAgent.bind(this));

    // Token routes
    this.route('GET', '/api/tokens/usage', this.handleTokenUsage.bind(this));
    this.route('GET', '/api/tokens/budget/:ownerId', this.handleTokenBudget.bind(this));

    // Cluster routes
    this.route('GET', '/api/cluster/nodes', this.handleClusterNodes.bind(this));
    this.route('GET', '/api/cluster/health', this.handleClusterHealth.bind(this));

    // Trigger & Schedule routes
    this.route('GET', '/api/triggers', this.handleListTriggers.bind(this));
    this.route('GET', '/api/schedules', this.handleListSchedules.bind(this));

    // Alert routes
    this.route('GET', '/api/alerts', this.handleListAlerts.bind(this));
    this.route('GET', '/api/alerts/rules', this.handleListAlertRules.bind(this));

    // Metrics & Health
    this.route('GET', '/metrics', this.handleMetrics.bind(this));
    this.route('GET', '/health', this.handleHealth.bind(this));
  }

  private route(
    method: string,
    path: string,
    handler: (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>,
  ): void {
    const paramNames: string[] = [];
    const patternStr = path.replace(/:([a-zA-Z_]+)/g, (_match, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({
      method,
      pattern: new RegExp(`^${patternStr}$`),
      paramNames,
      handler,
    });
  }

  // ----------------------------------------------------------
  // Request Handling
  // ----------------------------------------------------------

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
        try {
          await route.handler(req, res, params);
        } catch (err) {
          this.logger.error('Route handler error', err);
          this.sendJson(res, 500, { error: 'Internal server error' });
        }
        return;
      }
    }

    this.sendJson(res, 404, { error: 'Not found' });
  }

  // ----------------------------------------------------------
  // JSON Helpers
  // ----------------------------------------------------------

  sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private sendNotImplemented(res: ServerResponse): void {
    this.sendJson(res, 501, { error: 'Data provider not configured' });
  }

  // ----------------------------------------------------------
  // Route Handlers
  // ----------------------------------------------------------

  private async handleListWorkflows(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getWorkflowRuns) return this.sendNotImplemented(res);
    const runs = await this.providers.getWorkflowRuns();
    this.sendJson(res, 200, { workflows: runs });
  }

  private async handleGetWorkflow(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.getWorkflowRun) return this.sendNotImplemented(res);
    const run = await this.providers.getWorkflowRun(params.runId);
    if (!run) return this.sendJson(res, 404, { error: 'Workflow run not found' });
    this.sendJson(res, 200, run);
  }

  private async handleGetWorkflowEvents(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.getWorkflowEvents) return this.sendNotImplemented(res);
    const events = await this.providers.getWorkflowEvents(params.runId);
    this.sendJson(res, 200, { events });
  }

  private async handleListAgents(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getAgents) return this.sendNotImplemented(res);
    const agents = await this.providers.getAgents();
    this.sendJson(res, 200, { agents });
  }

  private async handleGetAgent(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.getAgent) return this.sendNotImplemented(res);
    const agent = await this.providers.getAgent(params.instanceId);
    if (!agent) return this.sendJson(res, 404, { error: 'Agent not found' });
    this.sendJson(res, 200, agent);
  }

  private async handleTokenUsage(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getTokenUsage) return this.sendNotImplemented(res);
    const usage = await this.providers.getTokenUsage();
    this.sendJson(res, 200, usage);
  }

  private async handleTokenBudget(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.getTokenBudget) return this.sendNotImplemented(res);
    const budget = await this.providers.getTokenBudget(params.ownerId);
    if (!budget) return this.sendJson(res, 404, { error: 'Budget not found' });
    this.sendJson(res, 200, budget);
  }

  private async handleClusterNodes(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getClusterNodes) return this.sendNotImplemented(res);
    const nodes = await this.providers.getClusterNodes();
    this.sendJson(res, 200, { nodes });
  }

  private async handleClusterHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getClusterHealth) return this.sendNotImplemented(res);
    const health = await this.providers.getClusterHealth();
    this.sendJson(res, 200, health);
  }

  private async handleListTriggers(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getTriggers) return this.sendNotImplemented(res);
    const triggers = await this.providers.getTriggers();
    this.sendJson(res, 200, { triggers });
  }

  private async handleListSchedules(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getSchedules) return this.sendNotImplemented(res);
    const schedules = await this.providers.getSchedules();
    this.sendJson(res, 200, { schedules });
  }

  private async handleListAlerts(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getActiveAlerts) return this.sendNotImplemented(res);
    const alerts = this.providers.getActiveAlerts();
    this.sendJson(res, 200, { alerts });
  }

  private async handleListAlertRules(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getAlertRules) return this.sendNotImplemented(res);
    const rules = this.providers.getAlertRules();
    this.sendJson(res, 200, { rules });
  }

  private async handleMetrics(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getMetrics) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('# No metrics provider configured\n');
      return;
    }
    const metrics = await this.providers.getMetrics();
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(metrics);
  }

  private async handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
  }
}
