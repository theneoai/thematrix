/**
 * Workflow Engine - 工作流引擎
 */
import type { 
  WorkflowDefinition, 
  WorkflowRun, 
  WorkflowStatus,
  WorkflowContext,
  DAGNode,
  IEventBus,
  IMemoryManager,
  LLMAdapter,
  AgentDefinition,
  DomainEvent,
} from '@thematrix/types';
import { EventTypes } from '@thematrix/types';
import { Logger, generateWorkflowRunId, withRetry, sleep } from '@thematrix/utils';
import { generateId } from '@thematrix/utils';
import { AgentRuntime, type ToolHandler } from '../agent/runtime.js';
import { AgentRegistry } from '../agent/registry.js';

const logger = new Logger({ prefix: 'WorkflowEngine' });

export interface WorkflowEngineOptions {
  eventBus: IEventBus;
  memory: IMemoryManager;
  agentRegistry: AgentRegistry;
  llmAdapterFactory: (config: { provider: string; model: string }) => LLMAdapter;
  agentIdMap?: Map<string, string>;
}

export class WorkflowEngine {
  private eventBus: IEventBus;
  private memory: IMemoryManager;
  private agentRegistry: AgentRegistry;
  private llmAdapterFactory: (config: { provider: string; model: string }) => LLMAdapter;
  private agentIdMap: Map<string, string>;
  private runs = new Map<string, WorkflowRun>();
  private activeAgents = new Map<string, Map<string, AgentRuntime>>();
  private abortControllers = new Map<string, AbortController>();

  constructor(options: WorkflowEngineOptions) {
    this.eventBus = options.eventBus;
    this.memory = options.memory;
    this.agentRegistry = options.agentRegistry;
    this.llmAdapterFactory = options.llmAdapterFactory;
    this.agentIdMap = options.agentIdMap ?? new Map();
  }

  async startWorkflow(
    definition: WorkflowDefinition,
    input: Record<string, unknown>
  ): Promise<WorkflowRun> {
    const runId = generateWorkflowRunId();
    const run: WorkflowRun = {
      runId,
      workflowId: definition.id,
      status: 'running',
      input,
      context: {
        variables: { ...input },
        nodeOutputs: {},
      },
      startedAt: new Date(),
    };

    this.runs.set(runId, run);
    this.activeAgents.set(runId, new Map());
    this.abortControllers.set(runId, new AbortController());

    await this.publishEvent(EventTypes.WORKFLOW_STARTED, {
      workflowId: definition.id,
      runId,
      input,
    });

    logger.info(`Workflow ${definition.id} started (run: ${runId})`);

    // Start execution based on mode
    if (definition.mode === 'dag') {
      this.executeDAG(definition, run).catch(error => {
        this.handleWorkflowError(runId, error);
      });
    } else {
      this.executeStateMachine(definition, run).catch(error => {
        this.handleWorkflowError(runId, error);
      });
    }

    return run;
  }

