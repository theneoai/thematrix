/**
 * MonitorAPI - HTTP REST API server for monitoring
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { URL } from 'node:url';
import type { DomainEvent, ClusterNode, ClusterStats, AlertRule, Alert, IApprovalManager } from '@thematrix/types';
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
  // ── Read operations ──
  getWorkflowRuns?: () => Promise<WorkflowRunSummary[]>;
  getWorkflowRun?: (runId: string) => Promise<WorkflowRunSummary | undefined>;
  getWorkflowEvents?: (runId: string) => Promise<DomainEvent[]>;
  getAgents?: () => Promise<AgentInstanceSummary[]>;
  getAgent?: (instanceId: string) => Promise<AgentInstanceSummary | undefined>;
  getTokenUsage?: () => Promise<TokenUsageSummary>;
  getTokenBudget?: (ownerId: string) => Promise<TokenBudget | undefined>;
  getClusterNodes?: () => Promise<ClusterNode[]>;
  getClusterHealth?: () => Promise<ClusterStats>;
  getClusterStats?: () => Promise<Record<string, unknown>>;
  getTriggers?: () => Promise<TriggerRuleSummary[]>;
  getTrigger?: (id: string) => Promise<TriggerRuleSummary | undefined>;
  getSchedules?: () => Promise<ScheduleSummary[]>;
  getSchedule?: (id: string) => Promise<ScheduleSummary | undefined>;
  getActiveAlerts?: () => Alert[];
  getAlertRules?: () => AlertRule[];
  getAlertHistory?: (limit?: number) => Alert[];
  getMetrics?: () => Promise<string>;
  approvalManager?: IApprovalManager;
  getProviders?: () => Promise<ProviderSummary[]>;
  getProviderHealth?: () => Promise<ProviderHealthSummary[]>;
  getGuardrails?: () => Promise<GuardrailSummary[]>;
  getGuardrailViolations?: () => Promise<GuardrailViolationSummary[]>;
  getPolicies?: () => Promise<PolicySummary[]>;
  getPolicy?: (id: string) => Promise<PolicySummary | undefined>;
  getEnvironments?: () => Promise<EnvironmentSummary[]>;
  getEnvironment?: (name: string) => Promise<EnvironmentSummary | undefined>;
  getEvalSuites?: () => Promise<EvalSuiteSummary[]>;
  getEvalResults?: (runId: string) => Promise<EvalResultSummary[]>;
  getEvents?: () => Promise<DomainEvent[]>;

  // ── Write operations ──
  startWorkflow?: (workflowId: string, input?: Record<string, unknown>) => Promise<{ runId: string }>;
  pauseWorkflow?: (runId: string) => Promise<void>;
  resumeWorkflow?: (runId: string) => Promise<void>;
  cancelWorkflow?: (runId: string) => Promise<void>;
  registerAgent?: (definition: Record<string, unknown>) => Promise<{ id: string }>;
  unregisterAgent?: (id: string) => Promise<void>;
  updateAgent?: (id: string, update: Record<string, unknown>) => Promise<void>;
  pauseAgent?: (id: string) => Promise<void>;
  resumeAgent?: (id: string) => Promise<void>;
  stopAgent?: (id: string) => Promise<void>;
  allocateTokenBudget?: (ownerId: string, budget: Record<string, unknown>) => Promise<void>;
  updateTokenBudget?: (ownerId: string, budget: Record<string, unknown>) => Promise<void>;
  drainClusterNode?: (nodeId: string) => Promise<void>;
  enableClusterNode?: (nodeId: string) => Promise<void>;
  setClusterStrategy?: (strategy: string) => Promise<void>;
  createTrigger?: (rule: Record<string, unknown>) => Promise<{ id: string }>;
  updateTrigger?: (id: string, rule: Record<string, unknown>) => Promise<void>;
  deleteTrigger?: (id: string) => Promise<void>;
  createSchedule?: (schedule: Record<string, unknown>) => Promise<{ id: string }>;
  updateSchedule?: (id: string, schedule: Record<string, unknown>) => Promise<void>;
  deleteSchedule?: (id: string) => Promise<void>;
  createAlertRule?: (rule: Record<string, unknown>) => Promise<{ id: string }>;
  updateAlertRule?: (id: string, rule: Record<string, unknown>) => Promise<void>;
  deleteAlertRule?: (id: string) => Promise<void>;
  acknowledgeAlert?: (id: string) => Promise<void>;
  resolveAlert?: (id: string) => Promise<void>;
  configureProvider?: (name: string, config: Record<string, unknown>) => Promise<void>;
  createPolicy?: (policy: Record<string, unknown>) => Promise<{ id: string }>;
  updatePolicy?: (id: string, policy: Record<string, unknown>) => Promise<void>;
  deletePolicy?: (id: string) => Promise<void>;
  createGuardrail?: (guardrail: Record<string, unknown>) => Promise<{ id: string }>;
  updateGuardrail?: (id: string, guardrail: Record<string, unknown>) => Promise<void>;
  deleteGuardrail?: (id: string) => Promise<void>;
  setActiveEnvironment?: (name: string) => Promise<void>;
  runEvalSuite?: (suiteId: string) => Promise<{ runId: string }>;

  /** Playground: interactive single-turn agent execution */
  playgroundRunTurn?: (agentId: string, input: string, options?: {
    sessionId?: string;
    overrides?: { temperature?: number; model?: string };
  }) => Promise<{
    output: string;
    tokensUsed: number;
    toolCalls: string[];
    durationMs: number;
  }>;

  /** Playground: get agent conversation history */
  playgroundGetHistory?: (sessionId: string) => Promise<Array<{
    role: string;
    content: string;
    timestamp: string;
  }>>;

  /** Playground: clear agent session */
  playgroundClearSession?: (sessionId: string) => Promise<void>;

  /** NL Workflow: create workflow from description */
  createWorkflowFromNL?: (description: string) => Promise<{
    workflow: unknown;
    agents: unknown[];
    reasoning: string;
    confidence: number;
  }>;
}

