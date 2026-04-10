/**
 * Workflow Engine - 工作流引擎 (Production Ready)
 */
import type {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowContext,
  DAGNode,
  IEventBus,
  IMemoryManager,
  IMessageBroker,
  LLMAdapter,
  AgentDefinition,
  DomainEvent,
  IApprovalManager,
  ITelemetryProvider,
  ICognitiveMemoryManager,
  ICheckpointStore,
  WorkflowCheckpoint,
} from '@thematrix/types';
import { EventTypes } from '@thematrix/types';
import { Logger, generateWorkflowRunId, sleep } from '@thematrix/utils';
import { generateId } from '@thematrix/utils';
import { AgentRuntime } from '../agent/runtime.js';
import { AgentRegistry } from '../agent/registry.js';
import { DynamicWorkflowExecutor } from './dynamic.js';
import { CognitiveWorkflowExecutor } from './cognitive.js';
import { ApprovalManager } from './approval.js';
import { WorkflowError, ResourceNotFoundError, classifyError } from '../error/index.js';
import { metrics, Metrics } from '../metrics/index.js';
import { traceWorkflowNode } from '../telemetry/instrumentation.js';

const logger = new Logger({ prefix: 'WorkflowEngine' });

export interface WorkflowEngineOptions {
  eventBus: IEventBus;
  memory: IMemoryManager;
  agentRegistry: AgentRegistry;
  llmAdapterFactory: (config: { provider: string; model: string }) => LLMAdapter;
  agentIdMap?: Map<string, string>;
  /**
   * Message broker for inter-agent communication (required for dynamic mode)
   */
  messageBroker?: IMessageBroker;
  /**
   * 全局超时时间（毫秒）
   */
  globalTimeoutMs?: number;
  /**
   * 最大并发工作流数
   */
  maxConcurrentWorkflows?: number;
  /**
   * Approval manager for human-in-the-loop approval gates
   */
  approvalManager?: IApprovalManager;
  /** Telemetry provider for distributed tracing (optional) */
  telemetry?: ITelemetryProvider;
  /** Cognitive memory manager, passed through to AgentRuntime instances (optional) */
  cognitiveMemory?: ICognitiveMemoryManager;
  /** Checkpoint store for durable workflow state (optional, enables resume) */
  checkpointStore?: ICheckpointStore;
}

interface WorkflowStats {
  startedAt: Date;
  nodeExecutions: Map<string, NodeExecutionStats>;
}

interface NodeExecutionStats {
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  retryCount: number;
}

export class WorkflowEngine {
  private eventBus: IEventBus;
  private memory: IMemoryManager;
  private agentRegistry: AgentRegistry;
  private llmAdapterFactory: (config: { provider: string; model: string }) => LLMAdapter;
  private agentIdMap: Map<string, string>;
  private messageBroker?: IMessageBroker;
  private approvalManager?: IApprovalManager;
  private telemetry?: ITelemetryProvider;
  private cognitiveMemory?: ICognitiveMemoryManager;
  private checkpointStore?: ICheckpointStore;
  private runs = new Map<string, WorkflowRun>();
  private runStats = new Map<string, WorkflowStats>();
  private activeAgents = new Map<string, Map<string, AgentRuntime>>();
  private abortControllers = new Map<string, AbortController>();
  private globalTimeoutMs: number;
  private maxConcurrentWorkflows: number;
  private activeWorkflowCount = 0;

  constructor(options: WorkflowEngineOptions) {
    this.eventBus = options.eventBus;
    this.memory = options.memory;
    this.agentRegistry = options.agentRegistry;
    this.llmAdapterFactory = options.llmAdapterFactory;
    this.agentIdMap = options.agentIdMap ?? new Map();
    this.messageBroker = options.messageBroker;
    this.approvalManager = options.approvalManager;
    this.telemetry = options.telemetry;
    this.cognitiveMemory = options.cognitiveMemory;
    this.checkpointStore = options.checkpointStore;
    this.globalTimeoutMs = options.globalTimeoutMs ?? 300000; // 5分钟默认
    this.maxConcurrentWorkflows = options.maxConcurrentWorkflows ?? 10;
  }

