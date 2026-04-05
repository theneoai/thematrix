/**
 * Zod 验证 Schema
 */
import { z } from 'zod';

export const agentPersonaSchema = z.object({
  systemPrompt: z.string(),
  personality: z.string(),
  role: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  traits: z.record(z.string()),
});

export const modelConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  apiKeyEnvVar: z.string().optional(),
  baseUrl: z.string().optional(),
  maxTokens: z.number().optional(),
});

export const skillRefSchema = z.object({
  skillId: z.string(),
  config: z.record(z.unknown()).optional(),
});

export const toolPermissionSchema = z.object({
  name: z.string(),
  permission: z.enum(['allow', 'confirm', 'deny']),
});

export const memoryScopeConfigSchema = z.object({
  scope: z.enum(['agent-local', 'workflow-shared', 'global']),
  access: z.enum(['read', 'write', 'read-write']),
});

export const agentMemoryConfigSchema = z.object({
  persistHistory: z.boolean(),
  maxHistoryTurns: z.number(),
  scopes: z.array(memoryScopeConfigSchema),
});

// ============================================================
// Agent Loop Config Schema
// ============================================================

export const agentLoopConfigSchema = z.object({
  mode: z.enum(['single-turn', 'loop', 'plan-and-execute']),
  maxIterations: z.number().optional(),
  maxTotalTokens: z.number().optional(),
  enableReflection: z.boolean().optional(),
  enablePlanning: z.boolean().optional(),
  exitCondition: z.string().optional(),
  handoffTargets: z.array(z.string()).optional(),
});

// ============================================================
// Guardrail Config Schema
// ============================================================

export const guardrailConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['input', 'output', 'both']),
  builtin: z.enum(['content-safety', 'pii-detection', 'schema-validation', 'prompt-injection']).optional(),
  prompt: z.string().optional(),
  action: z.enum(['block', 'warn', 'rewrite']),
  config: z.record(z.unknown()).optional(),
});

// ============================================================
// Agent Definition Schema
// ============================================================

export const agentDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  persona: agentPersonaSchema,
  model: modelConfigSchema,
  skills: z.array(skillRefSchema),
  tools: z.array(toolPermissionSchema),
  memory: agentMemoryConfigSchema,
  maxConcurrency: z.number().default(1),
  turnTimeoutMs: z.number().default(60000),
  metadata: z.record(z.unknown()).default({}),
  loop: agentLoopConfigSchema.optional(),
  guardrails: z.array(guardrailConfigSchema).optional(),
  outputSchema: z.record(z.unknown()).optional(),
});

export const approvalConfigSchema = z.object({
  strategy: z.enum(['webhook', 'auto-timeout']),
  timeoutMs: z.number().optional(),
  timeoutAction: z.enum(['approve', 'reject']).optional(),
  callbackUrl: z.string().optional(),
  message: z.string().optional(),
});

export const dagNodeSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  type: z.enum(['task', 'parallel', 'choice', 'wait', 'approval']),
  inputMapping: z.record(z.string()).optional(),
  condition: z.string().optional(),
  retry: z.object({
    maxRetries: z.number(),
    retryDelayMs: z.number(),
  }).optional(),
  approval: approvalConfigSchema.optional(),
});

export const dagEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  condition: z.string().optional(),
});

export const dagDefinitionSchema = z.object({
  nodes: z.array(dagNodeSchema),
  edges: z.array(dagEdgeSchema),
});

export const choiceRuleSchema = z.object({
  condition: z.string(),
  next: z.string(),
});

export const stateDefinitionSchema = z.object({
  type: z.enum(['task', 'parallel', 'choice', 'wait', 'succeed', 'fail']),
  agentId: z.string().optional(),
  inputMapping: z.record(z.string()).optional(),
  next: z.string().optional(),
  choices: z.array(choiceRuleSchema).optional(),
  retry: z.object({
    maxRetries: z.number(),
    retryDelayMs: z.number(),
  }).optional(),
  seconds: z.number().optional(),
  timestamp: z.string().optional(),
});

export const stateMachineDefinitionSchema = z.object({
  initialState: z.string(),
  states: z.record(stateDefinitionSchema),
});

export const workflowMemoryConfigSchema = z.object({
  kvStore: z.enum(['in-memory', 'sqlite']),
  persistent: z.boolean(),
});