// ── Extended Provider Types ──

export interface ProviderSummary {
  name: string;
  displayName: string;
  models: { id: string; name: string; contextWindow: number }[];
  configured: boolean;
}

export interface ProviderHealthSummary {
  name: string;
  healthy: boolean;
  latencyMs: number;
  message?: string;
}

export interface GuardrailSummary {
  id: string;
  name: string;
  type: 'input' | 'output' | 'both';
  builtin: boolean;
  action: 'block' | 'warn' | 'rewrite';
}

export interface GuardrailViolationSummary {
  guardrailId: string;
  guardrailName: string;
  agentId: string;
  severity: string;
  message: string;
  timestamp: string;
  action: string;
}

export interface PolicySummary {
  id: string;
  name: string;
  scope: string;
  enforcement: string;
  rules: { id: string; description: string; effect: string; condition: Record<string, unknown> }[];
}

export interface EnvironmentSummary {
  name: string;
  active: boolean;
  variables: Record<string, string>;
  providerOverrides?: Record<string, unknown>;
}

export interface EvalSuiteSummary {
  id: string;
  name: string;
  caseCount: number;
  lastRunAt?: string;
  lastScore?: number;
}

export interface EvalResultSummary {
  caseId: string;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  scores: { metric: string; score: number; reason?: string }[];
  passed: boolean;
  latencyMs: number;
  tokenCount: number;
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
    this.route('POST', '/api/workflows', this.handleStartWorkflow.bind(this));
    this.route('GET', '/api/workflows/:runId', this.handleGetWorkflow.bind(this));
    this.route('GET', '/api/workflows/:runId/events', this.handleGetWorkflowEvents.bind(this));
    this.route('POST', '/api/workflows/:runId/pause', this.handlePauseWorkflow.bind(this));
    this.route('POST', '/api/workflows/:runId/resume', this.handleResumeWorkflow.bind(this));
    this.route('POST', '/api/workflows/:runId/cancel', this.handleCancelWorkflow.bind(this));

    // Agent routes
    this.route('GET', '/api/agents', this.handleListAgents.bind(this));
    this.route('POST', '/api/agents', this.handleRegisterAgent.bind(this));
    this.route('GET', '/api/agents/:instanceId', this.handleGetAgent.bind(this));
    this.route('PUT', '/api/agents/:instanceId', this.handleUpdateAgent.bind(this));
    this.route('DELETE', '/api/agents/:instanceId', this.handleUnregisterAgent.bind(this));
    this.route('POST', '/api/agents/:instanceId/pause', this.handlePauseAgent.bind(this));
    this.route('POST', '/api/agents/:instanceId/resume', this.handleResumeAgent.bind(this));
    this.route('POST', '/api/agents/:instanceId/stop', this.handleStopAgent.bind(this));