  async startWorkflow(
    definition: WorkflowDefinition,
    input: Record<string, unknown>
  ): Promise<WorkflowRun> {
    // Validate input against schema if defined
    if (definition.inputSchema) {
      const required = (definition.inputSchema as Record<string, unknown>)['required'];
      if (Array.isArray(required)) {
        const missing = required.filter((key: string) => !(key in input));
        if (missing.length > 0) {
          throw new WorkflowError(
            `Missing required workflow input fields: ${missing.join(', ')}`,
            definition.id,
          );
        }
      }
    }

    // 检查并发限制
    if (this.activeWorkflowCount >= this.maxConcurrentWorkflows) {
      throw new WorkflowError(
        `Maximum concurrent workflows (${this.maxConcurrentWorkflows}) exceeded`,
        definition.id
      );
    }

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
    this.runStats.set(runId, {
      startedAt: new Date(),
      nodeExecutions: new Map(),
    });

    this.activeWorkflowCount++;
    metrics.inc(Metrics.WORKFLOW_RUNS_TOTAL, { workflow_id: definition.id });
    metrics.set(Metrics.WORKFLOW_RUNS_ACTIVE, this.activeWorkflowCount);

    await this.publishEvent(EventTypes.WORKFLOW_STARTED, {
      workflowId: definition.id,
      runId,
      input,
    });

    logger.info(`Workflow ${definition.id} started (run: ${runId})`);

    // 设置全局超时 — abort the workflow when timeout fires so running
    // nodes stop promptly rather than continuing in the background.
    const abortController = this.abortControllers.get(runId)!;
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, this.globalTimeoutMs);

    // 执行工作流
    let executionPromise: Promise<void>;
    if (definition.mode === 'dag') {
      executionPromise = this.executeDAG(definition, run);
    } else if (definition.mode === 'dynamic') {
      executionPromise = this.executeDynamic(definition, run);
    } else if (definition.mode === 'cognitive') {
      executionPromise = this.executeCognitive(definition, run);
    } else {
      executionPromise = this.executeStateMachine(definition, run);
    }

    // Run execution; always clear timeout on completion to prevent leaking timers.
    // void is intentional: workflow runs asynchronously; caller polls via getRun()
    void executionPromise
      .then(() => {
        clearTimeout(timeoutHandle);
        return this.completeWorkflow(runId);
      })
      .catch(error => {
        clearTimeout(timeoutHandle);
        // If aborted due to timeout, wrap with a descriptive error
        const finalError = abortController.signal.aborted
          ? new WorkflowError(
              `Workflow timed out after ${this.globalTimeoutMs}ms`,
              definition.id,
              runId
            )
          : error;
        return this.handleWorkflowError(runId, finalError);
      })
      .catch(err => {
        // completeWorkflow or handleWorkflowError itself threw — last-resort cleanup
        logger.error(`Critical: workflow lifecycle handler failed for run ${runId}:`, err);
        // Ensure activeWorkflowCount is always decremented
        return this.cleanup(runId).catch(() => {});
      });