  private async executeDAG(definition: WorkflowDefinition, run: WorkflowRun): Promise<void> {
    if (!definition.dag) {
      throw new Error('DAG definition is required for DAG mode');
    }

    const dag = definition.dag;
    const completedNodes = new Set<string>();
    const runningNodes = new Set<string>();
    const abortController = this.abortControllers.get(run.runId)!;

    // Build dependency graph
    const dependencies = new Map<string, Set<string>>();
    const dependents = new Map<string, Set<string>>();
    
    for (const node of dag.nodes) {
      dependencies.set(node.id, new Set());
      dependents.set(node.id, new Set());
    }
    
    for (const edge of dag.edges) {
      dependencies.get(edge.to)?.add(edge.from);
      dependents.get(edge.from)?.add(edge.to);
    }

    // Find root nodes (no dependencies)
    const readyNodes = dag.nodes.filter(n => dependencies.get(n.id)?.size === 0);

    // Execute nodes
    const executeNode = async (node: DAGNode): Promise<void> => {
      if (abortController.signal.aborted) {
        throw new Error('Workflow cancelled');
      }

      if (completedNodes.has(node.id) || runningNodes.has(node.id)) {
        return;
      }

      // Check if all dependencies are completed
      const deps = dependencies.get(node.id) ?? new Set();
      for (const dep of deps) {
        if (!completedNodes.has(dep)) {
          return; // Wait for dependencies
        }
      }

      runningNodes.add(node.id);

      await this.publishEvent(EventTypes.WORKFLOW_NODE_STARTED, {
        workflowId: definition.id,
        runId: run.runId,
        nodeId: node.id,
        agentId: node.agentId,
      });

      try {
        // Execute with retry
        const output = await withRetry(
          () => this.executeNode(definition, node, run),
          {
            maxRetries: node.retry?.maxRetries ?? 2,
            retryDelayMs: node.retry?.retryDelayMs ?? 1000,
          }
        );

        run.context.nodeOutputs[node.id] = output;
        completedNodes.add(node.id);
        runningNodes.delete(node.id);

        await this.publishEvent(EventTypes.WORKFLOW_NODE_COMPLETED, {
          workflowId: definition.id,
          runId: run.runId,
          nodeId: node.id,
          output,
        });

        // Trigger dependent nodes
        const depsOfNode = dependents.get(node.id) ?? new Set();
        for (const dependentId of depsOfNode) {
          const dependentNode = dag.nodes.find(n => n.id === dependentId);
          if (dependentNode) {
            executeNode(dependentNode).catch(error => {
              this.handleNodeError(run.runId, node.id, error);
            });
          }
        }

        // Check if all nodes completed
        if (completedNodes.size === dag.nodes.length) {
          await this.completeWorkflow(run.runId);
        }
      } catch (error) {
        runningNodes.delete(node.id);
        await this.handleNodeError(run.runId, node.id, error);
      }
    };

    // Start with ready nodes
    await Promise.all(readyNodes.map(node => executeNode(node)));
  }

  private async executeStateMachine(
    definition: WorkflowDefinition, 
    run: WorkflowRun
  ): Promise<void> {
    if (!definition.stateMachine) {
      throw new Error('State machine definition is required for state-machine mode');
    }

    const sm = definition.stateMachine;
    let currentState = sm.initialState;
    const abortController = this.abortControllers.get(run.runId)!;

    while (!abortController.signal.aborted) {
      const state = sm.states[currentState];
      if (!state) {
        throw new Error(`Unknown state: ${currentState}`);
      }

      // Handle terminal states
      if (state.type === 'succeed') {
        await this.completeWorkflow(run.runId);
        return;
      }
      if (state.type === 'fail') {
        throw new Error(`Workflow failed at state: ${currentState}`);
      }

      await this.publishEvent(EventTypes.WORKFLOW_NODE_STARTED, {
        workflowId: definition.id,
        runId: run.runId,
        nodeId: currentState,
        agentId: state.agentId,
      });

      try {
        let nextState: string | undefined;

        if (state.type === 'wait') {
          // Wait state
          const waitMs = state.seconds ? state.seconds * 1000 : 0;
          await sleep(waitMs);
          nextState = state.next;
        } else if (state.type === 'choice') {
          // Choice state - evaluate conditions
          for (const choice of state.choices ?? []) {
            // Simple condition evaluation (placeholder)
            if (this.evaluateCondition(choice.condition, run.context)) {
              nextState = choice.next;
              break;
            }
          }
          if (!nextState) {
            throw new Error(`No matching choice for state: ${currentState}`);
          }
        } else {
          // Task state - execute agent
          const output = await withRetry(
            () => this.executeStateTask(definition, currentState, state, run),
            {
              maxRetries: state.retry?.maxRetries ?? 2,
              retryDelayMs: state.retry?.retryDelayMs ?? 1000,
            }
          );

          run.context.nodeOutputs[currentState] = output;
          nextState = state.next;
        }

        await this.publishEvent(EventTypes.WORKFLOW_NODE_COMPLETED, {
          workflowId: definition.id,
          runId: run.runId,
          nodeId: currentState,
        });

        if (!nextState) {
          throw new Error(`No next state defined for: ${currentState}`);
        }

        currentState = nextState;
      } catch (error) {
        await this.handleNodeError(run.runId, currentState, error);
        return;
      }
    }
  }