    // Token routes
    this.route('GET', '/api/tokens/usage', this.handleTokenUsage.bind(this));
    this.route('GET', '/api/tokens/budget/:ownerId', this.handleTokenBudget.bind(this));
    this.route('POST', '/api/tokens/budget/:ownerId', this.handleAllocateTokenBudget.bind(this));
    this.route('PUT', '/api/tokens/budget/:ownerId', this.handleUpdateTokenBudget.bind(this));

    // Cluster routes
    this.route('GET', '/api/cluster/nodes', this.handleClusterNodes.bind(this));
    this.route('GET', '/api/cluster/health', this.handleClusterHealth.bind(this));
    this.route('GET', '/api/cluster/stats', this.handleClusterStats.bind(this));
    this.route('POST', '/api/cluster/nodes/:nodeId/drain', this.handleDrainNode.bind(this));
    this.route('POST', '/api/cluster/nodes/:nodeId/enable', this.handleEnableNode.bind(this));
    this.route('PUT', '/api/cluster/strategy', this.handleSetStrategy.bind(this));

    // Trigger routes
    this.route('GET', '/api/triggers', this.handleListTriggers.bind(this));
    this.route('POST', '/api/triggers', this.handleCreateTrigger.bind(this));
    this.route('GET', '/api/triggers/:id', this.handleGetTrigger.bind(this));
    this.route('PUT', '/api/triggers/:id', this.handleUpdateTrigger.bind(this));
    this.route('DELETE', '/api/triggers/:id', this.handleDeleteTrigger.bind(this));

    // Schedule routes
    this.route('GET', '/api/schedules', this.handleListSchedules.bind(this));
    this.route('POST', '/api/schedules', this.handleCreateSchedule.bind(this));
    this.route('GET', '/api/schedules/:id', this.handleGetSchedule.bind(this));
    this.route('PUT', '/api/schedules/:id', this.handleUpdateSchedule.bind(this));
    this.route('DELETE', '/api/schedules/:id', this.handleDeleteSchedule.bind(this));

    // Alert routes
    this.route('GET', '/api/alerts', this.handleListAlerts.bind(this));
    this.route('GET', '/api/alerts/history', this.handleAlertHistory.bind(this));
    this.route('POST', '/api/alerts/:id/acknowledge', this.handleAcknowledgeAlert.bind(this));
    this.route('POST', '/api/alerts/:id/resolve', this.handleResolveAlert.bind(this));
    this.route('GET', '/api/alerts/rules', this.handleListAlertRules.bind(this));
    this.route('POST', '/api/alerts/rules', this.handleCreateAlertRule.bind(this));
    this.route('PUT', '/api/alerts/rules/:id', this.handleUpdateAlertRule.bind(this));
    this.route('DELETE', '/api/alerts/rules/:id', this.handleDeleteAlertRule.bind(this));

    // Approval routes
    this.route('GET', '/api/approvals', this.handleListApprovals.bind(this));
    this.route('GET', '/api/approvals/:id', this.handleGetApproval.bind(this));
    this.route('POST', '/api/approvals/:id/approve', this.handleApprove.bind(this));
    this.route('POST', '/api/approvals/:id/reject', this.handleReject.bind(this));

    // Provider routes
    this.route('GET', '/api/providers', this.handleListProviders.bind(this));
    this.route('GET', '/api/providers/health', this.handleProviderHealth.bind(this));
    this.route('PUT', '/api/providers/:name', this.handleConfigureProvider.bind(this));

    // Guardrail routes
    this.route('GET', '/api/guardrails', this.handleListGuardrails.bind(this));
    this.route('GET', '/api/guardrails/violations', this.handleGuardrailViolations.bind(this));
    this.route('POST', '/api/guardrails', this.handleCreateGuardrail.bind(this));
    this.route('PUT', '/api/guardrails/:id', this.handleUpdateGuardrail.bind(this));
    this.route('DELETE', '/api/guardrails/:id', this.handleDeleteGuardrail.bind(this));

