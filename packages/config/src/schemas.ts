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
});

export const dagNodeSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  type: z.enum(['task', 'parallel', 'choice', 'wait']),
  inputMapping: z.record(z.string()).optional(),
  condition: z.string().optional(),
  retry: z.object({
    maxRetries: z.number(),
    retryDelayMs: z.number(),
  }).optional(),
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

export const workflowDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  mode: z.enum(['dag', 'state-machine']),
  agents: z.record(agentRefSchema),
  dag: dagDefinitionSchema.optional(),
  stateMachine: stateMachineDefinitionSchema.optional(),
  sharedMemory: workflowMemoryConfigSchema,
  schedule: scheduleConfigSchema.optional(),
  integrations: z.array(integrationConfigSchema).optional(),
  timeoutMs: z.number().optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
}).refine(
  (data) => {
    if (data.mode === 'dag') return data.dag !== undefined;
    if (data.mode === 'state-machine') return data.stateMachine !== undefined;
    return false;
  },
  {
    message: 'dag or stateMachine must be provided based on mode',
  }
);

export type AgentDefinitionInput = z.infer<typeof agentDefinitionSchema>;
export type WorkflowDefinitionInput = z.infer<typeof workflowDefinitionSchema>;