  private async executeNode(
    definition: WorkflowDefinition,
    node: DAGNode,
    run: WorkflowRun
  ): Promise<unknown> {
    const agentRef = definition.agents[node.agentId];
    if (!agentRef) {
      throw new Error(`Agent not found: ${node.agentId}`);
    }

    const agentDef = await this.resolveAgentDefinition(agentRef);
    const runtime = await this.createAgentRuntime(agentDef, run.runId);

    // Prepare input
    const input = this.prepareNodeInput(node, run.context);
    
    // Execute agent
    const output = await runtime.runTurn(JSON.stringify(input));
    
    return { result: output };
  }

  private async executeStateTask(
    definition: WorkflowDefinition,
    stateId: string,
    state: { agentId?: string; inputMapping?: Record<string, string> },
    run: WorkflowRun
  ): Promise<unknown> {
    if (!state.agentId) {
      throw new Error(`No agentId defined for state: ${stateId}`);
    }

    const agentRef = definition.agents[state.agentId];
    if (!agentRef) {
      throw new Error(`Agent not found: ${state.agentId}`);
    }

    const agentDef = await this.resolveAgentDefinition(agentRef);
    const runtime = await this.createAgentRuntime(agentDef, run.runId);

    // Prepare input
    const input = state.inputMapping 
      ? this.mapInput(state.inputMapping, run.context)
      : {};
    
    // Execute agent
    const output = await runtime.runTurn(JSON.stringify(input));
    
    return { result: output };
  }

  private async resolveAgentDefinition(agentRef: { ref: string }): Promise<AgentDefinition> {
    // First check if the ref is directly in the registry
    let agent = this.agentRegistry.get(agentRef.ref);
    if (agent) {
      return agent;
    }
    
    // Check if there's a mapped agent ID for this ref
    const mappedId = this.agentIdMap.get(agentRef.ref);
    if (mappedId) {
      agent = this.agentRegistry.get(mappedId);
      if (agent) {
        return agent;
      }
    }
    
    throw new Error(`Agent definition not found: ${agentRef.ref}`);
  }

  private async createAgentRuntime(
    definition: AgentDefinition, 
    workflowRunId: string
  ): Promise<AgentRuntime> {
    const llmAdapter = this.llmAdapterFactory({
      provider: definition.model.provider,
      model: definition.model.model,
    });

    const runtime = new AgentRuntime({
      definition,
      workflowRunId,
      llmAdapter,
      memory: this.memory,
      eventBus: this.eventBus,
    });

    await runtime.initialize();

    const agents = this.activeAgents.get(workflowRunId);
    if (agents) {
      agents.set(runtime.instanceId, runtime);
    }

    return runtime;
  }

  private prepareNodeInput(node: DAGNode, context: WorkflowContext): unknown {
    if (!node.inputMapping) {
      return context.variables;
    }
    return this.mapInput(node.inputMapping, context);
  }

  private mapInput(mapping: Record<string, string>, context: WorkflowContext): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    for (const [key, path] of Object.entries(mapping)) {
      result[key] = this.resolvePath(path, context);
    }
    
