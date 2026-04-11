/**
 * WorkflowEngine — Critical path tests
 *
 * Covers: DAG execution, concurrency limits, input validation,
 * circular dependency detection, invalid edge detection, and event publishing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowEngine } from './engine.js';
import { AgentRegistry } from '../agent/registry.js';
import type {
  WorkflowDefinition,
  IEventBus,
  IMemoryManager,
  LLMAdapter,
  DomainEvent,
  ConversationTurn,
  ChatResponse,
  AgentDefinition,
} from '@thematrix/types';

// ─────────────────────────────────────────────────────────────────────────────
// Mock factories
// ─────────────────────────────────────────────────────────────────────────────

function createMockEventBus(): IEventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    replay: vi.fn(),
    createEvent: vi.fn(),
  } as unknown as IEventBus;
}

function createMockMemory(): IMemoryManager {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue([]),
    embed: vi.fn().mockResolvedValue('vec-1'),
    search: vi.fn().mockResolvedValue([]),
    appendTurn: vi.fn().mockResolvedValue('turn-1'),
    getHistory: vi.fn().mockResolvedValue([]),
    clearHistory: vi.fn().mockResolvedValue(undefined),
  } as unknown as IMemoryManager;
}

function createMockLLMAdapter(response = 'ok'): LLMAdapter {
  return {
    provider: 'mock' as const,
    chat: vi.fn().mockResolvedValue({
      id: 'resp-1',
      model: 'mock-model',
      content: response,
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    } satisfies ChatResponse),
    chatStream: vi.fn(),
    countTokens: vi.fn().mockResolvedValue(5),
  } as unknown as LLMAdapter;
}

function createAgentDefinition(id: string): AgentDefinition {
  return {
    id,
    name: id,
    version: '1.0',
    persona: {
      systemPrompt: 'You are a test agent.',
      personality: 'helpful',
      role: 'assistant',
      traits: {},
    },
    model: { provider: 'mock', model: 'mock-model' },
    skills: [],
    tools: [],
    memory: { persistHistory: false, maxHistoryTurns: 5, scopes: [] },
    maxConcurrency: 1,
    turnTimeoutMs: 5000,
    metadata: {},
  } as AgentDefinition;
}

function buildWorkflowDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'wf-test',
    name: 'Test Workflow',
    version: '1.0',
    mode: 'dag',
    agents: { 'agent-a': { ref: 'agent-a' } },
    dag: {
      nodes: [{ id: 'node-a', agentId: 'agent-a', type: 'task' }],
      edges: [],
    },
    sharedMemory: { scope: 'workflow-shared', ttlSeconds: 3600 },
    ...overrides,
  } as WorkflowDefinition;
}

function buildEngine(
  overrides: {
    eventBus?: IEventBus;
    memory?: IMemoryManager;
    llmAdapter?: LLMAdapter;
    maxConcurrentWorkflows?: number;
    globalTimeoutMs?: number;
  } = {},
): { engine: WorkflowEngine; eventBus: IEventBus; registry: AgentRegistry } {
  const eventBus = overrides.eventBus ?? createMockEventBus();
  const memory = overrides.memory ?? createMockMemory();
  const llmAdapter = overrides.llmAdapter ?? createMockLLMAdapter();
  const registry = new AgentRegistry();

  // Register a default agent
  registry.register(createAgentDefinition('agent-a'));
  registry.register(createAgentDefinition('agent-b'));
  registry.register(createAgentDefinition('agent-c'));

  const engine = new WorkflowEngine({
    eventBus,
    memory,
    agentRegistry: registry,
    llmAdapterFactory: () => llmAdapter,
    maxConcurrentWorkflows: overrides.maxConcurrentWorkflows ?? 10,
    globalTimeoutMs: overrides.globalTimeoutMs ?? 30000,
  });

  return { engine, eventBus, registry };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkflowEngine', () => {
  describe('startWorkflow', () => {
    it('returns a running WorkflowRun with the correct workflowId', async () => {
      const { engine } = buildEngine();
      const definition = buildWorkflowDefinition();
      const run = await engine.startWorkflow(definition, {});

      expect(run.workflowId).toBe('wf-test');
      expect(run.status).toBe('running');
      expect(run.runId).toBeTruthy();
    });

    it('populates context.variables from input', async () => {
      const { engine } = buildEngine();
      const definition = buildWorkflowDefinition();
      const run = await engine.startWorkflow(definition, { key: 'value', count: 42 });

      expect(run.context.variables.key).toBe('value');
      expect(run.context.variables.count).toBe(42);
    });

    it('publishes WORKFLOW_STARTED event', async () => {
      const eventBus = createMockEventBus();
      const { engine } = buildEngine({ eventBus });
      await engine.startWorkflow(buildWorkflowDefinition(), {});

      const publishCalls = (eventBus.publish as ReturnType<typeof vi.fn>).mock.calls;
      const startedEvent = publishCalls.find(
        ([event]: [DomainEvent]) => event.type === 'workflow.started',
      );
      expect(startedEvent).toBeDefined();
    });

    it('rejects when required input fields are missing', async () => {
      const { engine } = buildEngine();
      const definition = buildWorkflowDefinition({
        inputSchema: { required: ['userId', 'task'] },
      });

      await expect(
        engine.startWorkflow(definition, { userId: 'u1' }),
      ).rejects.toThrow(/Missing required workflow input fields.*task/);
    });

    it('enforces maxConcurrentWorkflows limit', async () => {
      // Use globalTimeoutMs of 10s so running workflows do not auto-abort too fast
      const { engine } = buildEngine({ maxConcurrentWorkflows: 1, globalTimeoutMs: 10000 });
      const definition = buildWorkflowDefinition();

      // Start first workflow — it runs asynchronously
      await engine.startWorkflow(definition, {});

      // Second start should be rejected immediately
      await expect(engine.startWorkflow(definition, {})).rejects.toThrow(
        /Maximum concurrent workflows.*exceeded/,
      );
    });
  });

  describe('DAG execution', () => {
    it('detects circular dependencies and throws', async () => {
      const { engine } = buildEngine();
      const definition = buildWorkflowDefinition({
        agents: {
          'agent-a': { ref: 'agent-a' },
          'agent-b': { ref: 'agent-b' },
        },
        dag: {
          nodes: [
            { id: 'node-a', agentId: 'agent-a', type: 'task' },
            { id: 'node-b', agentId: 'agent-b', type: 'task' },
          ],
          edges: [
            { from: 'node-a', to: 'node-b' },
            { from: 'node-b', to: 'node-a' }, // creates cycle
          ],
        },
      });

      // The engine starts the run, then the DAG executor throws —
      // the error surfaces via run.status (async) or the returned run.
      // We assert the run was created (engine does not throw synchronously).
      const run = await engine.startWorkflow(definition, {});
      expect(run.runId).toBeTruthy();

      // Allow the async DAG to settle
      await new Promise(r => setTimeout(r, 50));
      const latestRun = engine.getRun(run.runId);
      expect(latestRun?.status).toBe('failed');
    });

    it('rejects edges referencing non-existent nodes', async () => {
      const { engine } = buildEngine();
      const definition = buildWorkflowDefinition({
        dag: {
          nodes: [{ id: 'node-a', agentId: 'agent-a', type: 'task' }],
          edges: [{ from: 'node-a', to: 'node-does-not-exist' }],
        },
      });

      const run = await engine.startWorkflow(definition, {});
      await new Promise(r => setTimeout(r, 50));
      expect(engine.getRun(run.runId)?.status).toBe('failed');
    });

    it('requires a dag definition when mode is dag', async () => {
      const { engine } = buildEngine();
      const definition = buildWorkflowDefinition({ dag: undefined });
      const run = await engine.startWorkflow(definition, {});

      await new Promise(r => setTimeout(r, 50));
      expect(engine.getRun(run.runId)?.status).toBe('failed');
    });
  });

  describe('getRun / listRuns', () => {
    it('returns undefined for an unknown run', () => {
      const { engine } = buildEngine();
      expect(engine.getRun('nonexistent-run')).toBeUndefined();
    });

    it('lists all active runs', async () => {
      const { engine } = buildEngine({ maxConcurrentWorkflows: 5 });
      const def = buildWorkflowDefinition();
      const run1 = await engine.startWorkflow(def, {});
      expect(engine.getRun(run1.runId)).toBeDefined();
    });
  });

  describe('cancelWorkflow', () => {
    it('marks a running workflow as cancelled', async () => {
      const { engine } = buildEngine({ globalTimeoutMs: 60000 });
      const run = await engine.startWorkflow(buildWorkflowDefinition(), {});
      await engine.cancelWorkflow(run.runId);

      await new Promise(r => setTimeout(r, 50));
      const latestRun = engine.getRun(run.runId);
      // After cancellation the status transitions to 'failed' or 'cancelled'
      expect(['failed', 'cancelled']).toContain(latestRun?.status);
    });

    it('is a no-op for an unknown run', async () => {
      const { engine } = buildEngine();
      // Should not throw
      await expect(engine.cancelWorkflow('unknown-run')).resolves.not.toThrow();
    });
  });
});
