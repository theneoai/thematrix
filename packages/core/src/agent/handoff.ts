/**
 * Handoff Manager - Dynamic agent-to-agent delegation at runtime
 */
import type {
  IEventBus,
  IMessageBroker,
  DomainEvent,
  AgentDefinition,
  HandoffRequest,
  HandoffResult,
  IMemoryManager,
  LLMAdapter,
  ITelemetryProvider,
  ICognitiveMemoryManager,
} from '@thematrix/types';
import { EventTypes } from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';
import { AgentRuntime } from './runtime.js';
import type { ToolHandler } from './runtime.js';
import { AgentRegistry } from './registry.js';

const logger = new Logger({ prefix: 'HandoffManager' });

export interface HandoffManagerOptions {
  agentRegistry: AgentRegistry;
  eventBus: IEventBus;
  messageBroker: IMessageBroker;
  memory: IMemoryManager;
  llmAdapterFactory: (config: { provider: string; model: string }) => LLMAdapter;
  telemetry?: ITelemetryProvider;
  cognitiveMemory?: ICognitiveMemoryManager;
}

export class HandoffManager {
  private agentRegistry: AgentRegistry;
  private eventBus: IEventBus;
  private messageBroker: IMessageBroker;
  private memory: IMemoryManager;
  private llmAdapterFactory: (config: { provider: string; model: string }) => LLMAdapter;
  private telemetry?: ITelemetryProvider;
  private cognitiveMemory?: ICognitiveMemoryManager;
  /**
   * Tracks handoff counts per workflow run.
   * Entries are cleaned up via cleanupWorkflow() when the workflow completes/fails.
   */
  private handoffCount = new Map<string, number>();

  constructor(options: HandoffManagerOptions) {
    this.agentRegistry = options.agentRegistry;
    this.eventBus = options.eventBus;
    this.messageBroker = options.messageBroker;
    this.memory = options.memory;
    this.llmAdapterFactory = options.llmAdapterFactory;
    this.telemetry = options.telemetry;
    this.cognitiveMemory = options.cognitiveMemory;
  }

  /**
   * Register a "handoff" tool on the given agent runtime so that when the agent
   * calls the tool it delegates execution to another agent.
   */
  registerHandoffTool(
    agentRuntime: AgentRuntime,
    allowedTargets: string[],
  ): void {
    const handler: ToolHandler = async (args: Record<string, unknown>) => {
      const toAgentId = typeof args.toAgentId === 'string' ? args.toAgentId : '';
      const reason = typeof args.reason === 'string' ? args.reason : '';
      const context = typeof args.context === 'string' ? args.context : '';

      if (!toAgentId) {
        return {
          accepted: false,
          error: 'Missing required argument: toAgentId (string)',
        } satisfies HandoffResult;
      }
      const workflowRunId = agentRuntime.workflowRunId;
      const fromAgentId = agentRuntime.definition.id;

      // Validate target
      if (!allowedTargets.includes(toAgentId)) {
        const result: HandoffResult = {
          accepted: false,
          error: `Agent "${toAgentId}" is not in the allowed handoff targets: [${allowedTargets.join(', ')}]`,
        };
        logger.warn(`Handoff rejected: ${fromAgentId} -> ${toAgentId} (not allowed)`);
        return result;
      }

      const targetDef = this.agentRegistry.get(toAgentId);
      if (!targetDef) {
        const result: HandoffResult = {
          accepted: false,
          error: `Agent "${toAgentId}" not found in registry`,
        };
        logger.warn(`Handoff rejected: ${fromAgentId} -> ${toAgentId} (not found)`);
        return result;
      }

      // Publish HANDOFF_REQUESTED event
      const request: HandoffRequest = {
        fromAgentId,
        toAgentId,
        reason,
        context: { input: context },
      };

      await this.publishEvent(EventTypes.AGENT_HANDOFF_REQUESTED, {
        workflowRunId,
        ...request,
      }, workflowRunId);

      logger.info(`Handoff requested: ${fromAgentId} -> ${toAgentId} (reason: ${reason})`);

      try {
        // Create a new runtime for the target agent
        const targetRuntime = await this.createAgentRuntime(targetDef, workflowRunId);

        try {
          // Run the target agent with the provided context
          const output = await targetRuntime.runTurn(context);

          // Track handoff count
          const currentCount = this.handoffCount.get(workflowRunId) ?? 0;
          this.handoffCount.set(workflowRunId, currentCount + 1);

          // Publish HANDOFF_ACCEPTED event
          await this.publishEvent(EventTypes.AGENT_HANDOFF_ACCEPTED, {
            workflowRunId,
            fromAgentId,
            toAgentId,
            reason,
          }, workflowRunId);

          logger.info(`Handoff completed: ${fromAgentId} -> ${toAgentId}`);

          const result: HandoffResult = {
            accepted: true,
            output,
          };
          return result;
        } finally {
          await targetRuntime.stop();
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        await this.publishEvent(EventTypes.AGENT_HANDOFF_REJECTED, {
          workflowRunId,
          fromAgentId,
          toAgentId,
          reason,
          error: errorMessage,
        }, workflowRunId);

        logger.error(`Handoff failed: ${fromAgentId} -> ${toAgentId}:`, error);

        const result: HandoffResult = {
          accepted: false,
          error: errorMessage,
        };
        return result;
      }
    };

    agentRuntime.getTools().set('handoff', handler);

    logger.info(
      `Registered handoff tool on agent ${agentRuntime.definition.id} ` +
      `with targets: [${allowedTargets.join(', ')}]`,
    );
  }

  /**
   * Get the number of handoffs that have occurred for a given workflow run.
   */
  getHandoffCount(workflowRunId: string): number {
    return this.handoffCount.get(workflowRunId) ?? 0;
  }

  /**
   * Reset the handoff counter for a workflow run (used during cleanup).
   */
  resetHandoffCount(workflowRunId: string): void {
    this.handoffCount.delete(workflowRunId);
  }

  /**
   * Release all resources associated with a completed or failed workflow run.
   * Must be called by the workflow engine after a run reaches a terminal state
   * (completed, failed, cancelled) to prevent unbounded Map growth.
   */
  cleanupWorkflow(workflowRunId: string): void {
    this.handoffCount.delete(workflowRunId);
    logger.debug(`Handoff state cleaned up for workflow ${workflowRunId}`);
  }

  /**
   * Return number of tracked workflow runs (useful for monitoring/leak detection).
   */
  getTrackedWorkflowCount(): number {
    return this.handoffCount.size;
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

  private async publishEvent(type: string, payload: unknown, correlationId: string): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type,
      source: { kind: 'workflow', id: correlationId },
      timestamp: new Date(),
      payload,
      correlationId,
    };
    await this.eventBus.publish(event);
  }
}
