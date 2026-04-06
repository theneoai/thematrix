/**
 * Dynamic Workflow Executor - Orchestrator-driven workflow execution
 *
 * Instead of following a static DAG or state machine, a dynamic workflow
 * delegates routing decisions to an orchestrator agent that uses a "handoff"
 * tool to invoke specialist agents at runtime.
 */
import type {
  WorkflowDefinition,
  WorkflowRun,
  IEventBus,
  IMemoryManager,
  IMessageBroker,
  LLMAdapter,
  AgentDefinition,
  DomainEvent,
  ITelemetryProvider,
  ICognitiveMemoryManager,
} from '@thematrix/types';
import { EventTypes } from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';
import { AgentRuntime } from '../agent/runtime.js';
import { AgentRegistry } from '../agent/registry.js';
import { HandoffManager } from '../agent/handoff.js';
import { WorkflowError, ResourceNotFoundError } from '../error/index.js';

const logger = new Logger({ prefix: 'DynamicWorkflowExecutor' });

export interface DynamicWorkflowExecutorOptions {
  eventBus: IEventBus;
  memory: IMemoryManager;
  agentRegistry: AgentRegistry;
  llmAdapterFactory: (config: { provider: string; model: string }) => LLMAdapter;
  messageBroker: IMessageBroker;
  telemetry?: ITelemetryProvider;
  cognitiveMemory?: ICognitiveMemoryManager;
}

export class DynamicWorkflowExecutor {
  private eventBus: IEventBus;
  private memory: IMemoryManager;
  private agentRegistry: AgentRegistry;
  private llmAdapterFactory: (config: { provider: string; model: string }) => LLMAdapter;
  private messageBroker: IMessageBroker;
  private telemetry?: ITelemetryProvider;
  private cognitiveMemory?: ICognitiveMemoryManager;

  constructor(options: DynamicWorkflowExecutorOptions) {
    this.eventBus = options.eventBus;
    this.memory = options.memory;
    this.agentRegistry = options.agentRegistry;
    this.llmAdapterFactory = options.llmAdapterFactory;
    this.messageBroker = options.messageBroker;
    this.telemetry = options.telemetry;
    this.cognitiveMemory = options.cognitiveMemory;
  }

  async execute(definition: WorkflowDefinition, run: WorkflowRun): Promise<void> {
    const dynamicConfig = definition.dynamicConfig;
    if (!dynamicConfig) {
      throw new WorkflowError(
        'dynamicConfig is required for dynamic execution mode',
        definition.id,
        run.runId,
      );
    }

    const { orchestratorAgentId, availableAgents, maxHandoffs = 50 } = dynamicConfig;

    // Resolve the orchestrator agent definition
    const orchestratorDef = this.agentRegistry.get(orchestratorAgentId);
    if (!orchestratorDef) {
      throw new ResourceNotFoundError(
        `Orchestrator agent not found: ${orchestratorAgentId}`,
        'agent',
        orchestratorAgentId,
      );
    }

    // Validate that all available agents exist in the registry
    for (const agentId of availableAgents) {
      if (!this.agentRegistry.has(agentId)) {
        logger.warn(`Available agent "${agentId}" not found in registry — it will be unavailable for handoff`);
      }
    }

    // Create the HandoffManager
    const handoffManager = new HandoffManager({
      agentRegistry: this.agentRegistry,
      eventBus: this.eventBus,
      messageBroker: this.messageBroker,
      memory: this.memory,
      llmAdapterFactory: this.llmAdapterFactory,
    });

    // Create orchestrator runtime
    const orchestratorRuntime = await this.createAgentRuntime(orchestratorDef, run.runId);

    // Register handoff tool on the orchestrator with the list of available agents
    handoffManager.registerHandoffTool(orchestratorRuntime, availableAgents);

    await this.publishEvent(EventTypes.WORKFLOW_NODE_STARTED, {
      workflowId: definition.id,
      runId: run.runId,
      nodeId: 'orchestrator',
      agentId: orchestratorAgentId,
    });

    try {
      // Build input prompt for the orchestrator
      const inputPrompt = this.buildOrchestratorInput(run, availableAgents);

      // Run the orchestrator — the agentic tool-use loop in AgentRuntime will
      // keep calling the handoff tool until the orchestrator decides it is done
      // and produces a final text response without tool calls.
      const output = await orchestratorRuntime.runTurn(inputPrompt);

      // Check handoff count against limit
      const handoffCount = handoffManager.getHandoffCount(run.runId);
      if (handoffCount > maxHandoffs) {
        logger.warn(
          `Dynamic workflow ${definition.id} (run: ${run.runId}) exceeded maxHandoffs ` +
          `(${handoffCount}/${maxHandoffs}) — output may be incomplete`,
        );
      }

      // Store the orchestrator output
      run.context.nodeOutputs['orchestrator'] = { result: output };

      await this.publishEvent(EventTypes.WORKFLOW_NODE_COMPLETED, {
        workflowId: definition.id,
        runId: run.runId,
        nodeId: 'orchestrator',
        output: { result: output },
        handoffCount,
      });

      logger.info(
        `Dynamic workflow ${definition.id} (run: ${run.runId}) completed ` +
        `with ${handoffCount} handoff(s)`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.publishEvent(EventTypes.WORKFLOW_NODE_FAILED, {
        workflowId: definition.id,
        runId: run.runId,
        nodeId: 'orchestrator',
        error: errorMessage,
      });

      throw error;
    } finally {
      handoffManager.resetHandoffCount(run.runId);
      await orchestratorRuntime.stop();
    }
  }

  private buildOrchestratorInput(
    run: WorkflowRun,
    availableAgents: string[],
  ): string {
    const parts: string[] = [
      'You are the orchestrator for a dynamic workflow.',
      `Available specialist agents you can delegate to via the handoff tool: [${availableAgents.join(', ')}].`,
      'Use the handoff tool to delegate tasks to specialist agents as needed.',
      'When you have gathered all necessary results, produce a final answer.',
      '',
      'Workflow input:',
      JSON.stringify(run.input, null, 2),
    ];
    return parts.join('\n');
  }

  private async createAgentRuntime(
    definition: AgentDefinition,
    workflowRunId: string,
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
      telemetry: this.telemetry,
      cognitiveMemory: this.cognitiveMemory,
    });

    await runtime.initialize();
    return runtime;
  }

  private async publishEvent(type: string, payload: unknown): Promise<void> {
    const runId = payload && typeof payload === 'object' && 'runId' in payload
      ? String((payload as Record<string, unknown>).runId)
      : 'unknown';

    const event: DomainEvent = {
      eventId: generateId(),
      type,
      source: { kind: 'workflow', id: runId },
      timestamp: new Date(),
      payload,
      correlationId: runId,
    };
    await this.eventBus.publish(event);
  }
}