    return result;
  }

  private resolvePath(path: string, context: WorkflowContext): unknown {
    // Simple path resolution: $.input.x or $.nodes.nodeId.output
    if (path.startsWith("'") && path.endsWith("'")) {
      return path.slice(1, -1);
    }
    
    if (path.startsWith('$.input.')) {
      const key = path.slice(8);
      return context.variables[key];
    }
    
    if (path.startsWith('$.nodes.')) {
      const parts = path.slice(8).split('.');
      const nodeId = parts[0];
      return context.nodeOutputs[nodeId];
    }
    
    return path;
  }

  private evaluateCondition(condition: string, context: WorkflowContext): boolean {
    // Placeholder - simple condition evaluation
    // In production, use a proper expression evaluator
    try {
      return !!condition;
    } catch {
      return false;
    }
  }

  private async completeWorkflow(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    run.status = 'completed';
    run.completedAt = new Date();
    run.output = run.context.nodeOutputs;

    await this.publishEvent(EventTypes.WORKFLOW_COMPLETED, {
      workflowId: run.workflowId,
      runId,
      output: run.output,
    });

    this.cleanup(runId);
    logger.info(`Workflow ${run.workflowId} completed (run: ${runId})`);
  }

  private async handleNodeError(runId: string, nodeId: string, error: unknown): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    run.status = 'failed';
    run.error = error instanceof Error ? error.message : String(error);
    run.completedAt = new Date();

    await this.publishEvent(EventTypes.WORKFLOW_NODE_FAILED, {
      workflowId: run.workflowId,
      runId,
      nodeId,
      error: run.error,
    });

    await this.publishEvent(EventTypes.WORKFLOW_FAILED, {
      workflowId: run.workflowId,
      runId,
      error: run.error,
    });

    this.cleanup(runId);
    logger.error(`Workflow ${run.workflowId} failed at node ${nodeId}:`, error);
  }

  private async handleWorkflowError(runId: string, error: unknown): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    run.status = 'failed';
    run.error = error instanceof Error ? error.message : String(error);
    run.completedAt = new Date();

    await this.publishEvent(EventTypes.WORKFLOW_FAILED, {
      workflowId: run.workflowId,
      runId,
      error: run.error,
    });

    this.cleanup(runId);
    logger.error(`Workflow ${run.workflowId} failed:`, error);
  }

  async pauseWorkflow(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'running') {
      throw new Error(`Workflow ${runId} is not running`);
    }

    run.status = 'paused';
    
    // Pause all active agents
    const agents = this.activeAgents.get(runId);
    if (agents) {
      for (const runtime of agents.values()) {
        await runtime.pause();
      }
    }

    await this.publishEvent(EventTypes.WORKFLOW_PAUSED, {
      workflowId: run.workflowId,
      runId,
    });

    logger.info(`Workflow ${run.workflowId} paused (run: ${runId})`);
  }

  async resumeWorkflow(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'paused') {
      throw new Error(`Workflow ${runId} is not paused`);
    }

    run.status = 'running';
    
    // Resume all active agents
    const agents = this.activeAgents.get(runId);
    if (agents) {
      for (const runtime of agents.values()) {
        await runtime.resume();
      }
    }

    await this.publishEvent(EventTypes.WORKFLOW_RESUMED, {
      workflowId: run.workflowId,
      runId,
    });

    logger.info(`Workflow ${run.workflowId} resumed (run: ${runId})`);
  }

  async cancelWorkflow(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Workflow ${runId} not found`);
    }

    run.status = 'cancelled';
    run.completedAt = new Date();

    // Abort running operations
    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
    }

    // Stop all agents
    const agents = this.activeAgents.get(runId);
    if (agents) {
      for (const runtime of agents.values()) {
        await runtime.stop();
      }
    }

    await this.publishEvent(EventTypes.WORKFLOW_CANCELLED, {
      workflowId: run.workflowId,
      runId,
    });

    this.cleanup(runId);
    logger.info(`Workflow ${run.workflowId} cancelled (run: ${runId})`);
  }

  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  getRuns(): WorkflowRun[] {
    return Array.from(this.runs.values());
  }

  private cleanup(runId: string): void {
    this.activeAgents.delete(runId);
    this.abortControllers.delete(runId);
  }

  private async publishEvent(type: string, payload: unknown): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type,
      source: { kind: 'workflow', id: payload && typeof payload === 'object' && 'runId' in payload ? String(payload.runId) : 'unknown' },
      timestamp: new Date(),
      payload,
      correlationId: payload && typeof payload === 'object' && 'runId' in payload ? String(payload.runId) : 'unknown',
    };
    await this.eventBus.publish(event);
  }
}