export const scheduleConfigSchema = z.object({
  cron: z.string().optional(),
  startAt: z.string().optional(),
  maxDurationMs: z.number().optional(),
  timezone: z.string().optional(),
});

export const integrationConfigSchema = z.object({
  type: z.enum(['webhook-in', 'webhook-out', 'mcp']),
  id: z.string(),
  config: z.record(z.unknown()),
});

export const agentRefSchema = z.object({
  ref: z.string(),
  overrides: z.record(z.unknown()).optional(),
});

export const dynamicWorkflowConfigSchema = z.object({
  orchestratorAgentId: z.string(),
  availableAgents: z.array(z.string()),
  maxHandoffs: z.number().optional(),
});

export const workflowDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  mode: z.enum(['dag', 'state-machine', 'dynamic']),
  agents: z.record(agentRefSchema),
  dag: dagDefinitionSchema.optional(),
  stateMachine: stateMachineDefinitionSchema.optional(),
  dynamicConfig: dynamicWorkflowConfigSchema.optional(),
  sharedMemory: workflowMemoryConfigSchema,
  schedule: scheduleConfigSchema.optional(),
  integrations: z.array(integrationConfigSchema).optional(),
  timeoutMs: z.number().optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  execution: z.object({
    backend: z.enum(['local', 'docker', 'ssh', 'kubernetes']),
    config: z.record(z.unknown()).optional(),
    parallelism: z.number().optional(),
  }).optional(),
}).refine(
  (data) => {
    if (data.mode === 'dag') return data.dag !== undefined;
    if (data.mode === 'state-machine') return data.stateMachine !== undefined;
    if (data.mode === 'dynamic') return data.dynamicConfig !== undefined;
    return false;
  },
  {
    message: 'dag, stateMachine, or dynamicConfig must be provided based on mode',
  }
);

// ============================================================
// Token Budget Schema
// ============================================================

export const tokenBudgetSchema = z.object({
  maxTokens: z.number(),
  maxCostUsd: z.number().optional(),
  period: z.enum(['hourly', 'daily', 'per-run', 'unlimited']).default('daily'),
  providers: z.array(z.string()).optional(),
  alertThreshold: z.number().min(0).max(1).optional(),
});

// ============================================================
// Provider Config Schema
// ============================================================

export const secretRefSchema = z.object({
  type: z.enum(['env', 'vault', 'file']),
  ref: z.string(),
  version: z.string().optional(),
});

export const rateLimitConfigSchema = z.object({
  rpm: z.number().optional(),
  tpm: z.number().optional(),
  maxConcurrent: z.number().optional(),
});

export const providerConfigSchema = z.object({
  provider: z.string(),
  apiKey: z.union([z.string(), secretRefSchema]).optional(),
  baseUrl: z.string().optional(),
  models: z.array(z.string()).optional(),
  rateLimit: rateLimitConfigSchema.optional(),
  timeout: z.number().optional(),
  headers: z.record(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const providerRouterConfigSchema = z.object({
  providers: z.array(providerConfigSchema),
  failover: z.boolean().default(true),
  strategy: z.enum(['priority', 'round-robin', 'least-cost', 'least-latency']).default('priority'),
});

// ============================================================
// Execution Backend Schema
// ============================================================

export const resourceLimitsSchema = z.object({
  cpu: z.string().optional(),
  memory: z.string().optional(),
  gpu: z.number().optional(),
  ephemeralStorage: z.string().optional(),
});

export const executionConfigSchema = z.object({
  backend: z.enum(['local', 'docker', 'ssh', 'kubernetes']),
  config: z.record(z.unknown()).optional(),
  parallelism: z.number().optional(),
  retryOnBackendFailure: z.boolean().optional(),
});

export const dockerBackendConfigSchema = z.object({
  type: z.literal('docker'),
  image: z.string(),
  dockerHost: z.string().optional(),
  network: z.string().optional(),
  maxConcurrent: z.number().optional(),
});

export const sshBackendConfigSchema = z.object({
  type: z.literal('ssh'),
  host: z.string(),
  port: z.number().default(22),
  username: z.string(),
  privateKeyPath: z.string().optional(),
  workDir: z.string().optional(),
  maxConcurrent: z.number().optional(),
});

export const k8sTolerationSchema = z.object({
  key: z.string(),
  operator: z.enum(['Exists', 'Equal']),
  value: z.string().optional(),
  effect: z.enum(['NoSchedule', 'PreferNoSchedule', 'NoExecute']),
  tolerationSeconds: z.number().optional(),
});

export const k8sBackendConfigSchema = z.object({
  type: z.literal('kubernetes'),
  kubeconfig: z.string().optional(),
  namespace: z.string(),
  image: z.string(),
  serviceAccount: z.string().optional(),
  nodeSelector: z.record(z.string()).optional(),
  tolerations: z.array(k8sTolerationSchema).optional(),
  labels: z.record(z.string()).optional(),
  annotations: z.record(z.string()).optional(),
  resources: resourceLimitsSchema.optional(),
  imagePullSecrets: z.array(z.string()).optional(),
  ttlAfterFinished: z.number().optional(),
  maxConcurrent: z.number().optional(),
});

// ============================================================
// Trigger & Schedule Config Schema
// ============================================================

export const triggerConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['equals', 'not_equals', 'contains', 'matches', 'in', 'gt', 'lt']),
  value: z.union([z.string(), z.array(z.string()), z.number()]),
});