    return run;
  }

  private async executeDAG(definition: WorkflowDefinition, run: WorkflowRun): Promise<void> {
    if (!definition.dag) {
      throw new WorkflowError('DAG definition is required for DAG mode', definition.id, run.runId);
    }

    const dag = definition.dag;
    const completedNodes = new Set<string>();
    const runningNodes = new Set<string>();
    const failedNodes = new Set<string>();
    const claimedNodes = new Set<string>();
    const abortController = this.abortControllers.get(run.runId)!;

    // 构建依赖图
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

    // Validate DAG edges reference existing nodes
    const nodeIds = new Set(dag.nodes.map(n => n.id));
    for (const edge of dag.edges) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        throw new WorkflowError(
          `Invalid DAG edge: references non-existent node (from: ${edge.from}, to: ${edge.to})`,
          definition.id,
          run.runId,
        );
      }
    }

    // 检查是否有循环依赖
    if (this.hasCircularDependency(dag.nodes.map(n => n.id), dependencies)) {
      throw new WorkflowError('Circular dependency detected in DAG', definition.id, run.runId);
    }

    // 找到根节点
    const readyNodes = dag.nodes.filter(n => dependencies.get(n.id)?.size === 0);

    // Recursively mark all downstream dependents as failed
    const propagateFailureToDownstream = (nodeId: string): void => {
      const downstreamNodes = dependents.get(nodeId) ?? new Set();
      for (const downId of downstreamNodes) {
        if (!failedNodes.has(downId) && !completedNodes.has(downId)) {
          claimedNodes.add(downId);
          failedNodes.add(downId);
          logger.warn(`Node ${downId} skipped because upstream ${nodeId} failed`);
          propagateFailureToDownstream(downId);
        }
      }
    };

    const executeNode = async (node: DAGNode): Promise<void> => {
      if (abortController.signal.aborted) {
        throw new WorkflowError('Workflow cancelled', definition.id, run.runId);
      }

      // Check dependencies BEFORE claiming to avoid premature claims.
      const deps = dependencies.get(node.id) ?? new Set();
      for (const dep of deps) {
        if (failedNodes.has(dep)) {
          // Claim and mark as failed — propagateFailure handles downstream.
          if (claimedNodes.has(node.id)) return;
          claimedNodes.add(node.id);
          failedNodes.add(node.id);
          logger.warn(`Node ${node.id} skipped because dependency ${dep} failed`);
          propagateFailureToDownstream(node.id);
          return;
        }
        if (!completedNodes.has(dep)) {
          return; // 等待依赖 — don't claim yet, another parent will re-trigger
        }
      }

      // Atomically check-and-claim: all deps are satisfied, so claim the node.
      // In JS single-threaded event loop, no await between has() and add()
      // guarantees atomicity.
      if (claimedNodes.has(node.id)) {
        return;
      }
      claimedNodes.add(node.id);
      runningNodes.add(node.id);

      const stats = this.runStats.get(run.runId);
      if (!stats) {
        throw new WorkflowError(`Run stats not found for ${run.runId}`, definition.id, run.runId);
      }
      const nodeStats: NodeExecutionStats = {
        startedAt: new Date(),
        retryCount: 0,
      };
      stats.nodeExecutions.set(node.id, nodeStats);

      await this.publishEvent(EventTypes.WORKFLOW_NODE_STARTED, {
        workflowId: definition.id,
        runId: run.runId,
        nodeId: node.id,
        agentId: node.agentId,
      });

      const nodeStartTime = Date.now();

      try {
        const output = await this.executeNodeWithRetry(definition, node, run);

        run.context.nodeOutputs[node.id] = output;
        completedNodes.add(node.id);
        runningNodes.delete(node.id);
        nodeStats.completedAt = new Date();

        // Save checkpoint after successful node completion
        if (this.checkpointStore) {
          await this.saveCheckpoint(run);
        }

        // 记录指标
        const duration = (Date.now() - nodeStartTime) / 1000;
        metrics.observe(Metrics.WORKFLOW_NODE_DURATION, duration, {
          workflow_id: definition.id,
          node_id: node.id,
          agent_id: node.agentId,
        });

        await this.publishEvent(EventTypes.WORKFLOW_NODE_COMPLETED, {
          workflowId: definition.id,
          runId: run.runId,
          nodeId: node.id,
          output,
          durationMs: Date.now() - nodeStartTime,
        });

        // 触发依赖节点 — use allSettled so sibling branches are not
        // short-circuited when one dependent fails.
        const depsOfNode = dependents.get(node.id) ?? new Set();
        await Promise.allSettled(Array.from(depsOfNode).map(dependentId => {
          const dependentNode = dag.nodes.find(n => n.id === dependentId);
          if (dependentNode) {
            return executeNode(dependentNode);
          }
          return Promise.resolve();
        }));
      } catch (error) {
        runningNodes.delete(node.id);
        failedNodes.add(node.id);
        nodeStats.error = error instanceof Error ? error.message : String(error);

        // 记录错误指标
        metrics.inc(Metrics.AGENT_ERRORS_TOTAL, {
          workflow_id: definition.id,
          node_id: node.id,
        });

        // Propagate failure to all downstream dependents so they don't stay pending
        propagateFailureToDownstream(node.id);

        await this.handleNodeError(run.runId, node.id, error);
        throw error; // 重新抛出以触发工作流失败
      }
    };

    // 启动根节点 — use allSettled so all branches run to completion
    // even if some fail; failures are tracked via failedNodes.
    await Promise.allSettled(readyNodes.map(node => executeNode(node)));

    // 所有节点执行完毕后统一检查是否有失败
    if (failedNodes.size > 0) {
      throw new WorkflowError(
        `${failedNodes.size} node(s) failed`,
        definition.id,
        run.runId,
        { failedNodes: Array.from(failedNodes) }
      );
    }
  }

  private async executeNodeWithRetry(
    definition: WorkflowDefinition,
    node: DAGNode,
    run: WorkflowRun
  ): Promise<unknown> {
    // Handle approval nodes — no retry logic needed
    if (node.type === 'approval') {
      return this.executeApprovalNode(definition, node, run);
    }

    const maxRetries = node.retry?.maxRetries ?? 2;
    const retryDelayMs = node.retry?.retryDelayMs ?? 1000;
    
    let lastError: Error | undefined;
    const stats = this.runStats.get(run.runId);
    const nodeStats = stats?.nodeExecutions.get(node.id);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeNode(definition, node, run);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (nodeStats) nodeStats.retryCount = attempt + 1;

        if (attempt === maxRetries) {
          break;
        }

        // 分类错误决定是否重试
        const classification = classifyError(lastError);
        if (!classification.retryable) {
          throw lastError;
        }

        const backoffMs = classification.backoffMs ?? retryDelayMs;
        logger.warn(
          `Node ${node.id} attempt ${attempt + 1} failed, retrying in ${backoffMs}ms:`,
          lastError.message
        );
        await sleep(backoffMs);
      }
    }

    throw lastError ?? new Error('Unknown error');
  }

  private hasCircularDependency(
    nodes: string[],
    dependencies: Map<string, Set<string>>
  ): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (node: string): boolean => {
      visited.add(node);
      recursionStack.add(node);

      const deps = dependencies.get(node) ?? new Set();
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (hasCycle(dep)) return true;
        } else if (recursionStack.has(dep)) {
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    };

    for (const node of nodes) {
      if (!visited.has(node)) {
        if (hasCycle(node)) return true;
      }
    }

    return false;
  }

  private async executeStateMachine(
    definition: WorkflowDefinition, 
    run: WorkflowRun
  ): Promise<void> {
    if (!definition.stateMachine) {
      throw new WorkflowError('State machine definition is required', definition.id, run.runId);
    }

    const sm = definition.stateMachine;
    let currentState = sm.initialState;
    const maxSteps = Object.keys(sm.states).length * 10;
    let steps = 0;
    const abortController = this.abortControllers.get(run.runId)!;

    while (!abortController.signal.aborted) {
      // 防止无限循环：最大步数为状态数的100倍
      if (++steps > maxSteps) {
        throw new WorkflowError(
          `Infinite loop detected in state machine: exceeded ${maxSteps} steps`,
          definition.id,
          run.runId
        );
      }

      const state = sm.states[currentState];
      if (!state) {
        throw new WorkflowError(`Unknown state: ${currentState}`, definition.id, run.runId);
      }

      // 处理终止状态
      if (state.type === 'succeed') {
        return;
      }
      if (state.type === 'fail') {
        throw new WorkflowError(`Workflow failed at state: ${currentState}`, definition.id, run.runId);
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
          const waitMs = state.seconds ? state.seconds * 1000 : 0;
          await sleep(waitMs);
          nextState = state.next;
        } else if (state.type === 'choice') {
          for (const choice of state.choices ?? []) {
            if (this.evaluateCondition(choice.condition, run.context)) {
              nextState = choice.next;
              break;
            }
          }
          if (!nextState) {
            throw new WorkflowError(`No matching choice for state: ${currentState}`, definition.id, run.runId);
          }
        } else {
          // Task state — apply retry config if present
          const output = await this.executeStateTaskWithRetry(definition, currentState, state, run);
          run.context.nodeOutputs[currentState] = output;
          nextState = state.next;
        }

        await this.publishEvent(EventTypes.WORKFLOW_NODE_COMPLETED, {
          workflowId: definition.id,
          runId: run.runId,
          nodeId: currentState,
        });

        if (!nextState) {
          throw new WorkflowError(`No next state defined for: ${currentState}`, definition.id, run.runId);
        }

        currentState = nextState;
      } catch (error) {
        await this.handleNodeError(run.runId, currentState, error);
        throw error;
      }
    }
  }

  private async executeDynamic(
    definition: WorkflowDefinition,
    run: WorkflowRun
  ): Promise<void> {
    if (!this.messageBroker) {
      throw new WorkflowError(
        'MessageBroker is required for dynamic execution mode. Provide messageBroker in WorkflowEngineOptions.',
        definition.id,
        run.runId,
      );
    }

    const executor = new DynamicWorkflowExecutor({
      eventBus: this.eventBus,
      memory: this.memory,
      agentRegistry: this.agentRegistry,
      llmAdapterFactory: this.llmAdapterFactory,
      messageBroker: this.messageBroker,
      telemetry: this.telemetry,
      cognitiveMemory: this.cognitiveMemory,
    });

    await executor.execute(definition, run);
  }

  private async executeCognitive(
    definition: WorkflowDefinition,
    run: WorkflowRun
  ): Promise<void> {
    const executor = new CognitiveWorkflowExecutor({
      eventBus: this.eventBus,
      memory: this.memory,
      agentRegistry: this.agentRegistry,
      llmAdapterFactory: this.llmAdapterFactory,
      telemetry: this.telemetry,
      cognitiveMemory: this.cognitiveMemory,
    });
    await executor.execute(definition, run);
  }

  private async executeNode(
    definition: WorkflowDefinition,
    node: DAGNode,
    run: WorkflowRun
  ): Promise<unknown> {
    const agentRef = definition.agents[node.agentId];
    if (!agentRef) {
      throw new ResourceNotFoundError(`Agent not found: ${node.agentId}`, 'agent', node.agentId);
    }

    // Start telemetry span for workflow node execution
    const nodeSpan = this.telemetry
      ? traceWorkflowNode(this.telemetry, definition.id, run.runId, node.id)
      : undefined;

    const agentDef = await this.resolveAgentDefinition(agentRef);
    const runtime = await this.createAgentRuntime(agentDef, run.runId);

    try {
      const input = this.prepareNodeInput(node, run.context);
      const output = await runtime.runTurn(JSON.stringify(input));
      if (nodeSpan) { nodeSpan.setStatus({ code: 'ok' }); nodeSpan.end(); }
      return { result: output };
    } catch (error) {
      if (nodeSpan) {
        nodeSpan.setStatus({ code: 'error', message: error instanceof Error ? error.message : String(error) });
        if (error instanceof Error) nodeSpan.recordException(error);
        nodeSpan.end();
      }
      throw error;
    } finally {
      await runtime.stop();
    }
  }

  private async executeApprovalNode(
    definition: WorkflowDefinition,
    node: DAGNode,
    run: WorkflowRun
  ): Promise<unknown> {
    if (!this.approvalManager) {
      throw new WorkflowError(
        'ApprovalManager is required for approval nodes. Provide approvalManager in WorkflowEngineOptions.',
        definition.id,
        run.runId,
      );
    }

    const config = node.approval;
    const message = config?.message ?? `Approval required for node ${node.id} in workflow ${run.workflowId}`;

    const approval = await this.approvalManager.requestApproval({
      workflowRunId: run.runId,
      nodeId: node.id,
      message,
      callbackUrl: config?.callbackUrl,
    });

    logger.info(`Waiting for approval ${approval.id} on node ${node.id} (run: ${run.runId})`);

    const status = await this.approvalManager.waitForApproval(approval.id, config?.timeoutMs);

    if (status === 'approved') {
      logger.info(`Approval ${approval.id} granted for node ${node.id}`);
      return { approved: true };
    }

    if (status === 'timed_out') {
      const timeoutAction = config?.timeoutAction ?? 'reject';
      if (timeoutAction === 'approve') {
        logger.info(`Approval ${approval.id} auto-approved on timeout for node ${node.id}`);
        return { approved: true };
      }
      throw new WorkflowError(
        `Approval timed out for node ${node.id} after ${config?.timeoutMs}ms`,
        definition.id,
        run.runId,
      );
    }

    // status === 'rejected'
    throw new WorkflowError(
      `Approval rejected for node ${node.id}`,
      definition.id,
      run.runId,
    );
  }

  private async executeStateTask(
    definition: WorkflowDefinition,
    stateId: string,
    state: { agentId?: string; inputMapping?: Record<string, string> },
    run: WorkflowRun
  ): Promise<unknown> {
    if (!state.agentId) {
      throw new WorkflowError(`No agentId defined for state: ${stateId}`, definition.id, run.runId);
    }

    const agentRef = definition.agents[state.agentId];
    if (!agentRef) {
      throw new ResourceNotFoundError(`Agent not found: ${state.agentId}`, 'agent', state.agentId);
    }

    const agentDef = await this.resolveAgentDefinition(agentRef);
    const runtime = await this.createAgentRuntime(agentDef, run.runId);

    try {
      const input = state.inputMapping
        ? this.mapInput(state.inputMapping, run.context)
        : {};
      const output = await runtime.runTurn(JSON.stringify(input));
      return { result: output };
    } finally {
      await runtime.stop();
    }
  }

  private async executeStateTaskWithRetry(
    definition: WorkflowDefinition,
    stateId: string,
    state: { agentId?: string; inputMapping?: Record<string, string>; retry?: { maxRetries: number; retryDelayMs: number } },
    run: WorkflowRun
  ): Promise<unknown> {
    const maxRetries = state.retry?.maxRetries ?? 0;
    const retryDelayMs = state.retry?.retryDelayMs ?? 1000;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeStateTask(definition, stateId, state, run);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === maxRetries) break;

        const classification = classifyError(lastError);
        if (!classification.retryable) throw lastError;

        const backoffMs = classification.backoffMs ?? retryDelayMs;
        logger.warn(`State ${stateId} attempt ${attempt + 1} failed, retrying in ${backoffMs}ms:`, lastError.message);
        await sleep(backoffMs);
      }
    }

    throw lastError ?? new Error('Unknown error');
  }

  private async resolveAgentDefinition(agentRef: { ref: string }): Promise<AgentDefinition> {
    let agent = this.agentRegistry.get(agentRef.ref);
    if (agent) {
      return agent;
    }
    
    const mappedId = this.agentIdMap.get(agentRef.ref);
    if (mappedId) {
      agent = this.agentRegistry.get(mappedId);
      if (agent) {
        return agent;
      }
    }
    
    throw new ResourceNotFoundError(`Agent definition not found`, 'agent', agentRef.ref);
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
      // Pass through agent-level guardrails and outputSchema from the definition
      guardrails: definition.guardrails,
      outputSchema: definition.outputSchema,
      telemetry: this.telemetry,
      cognitiveMemory: this.cognitiveMemory,
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
    // 字符串字面量
    if (path.startsWith("'") && path.endsWith("'")) {
      return path.slice(1, -1);
    }

    // 输入变量: $.input.<key>
    if (path.startsWith('$.input.')) {
      const key = path.slice(8);
      return context.variables[key];
    }

    // 节点输出: $.nodes.<nodeId>[.<field>...]
    if (path.startsWith('$.nodes.')) {
      const parts = path.slice(8).split('.');
      const nodeId = parts[0];
      let value: unknown = context.nodeOutputs[nodeId];
      // Navigate remaining path segments into the output object
      for (let i = 1; i < parts.length; i++) {
        if (value === null || value === undefined) break;
        if (typeof value !== 'object') {
          logger.warn(`Cannot navigate path ${path}: encountered non-object at ${parts.slice(0, i + 1).join('.')}`);
          return undefined;
        }
        value = (value as Record<string, unknown>)[parts[i]];
      }
      return value;
    }

    return path;
  }

  private evaluateCondition(condition: string, context: WorkflowContext): boolean {
    try {
      // 支持: <path> == "value"
      const eqMatch = condition.match(/^(\$[\w.]+)\s*==\s*"([^"]*)"$/);
      if (eqMatch) {
        const [, path, expected] = eqMatch;
        return String(this.resolvePath(path, context) ?? '') === expected;
      }
      // 支持: <path> != "value"
      const neqMatch = condition.match(/^(\$[\w.]+)\s*!=\s*"([^"]*)"$/);
      if (neqMatch) {
        const [, path, expected] = neqMatch;
        return String(this.resolvePath(path, context) ?? '') !== expected;
      }
      // Unrecognized condition — fail loudly rather than silently evaluating to true
      logger.warn(`Unsupported condition syntax: "${condition}" — evaluating as false`);
      return false;
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

    // Clean up checkpoint on successful completion
    if (this.checkpointStore) {
      await this.checkpointStore.delete(runId).catch(err => {
        logger.warn(`Failed to delete checkpoint for run ${runId}:`, err);
      });
    }

    const stats = this.runStats.get(runId);
    const duration = stats 
      ? (run.completedAt.getTime() - stats.startedAt.getTime()) / 1000 
      : 0;

    // 记录指标
    metrics.observe(Metrics.WORKFLOW_RUN_DURATION, duration, {
      workflow_id: run.workflowId,
      status: 'completed',
    });

    await this.publishEvent(EventTypes.WORKFLOW_COMPLETED, {
      workflowId: run.workflowId,
      runId,
      output: run.output,
      durationMs: duration * 1000,
    });

    await this.cleanup(runId);
    logger.info(`Workflow ${run.workflowId} completed (run: ${runId}, duration: ${duration}s)`);
  }

  private async handleNodeError(runId: string, nodeId: string, error: unknown): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    const errorMessage = error instanceof Error ? error.message : String(error);

    await this.publishEvent(EventTypes.WORKFLOW_NODE_FAILED, {
      workflowId: run.workflowId,
      runId,
      nodeId,
      error: errorMessage,
    });

    logger.error(`Workflow ${run.workflowId} node ${nodeId} failed:`, error);
  }

  private async handleWorkflowError(runId: string, error: unknown): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    const errorMessage = error instanceof Error ? error.message : String(error);
    run.status = 'failed';
    run.error = errorMessage;
    run.completedAt = new Date();

    await this.publishEvent(EventTypes.WORKFLOW_FAILED, {
      workflowId: run.workflowId,
      runId,
      error: errorMessage,
    });

    const duration = run.completedAt.getTime() - (run.startedAt?.getTime() ?? 0);
    metrics.observe(Metrics.WORKFLOW_RUN_DURATION, duration / 1000, {
      workflow_id: run.workflowId,
      status: 'failed',
    });

    await this.cleanup(runId);
    logger.error(`Workflow ${run.workflowId} failed:`, error);
  }

  private async saveCheckpoint(run: WorkflowRun): Promise<void> {
    if (!this.checkpointStore) return;
    try {
      const existing = await this.checkpointStore.load(run.runId);
      const checkpoint: WorkflowCheckpoint = {
        id: existing?.id ?? generateId(),
        runId: run.runId,
        workflowId: run.workflowId,
        completedNodes: Object.keys(run.context.nodeOutputs),
        nodeOutputs: run.context.nodeOutputs,
        variables: run.context.variables,
        createdAt: new Date(),
        version: (existing?.version ?? 0) + 1,
      };
      await this.checkpointStore.save(checkpoint);
    } catch (err) {
      logger.warn(`Failed to save checkpoint for run ${run.runId}:`, err);
    }
  }

  async resumeFromCheckpoint(
    definition: WorkflowDefinition,
    checkpoint: WorkflowCheckpoint,
  ): Promise<WorkflowRun> {
    logger.info(`Resuming workflow ${definition.id} from checkpoint (run: ${checkpoint.runId}, version: ${checkpoint.version})`);

    const run: WorkflowRun = {
      runId: checkpoint.runId,
      workflowId: definition.id,
      status: 'running',
      input: checkpoint.variables,
      context: {
        variables: checkpoint.variables,
        nodeOutputs: checkpoint.nodeOutputs,
      },
      startedAt: new Date(),
    };

    this.runs.set(run.runId, run);
    this.activeAgents.set(run.runId, new Map());
    this.abortControllers.set(run.runId, new AbortController());
    this.runStats.set(run.runId, { startedAt: new Date(), nodeExecutions: new Map() });
    this.activeWorkflowCount++;

    metrics.inc(Metrics.WORKFLOW_RUNS_TOTAL, { workflow_id: definition.id });
    metrics.set(Metrics.WORKFLOW_RUNS_ACTIVE, this.activeWorkflowCount);

    await this.publishEvent(EventTypes.WORKFLOW_STARTED, {
      workflowId: definition.id,
      runId: run.runId,
      input: run.input,
      resumedFromCheckpoint: checkpoint.version,
    });

    // Set up timeout and execute
    const abortController = this.abortControllers.get(run.runId)!;
    const timeoutHandle = setTimeout(() => abortController.abort(), this.globalTimeoutMs);

    // Execute with checkpoint-aware DAG (skips completed nodes)
    void this.executeDAG(definition, run)
      .then(() => {
        clearTimeout(timeoutHandle);
        return this.completeWorkflow(run.runId);
      })
      .catch(error => {
        clearTimeout(timeoutHandle);
        const finalError = abortController.signal.aborted
          ? new WorkflowError(`Workflow timed out after ${this.globalTimeoutMs}ms`, definition.id, run.runId)
          : error;
        return this.handleWorkflowError(run.runId, finalError);
      })
      .catch(err => {
        logger.error(`Critical: workflow lifecycle handler failed for run ${run.runId}:`, err);
        return this.cleanup(run.runId).catch(() => {});
      });

    return run;
  }

  async pauseWorkflow(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'running') {
      throw new WorkflowError(`Workflow ${runId} is not running`, run?.workflowId ?? 'unknown', runId);
    }

    run.status = 'paused';
    
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
      throw new WorkflowError(`Workflow ${runId} is not paused`, run?.workflowId ?? 'unknown', runId);
    }

    run.status = 'running';
    
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
      throw new WorkflowError(`Workflow ${runId} not found`, 'unknown', runId);
    }

    // Guard: only cancel runs that are still active
    if (run.status !== 'running' && run.status !== 'paused') {
      return;
    }

    run.status = 'cancelled';
    run.completedAt = new Date();

    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
    }

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

    await this.cleanup(runId);
    logger.info(`Workflow ${run.workflowId} cancelled (run: ${runId})`);
  }

  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  getRuns(): WorkflowRun[] {
    return Array.from(this.runs.values());
  }

  getRunStats(runId: string): WorkflowStats | undefined {
    return this.runStats.get(runId);
  }

  private async cleanup(runId: string): Promise<void> {
    // Guard against double cleanup (e.g. cancel + async completion race)
    if (!this.activeAgents.has(runId) && !this.abortControllers.has(runId)) {
      return;
    }

    // Stop any agent runtimes that are still running (e.g. on normal workflow completion)
    const agents = this.activeAgents.get(runId);
    if (agents) {
      for (const runtime of agents.values()) {
        if (runtime.getStatus() !== 'stopped') {
          try {
            await runtime.stop();
          } catch (err) {
            logger.warn(`Failed to stop agent ${runtime.instanceId} during cleanup:`, err);
          }
        }
      }
    }
    this.activeAgents.delete(runId);
    this.abortControllers.delete(runId);
    this.runStats.delete(runId);
    // Clean up completed run from runs map after a retention period (1 hour)
    // to allow status queries shortly after completion, but prevent unbounded growth.
    setTimeout(() => {
      this.runs.delete(runId);
    }, 3_600_000);
    this.activeWorkflowCount--;
    metrics.set(Metrics.WORKFLOW_RUNS_ACTIVE, this.activeWorkflowCount);
  }

  private async publishEvent(type: string, payload: unknown): Promise<void> {
    const runId = payload && typeof payload === 'object' && 'runId' in payload 
      ? String(payload.runId) 
      : 'unknown';
      
    const event: DomainEvent = {
      eventId: generateId(),
      type,
      source: { kind: 'workflow', id: runId },
      timestamp: new Date(),
      payload,
      correlationId: runId,
    };
    
    metrics.inc(Metrics.EVENTS_PUBLISHED, { event_type: type });
    await this.eventBus.publish(event);
  }
}