    // Policy routes
    this.route('GET', '/api/policies', this.handleListPolicies.bind(this));
    this.route('POST', '/api/policies', this.handleCreatePolicy.bind(this));
    this.route('GET', '/api/policies/:id', this.handleGetPolicy.bind(this));
    this.route('PUT', '/api/policies/:id', this.handleUpdatePolicy.bind(this));
    this.route('DELETE', '/api/policies/:id', this.handleDeletePolicy.bind(this));

    // Environment routes
    this.route('GET', '/api/environments', this.handleListEnvironments.bind(this));
    this.route('GET', '/api/environments/:name', this.handleGetEnvironment.bind(this));
    this.route('POST', '/api/environments/:name/activate', this.handleActivateEnvironment.bind(this));

    // Eval routes
    this.route('GET', '/api/eval/suites', this.handleListEvalSuites.bind(this));
    this.route('POST', '/api/eval/suites/:suiteId/run', this.handleRunEvalSuite.bind(this));
    this.route('GET', '/api/eval/runs/:runId', this.handleGetEvalResults.bind(this));

    // Playground routes
    this.route('POST', '/api/playground/turn', this.handlePlaygroundTurn.bind(this));
    this.route('GET', '/api/playground/history/:sessionId', this.handlePlaygroundHistory.bind(this));
    this.route('DELETE', '/api/playground/session/:sessionId', this.handlePlaygroundClearSession.bind(this));

    // NL Workflow route
    this.route('POST', '/api/workflows/from-nl', this.handleCreateWorkflowFromNL.bind(this));