export const triggerRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  channel: z.enum(['gerrit', 'jira', 'gitlab', 'feishu', 'wechat', 'dingtalk', 'slack', 'custom']),
  eventType: z.string(),
  conditions: z.array(triggerConditionSchema).optional(),
  workflowId: z.string(),
  inputMapping: z.record(z.string()),
  enabled: z.boolean().default(true),
  cooldownMs: z.number().optional(),
  maxConcurrent: z.number().optional(),
});

export const cronScheduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  cron: z.string(),
  timezone: z.string().optional(),
  workflowId: z.string(),
  input: z.record(z.unknown()).optional(),
  enabled: z.boolean().default(true),
  maxConcurrent: z.number().optional(),
  retryOnFailure: z.boolean().optional(),
});

// ============================================================
// Cluster Config Schema
// ============================================================

export const distributionConfigSchema = z.object({
  strategy: z.enum(['round-robin', 'least-loaded', 'resource-aware', 'label-match']).default('least-loaded'),
  heartbeatTimeoutMs: z.number().default(30000),
  heartbeatIntervalMs: z.number().default(10000),
  queueTimeoutMs: z.number().default(60000),
  autoFailover: z.boolean().default(true),
});

export const clusterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  distribution: distributionConfigSchema.optional(),
  nodes: z.array(z.object({
    hostname: z.string(),
    endpoint: z.string(),
    backendType: z.enum(['local', 'docker', 'ssh', 'kubernetes']),
    labels: z.record(z.string()).optional(),
  })).optional(),
});

// ============================================================
// Alert Config Schema
// ============================================================

export const alertConditionSchema = z.object({
  operator: z.enum(['gt', 'lt', 'gte', 'lte', 'eq']),
  threshold: z.number(),
  durationMs: z.number().optional(),
  windowMs: z.number().optional(),
});

export const alertRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  metric: z.string(),
  condition: alertConditionSchema,
  severity: z.enum(['info', 'warning', 'critical']),
  cooldownMs: z.number().optional(),
  notifyChannels: z.array(z.string()).optional(),
  enabled: z.boolean().default(true),
});

// ============================================================
// Monitor Config Schema
// ============================================================

export const monitorConfigSchema = z.object({
  port: z.number().default(3001),
  host: z.string().default('0.0.0.0'),
  metricsPath: z.string().default('/metrics'),
  enableWebSocket: z.boolean().default(true),
  enableAlerts: z.boolean().default(true),
  alertRules: z.array(alertRuleSchema).optional(),
});

// ============================================================
// Gateway Config Schema
// ============================================================

export const channelConfigSchema = z.object({
  platform: z.enum(['gerrit', 'jira', 'gitlab', 'feishu', 'wechat', 'dingtalk', 'slack', 'custom']),
  enabled: z.boolean().default(true),
  secret: z.string().optional(),
  path: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

export const gatewayConfigSchema = z.object({
  port: z.number().default(3002),
  host: z.string().default('0.0.0.0'),
  basePath: z.string().default('/hooks'),
  channels: z.array(channelConfigSchema),
  cors: z.object({
    origins: z.array(z.string()),
    methods: z.array(z.string()).optional(),
  }).optional(),
  rateLimit: z.object({
    windowMs: z.number(),
    maxRequests: z.number(),
  }).optional(),
});

// ============================================================
// MCP Config Schema
// ============================================================

export const mcpServerConfigSchema = z.object({
  name: z.string(),
  version: z.string(),
  transport: z.enum(['stdio', 'http']),
  port: z.number().optional(),
  exposedWorkflows: z.array(z.string()).optional(),
  exposedAgents: z.array(z.string()).optional(),
});

export const mcpClientConfigSchema = z.object({
  name: z.string(),
  transport: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('stdio'),
      command: z.string(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string()).optional(),
    }),
    z.object({
      type: z.literal('http'),
      url: z.string(),
      headers: z.record(z.string()).optional(),
    }),
  ]),
  autoApprove: z.boolean().optional(),
});

// ============================================================
// Policy Config Schema
// ============================================================

export const policyScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }),
  z.object({ type: z.literal('workflow'), workflowId: z.string() }),
  z.object({ type: z.literal('agent'), agentId: z.string() }),
  z.object({ type: z.literal('environment'), environment: z.string() }),
]);

export const policyRuleSchema = z.object({
  id: z.string(),
  description: z.string(),
  condition: z.string(),
  effect: z.enum(['allow', 'deny']),
});

export const policySchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: policyScopeSchema,
  rules: z.array(policyRuleSchema),
  enforcement: z.enum(['enforce', 'audit']),
  enabled: z.boolean().default(true),
});

// ============================================================
// Environment Config Schema
// ============================================================

export const environmentConfigSchema = z.object({
  name: z.string(),
  providers: z.record(z.record(z.unknown())).optional(),
  execution: z.object({
    backend: z.enum(['local', 'docker', 'ssh', 'kubernetes']),
    config: z.record(z.unknown()).optional(),
  }).optional(),
  variables: z.record(z.string()).optional(),
});

// ============================================================
// Eval Config Schema
// ============================================================

export const evalMetricConfigSchema = z.object({
  name: z.string(),
  type: z.enum(['exact-match', 'contains', 'json-validity', 'llm-judge', 'semantic-similarity']),
  prompt: z.string().optional(),
  threshold: z.number().min(0).max(1).default(0.5),
});

export const evalCaseSchema = z.object({
  id: z.string(),
  input: z.string(),
  expectedOutput: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const evalSuiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  agentId: z.string(),
  cases: z.array(evalCaseSchema),
  metrics: z.array(evalMetricConfigSchema),
});

// ============================================================
// Full Matrix Config Schema (matrix.config.yaml)
// ============================================================

export const matrixConfigSchema = z.object({
  providers: providerRouterConfigSchema.optional(),
  tokenPool: z.object({
    defaultBudget: tokenBudgetSchema.optional(),
    workflowBudgets: z.record(tokenBudgetSchema).optional(),
  }).optional(),
  execution: executionConfigSchema.optional(),
  gateway: gatewayConfigSchema.optional(),
  monitor: monitorConfigSchema.optional(),
  cluster: clusterConfigSchema.optional(),
  triggers: z.array(triggerRuleSchema).optional(),
  schedules: z.array(cronScheduleSchema).optional(),
  policies: z.array(policySchema).optional(),
  environments: z.array(environmentConfigSchema).optional(),
  activeEnvironment: z.string().optional(),
  mcp: z.object({
    server: mcpServerConfigSchema.optional(),
    clients: z.array(mcpClientConfigSchema).optional(),
  }).optional(),
});

// ============================================================
// Type Exports
// ============================================================

export type AgentDefinitionInput = z.infer<typeof agentDefinitionSchema>;
export type WorkflowDefinitionInput = z.infer<typeof workflowDefinitionSchema>;
export type MatrixConfigInput = z.infer<typeof matrixConfigSchema>;
export type ProviderConfigInput = z.infer<typeof providerConfigSchema>;
export type TriggerRuleInput = z.infer<typeof triggerRuleSchema>;
export type CronScheduleInput = z.infer<typeof cronScheduleSchema>;
export type AlertRuleInput = z.infer<typeof alertRuleSchema>;
export type GuardrailConfigInput = z.infer<typeof guardrailConfigSchema>;
export type AgentLoopConfigInput = z.infer<typeof agentLoopConfigSchema>;
export type PolicyInput = z.infer<typeof policySchema>;
export type EnvironmentConfigInput = z.infer<typeof environmentConfigSchema>;
export type EvalSuiteInput = z.infer<typeof evalSuiteSchema>;
export type MCPServerConfigInput = z.infer<typeof mcpServerConfigSchema>;
export type MCPClientConfigInput = z.infer<typeof mcpClientConfigSchema>;