    // Domain events
    this.route('GET', '/api/events', this.handleListEvents.bind(this));
    this.route('GET', '/api/events/stream', this.handleEventStream.bind(this));

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
    this.sendJson(res, 200, runs);
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
    this.sendJson(res, 200, events);
  }

  private async handleListAgents(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getAgents) return this.sendNotImplemented(res);
    const agents = await this.providers.getAgents();
    this.sendJson(res, 200, agents);
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
    this.sendJson(res, 200, nodes);
  }

  private async handleClusterHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getClusterHealth) return this.sendNotImplemented(res);
    const health = await this.providers.getClusterHealth();
    this.sendJson(res, 200, health);
  }

  private async handleListTriggers(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getTriggers) return this.sendNotImplemented(res);
    const triggers = await this.providers.getTriggers();
    this.sendJson(res, 200, triggers);
  }

  private async handleListSchedules(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getSchedules) return this.sendNotImplemented(res);
    const schedules = await this.providers.getSchedules();
    this.sendJson(res, 200, schedules);
  }

  private async handleListAlerts(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getActiveAlerts) return this.sendNotImplemented(res);
    const alerts = this.providers.getActiveAlerts();
    this.sendJson(res, 200, alerts);
  }

  private async handleListAlertRules(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getAlertRules) return this.sendNotImplemented(res);
    const rules = this.providers.getAlertRules();
    this.sendJson(res, 200, rules);
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

  // ----------------------------------------------------------
  // Approval Handlers
  // ----------------------------------------------------------

  private async handleListApprovals(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.approvalManager) return this.sendNotImplemented(res);
    const approvals = this.providers.approvalManager.listPending();
    this.sendJson(res, 200, approvals);
  }

  private async handleGetApproval(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.approvalManager) return this.sendNotImplemented(res);
    const approval = this.providers.approvalManager.getStatus(params.id);
    if (!approval) return this.sendJson(res, 404, { error: 'Approval not found' });
    this.sendJson(res, 200, approval);
  }

  private async handleApprove(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.approvalManager) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      await this.providers.approvalManager.approve(params.id, body.respondedBy as string | undefined);
      this.sendJson(res, 200, { status: 'approved' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 400, { error: message });
    }
  }

  private async handleReject(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.approvalManager) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      await this.providers.approvalManager.reject(params.id, body.respondedBy as string | undefined);
      this.sendJson(res, 200, { status: 'rejected' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 400, { error: message });
    }
  }

  private parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const MAX_BODY_SIZE = 1_048_576; // 1MB
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error('Request body too large'));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf-8');
          resolve(raw ? JSON.parse(raw) : {});
        } catch (err) {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  // ----------------------------------------------------------
  // Workflow Write Handlers
  // ----------------------------------------------------------

  private async handleStartWorkflow(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.startWorkflow) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      const result = await this.providers.startWorkflow(
        body.workflowId as string,
        body.input as Record<string, unknown> | undefined,
      );
      this.sendJson(res, 201, result);
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handlePauseWorkflow(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.pauseWorkflow) return this.sendNotImplemented(res);
    try {
      await this.providers.pauseWorkflow(params.runId);
      this.sendJson(res, 200, { status: 'paused' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleResumeWorkflow(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.resumeWorkflow) return this.sendNotImplemented(res);
    try {
      await this.providers.resumeWorkflow(params.runId);
      this.sendJson(res, 200, { status: 'resumed' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleCancelWorkflow(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.cancelWorkflow) return this.sendNotImplemented(res);
    try {
      await this.providers.cancelWorkflow(params.runId);
      this.sendJson(res, 200, { status: 'cancelled' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ----------------------------------------------------------
  // Agent Write Handlers
  // ----------------------------------------------------------

  private async handleRegisterAgent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.registerAgent) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      const result = await this.providers.registerAgent(body);
      this.sendJson(res, 201, result);
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleUpdateAgent(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.updateAgent) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      await this.providers.updateAgent(params.instanceId, body);
      this.sendJson(res, 200, { status: 'updated' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleUnregisterAgent(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.unregisterAgent) return this.sendNotImplemented(res);
    try {
      await this.providers.unregisterAgent(params.instanceId);
      this.sendJson(res, 200, { status: 'unregistered' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handlePauseAgent(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.pauseAgent) return this.sendNotImplemented(res);
    try {
      await this.providers.pauseAgent(params.instanceId);
      this.sendJson(res, 200, { status: 'paused' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleResumeAgent(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.resumeAgent) return this.sendNotImplemented(res);
    try {
      await this.providers.resumeAgent(params.instanceId);
      this.sendJson(res, 200, { status: 'resumed' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleStopAgent(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.stopAgent) return this.sendNotImplemented(res);
    try {
      await this.providers.stopAgent(params.instanceId);
      this.sendJson(res, 200, { status: 'stopped' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ----------------------------------------------------------
  // Token Write Handlers
  // ----------------------------------------------------------

  private async handleAllocateTokenBudget(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.allocateTokenBudget) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      await this.providers.allocateTokenBudget(params.ownerId, body);
      this.sendJson(res, 201, { status: 'allocated' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleUpdateTokenBudget(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.updateTokenBudget) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      await this.providers.updateTokenBudget(params.ownerId, body);
      this.sendJson(res, 200, { status: 'updated' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ----------------------------------------------------------
  // Cluster Write Handlers
  // ----------------------------------------------------------

  private async handleClusterStats(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getClusterStats) return this.sendNotImplemented(res);
    const stats = await this.providers.getClusterStats();
    this.sendJson(res, 200, stats);
  }

  private async handleDrainNode(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.drainClusterNode) return this.sendNotImplemented(res);
    try {
      await this.providers.drainClusterNode(params.nodeId);
      this.sendJson(res, 200, { status: 'draining' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleEnableNode(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.enableClusterNode) return this.sendNotImplemented(res);
    try {
      await this.providers.enableClusterNode(params.nodeId);
      this.sendJson(res, 200, { status: 'enabled' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleSetStrategy(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.setClusterStrategy) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      await this.providers.setClusterStrategy(body.strategy as string);
      this.sendJson(res, 200, { status: 'updated' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ----------------------------------------------------------
  // Trigger CRUD Handlers
  // ----------------------------------------------------------

  private async handleGetTrigger(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.getTrigger) return this.sendNotImplemented(res);
    const trigger = await this.providers.getTrigger(params.id);
    if (!trigger) return this.sendJson(res, 404, { error: 'Trigger not found' });
    this.sendJson(res, 200, trigger);
  }

  private async handleCreateTrigger(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.createTrigger) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      const result = await this.providers.createTrigger(body);
      this.sendJson(res, 201, result);
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleUpdateTrigger(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.updateTrigger) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      await this.providers.updateTrigger(params.id, body);
      this.sendJson(res, 200, { status: 'updated' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleDeleteTrigger(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.deleteTrigger) return this.sendNotImplemented(res);
    try {
      await this.providers.deleteTrigger(params.id);
      this.sendJson(res, 200, { status: 'deleted' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ----------------------------------------------------------
  // Schedule CRUD Handlers
  // ----------------------------------------------------------

  private async handleGetSchedule(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.getSchedule) return this.sendNotImplemented(res);
    const schedule = await this.providers.getSchedule(params.id);
    if (!schedule) return this.sendJson(res, 404, { error: 'Schedule not found' });
    this.sendJson(res, 200, schedule);
  }

  private async handleCreateSchedule(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.createSchedule) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      const result = await this.providers.createSchedule(body);
      this.sendJson(res, 201, result);
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleUpdateSchedule(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.updateSchedule) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      await this.providers.updateSchedule(params.id, body);
      this.sendJson(res, 200, { status: 'updated' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleDeleteSchedule(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.deleteSchedule) return this.sendNotImplemented(res);
    try {
      await this.providers.deleteSchedule(params.id);
      this.sendJson(res, 200, { status: 'deleted' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ----------------------------------------------------------
  // Alert CRUD Handlers
  // ----------------------------------------------------------

  private async handleAlertHistory(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getAlertHistory) return this.sendNotImplemented(res);
    const history = this.providers.getAlertHistory();
    this.sendJson(res, 200, history);
  }

  private async handleAcknowledgeAlert(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.acknowledgeAlert) return this.sendNotImplemented(res);
    try {
      await this.providers.acknowledgeAlert(params.id);
      this.sendJson(res, 200, { status: 'acknowledged' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleResolveAlert(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.resolveAlert) return this.sendNotImplemented(res);
    try {
      await this.providers.resolveAlert(params.id);
      this.sendJson(res, 200, { status: 'resolved' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleCreateAlertRule(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.createAlertRule) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      const result = await this.providers.createAlertRule(body);
      this.sendJson(res, 201, result);
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleUpdateAlertRule(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.updateAlertRule) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      await this.providers.updateAlertRule(params.id, body);
      this.sendJson(res, 200, { status: 'updated' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleDeleteAlertRule(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.deleteAlertRule) return this.sendNotImplemented(res);
    try {
      await this.providers.deleteAlertRule(params.id);
      this.sendJson(res, 200, { status: 'deleted' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ----------------------------------------------------------
  // Provider Handlers
  // ----------------------------------------------------------

  private async handleListProviders(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getProviders) return this.sendNotImplemented(res);
    const providers = await this.providers.getProviders();
    this.sendJson(res, 200, providers);
  }

  private async handleProviderHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getProviderHealth) return this.sendNotImplemented(res);
    const health = await this.providers.getProviderHealth();
    this.sendJson(res, 200, health);
  }

  private async handleConfigureProvider(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.configureProvider) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      await this.providers.configureProvider(params.name, body);
      this.sendJson(res, 200, { status: 'configured' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ----------------------------------------------------------
  // Guardrail Handlers
  // ----------------------------------------------------------

  private async handleListGuardrails(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getGuardrails) return this.sendNotImplemented(res);
    const guardrails = await this.providers.getGuardrails();
    this.sendJson(res, 200, guardrails);
  }

  private async handleGuardrailViolations(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getGuardrailViolations) return this.sendNotImplemented(res);
    const violations = await this.providers.getGuardrailViolations();
    this.sendJson(res, 200, violations);
  }

  private async handleCreateGuardrail(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.createGuardrail) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      const result = await this.providers.createGuardrail(body);
      this.sendJson(res, 201, result);
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleUpdateGuardrail(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.updateGuardrail) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      await this.providers.updateGuardrail(params.id, body);
      this.sendJson(res, 200, { status: 'updated' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleDeleteGuardrail(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.deleteGuardrail) return this.sendNotImplemented(res);
    try {
      await this.providers.deleteGuardrail(params.id);
      this.sendJson(res, 200, { status: 'deleted' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ----------------------------------------------------------
  // Policy Handlers
  // ----------------------------------------------------------

  private async handleListPolicies(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getPolicies) return this.sendNotImplemented(res);
    const policies = await this.providers.getPolicies();
    this.sendJson(res, 200, policies);
  }

  private async handleGetPolicy(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.getPolicy) return this.sendNotImplemented(res);
    const policy = await this.providers.getPolicy(params.id);
    if (!policy) return this.sendJson(res, 404, { error: 'Policy not found' });
    this.sendJson(res, 200, policy);
  }

  private async handleCreatePolicy(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.createPolicy) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      const result = await this.providers.createPolicy(body);
      this.sendJson(res, 201, result);
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleUpdatePolicy(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.updatePolicy) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      await this.providers.updatePolicy(params.id, body);
      this.sendJson(res, 200, { status: 'updated' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleDeletePolicy(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.deletePolicy) return this.sendNotImplemented(res);
    try {
      await this.providers.deletePolicy(params.id);
      this.sendJson(res, 200, { status: 'deleted' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ----------------------------------------------------------
  // Environment Handlers
  // ----------------------------------------------------------

  private async handleListEnvironments(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getEnvironments) return this.sendNotImplemented(res);
    const envs = await this.providers.getEnvironments();
    this.sendJson(res, 200, envs);
  }

  private async handleGetEnvironment(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.getEnvironment) return this.sendNotImplemented(res);
    const env = await this.providers.getEnvironment(params.name);
    if (!env) return this.sendJson(res, 404, { error: 'Environment not found' });
    this.sendJson(res, 200, env);
  }

  private async handleActivateEnvironment(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.setActiveEnvironment) return this.sendNotImplemented(res);
    try {
      await this.providers.setActiveEnvironment(params.name);
      this.sendJson(res, 200, { status: 'activated' });
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ----------------------------------------------------------
  // Eval Handlers
  // ----------------------------------------------------------

  private async handleListEvalSuites(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getEvalSuites) return this.sendNotImplemented(res);
    const suites = await this.providers.getEvalSuites();
    this.sendJson(res, 200, suites);
  }

  private async handleRunEvalSuite(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.runEvalSuite) return this.sendNotImplemented(res);
    try {
      const result = await this.providers.runEvalSuite(params.suiteId);
      this.sendJson(res, 201, result);
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleGetEvalResults(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.getEvalResults) return this.sendNotImplemented(res);
    const results = await this.providers.getEvalResults(params.runId);
    this.sendJson(res, 200, results);
  }

  // ----------------------------------------------------------
  // Domain Events Handler
  // ----------------------------------------------------------

  private async handleListEvents(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.getEvents) return this.sendNotImplemented(res);
    const events = await this.providers.getEvents();
    this.sendJson(res, 200, events);
  }

  private async handleEventStream(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial comment to confirm connection
    res.write(': connected\n\n');

    // Heartbeat every 30 seconds
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30_000);

    // Forward events from the event bus if available
    const eventBus = (this.providers as Record<string, unknown>).eventBus as
      | { on(event: string, listener: (event: DomainEvent) => void): void; off(event: string, listener: (event: DomainEvent) => void): void }
      | undefined;

    const onEvent = (event: DomainEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    if (eventBus) {
      eventBus.on('event', onEvent);
    }

    // Clean up on close
    _req.on('close', () => {
      clearInterval(heartbeat);
      if (eventBus) {
        eventBus.off('event', onEvent);
      }
      res.end();
    });
  }

  // ----------------------------------------------------------
  // Playground Handlers
  // ----------------------------------------------------------

  private async handlePlaygroundTurn(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.playgroundRunTurn) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      const result = await this.providers.playgroundRunTurn(body.agentId as string, body.input as string, body.options as {
        sessionId?: string;
        overrides?: { temperature?: number; model?: string };
      } | undefined);
      this.sendJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 500, { error: message });
    }
  }

  private async handlePlaygroundHistory(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.playgroundGetHistory) return this.sendNotImplemented(res);
    try {
      const history = await this.providers.playgroundGetHistory(params.sessionId);
      this.sendJson(res, 200, history);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 500, { error: message });
    }
  }

  private async handlePlaygroundClearSession(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
    if (!this.providers.playgroundClearSession) return this.sendNotImplemented(res);
    try {
      await this.providers.playgroundClearSession(params.sessionId);
      this.sendJson(res, 200, { status: 'cleared' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 500, { error: message });
    }
  }

  private async handleCreateWorkflowFromNL(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.providers.createWorkflowFromNL) return this.sendNotImplemented(res);
    try {
      const body = await this.parseBody(req);
      const result = await this.providers.createWorkflowFromNL(body.description as string);
      this.sendJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJson(res, 500, { error: message });
    }
  }
}
