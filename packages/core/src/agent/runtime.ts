/**
 * Agent Runtime - 智能体运行时
 */
import type { 
  AgentDefinition, 
  AgentInstance, 
  AgentStatus,
  LLMAdapter,
  ConversationTurn,
  ToolCallRequest,
  ToolCallResult,
  IMemoryManager,
  DomainEvent,
} from '@thematrix/types';
import { EventTypes, type IEventBus } from '@thematrix/types';
import { Logger, generateAgentInstanceId, withRetry, timeout } from '@thematrix/utils';
import { generateId } from '@thematrix/utils';

const logger = new Logger({ prefix: 'AgentRuntime' });

export interface AgentRuntimeOptions {
  definition: AgentDefinition;
  workflowRunId: string;
  llmAdapter: LLMAdapter;
  memory: IMemoryManager;
  eventBus: IEventBus;
  tools?: Map<string, ToolHandler>;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export class AgentRuntime {
  public readonly instanceId: string;
  public readonly definition: AgentDefinition;
  public readonly workflowRunId: string;
  
  private status: AgentStatus = 'created';
  private llmAdapter: LLMAdapter;
  private memory: IMemoryManager;
  private eventBus: IEventBus;
  private tools: Map<string, ToolHandler>;
  private metrics = {
    startTime: undefined as Date | undefined,
    endTime: undefined as Date | undefined,
    totalTurns: 0,
    totalTokens: 0,
    errors: 0,
  };

  constructor(options: AgentRuntimeOptions) {
    this.instanceId = generateAgentInstanceId();
    this.definition = options.definition;
    this.workflowRunId = options.workflowRunId;
    this.llmAdapter = options.llmAdapter;
    this.memory = options.memory;
    this.eventBus = options.eventBus;
    this.tools = options.tools ?? new Map();
  }

  async initialize(): Promise<void> {
    this.status = 'initializing';
    await this.publishEvent(EventTypes.AGENT_INITIALIZED, {
      agentId: this.definition.id,
      instanceId: this.instanceId,
    });
    this.status = 'running';
    this.metrics.startTime = new Date();
    
    await this.publishEvent(EventTypes.AGENT_STARTED, {
      agentId: this.definition.id,
      instanceId: this.instanceId,
    });
    
    logger.info(`Agent ${this.definition.id} (${this.instanceId}) initialized`);
  }

  async runTurn(input: string): Promise<string> {
    if (this.status !== 'running') {
      throw new Error(`Agent is not running, current status: ${this.status}`);
    }

    this.metrics.totalTurns++;
    
    const turnId = generateId();
    await this.publishEvent(EventTypes.AGENT_TURN_STARTED, {
      agentId: this.definition.id,
      instanceId: this.instanceId,
      turnId,
    });

    try {
      // Add user message to history
      await this.memory.appendTurn(this.instanceId, {
        turnId: generateId(),
        role: 'user',
        content: input,
        timestamp: new Date(),
      });

      // Get conversation history
      const history = await this.memory.getHistory(this.instanceId);
      
      // Build messages for LLM
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: this.definition.persona.systemPrompt },
        ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      ];

      // Call LLM
      const response = await withRetry(
        () => timeout(
          this.llmAdapter.chat({
            model: this.definition.model.model,
            messages,
            temperature: this.definition.persona.temperature,
            maxTokens: this.definition.model.maxTokens,
          }),
          this.definition.turnTimeoutMs,
          'Agent turn timed out'
        ),
        {
          maxRetries: 2,
          retryDelayMs: 1000,
        }
      );

      this.metrics.totalTokens += response.usage.totalTokens;

      // Handle tool calls if any
      let finalContent = response.content;
      if (response.toolCalls && response.toolCalls.length > 0) {
        const toolResults = await this.executeToolCalls(response.toolCalls);
        
        // Store tool results
        for (const result of toolResults) {
          if (result.content.startsWith('Error:') || result.content.startsWith('Tool not found:')) {
            this.metrics.errors++;
          }
        }
      }

      // Add assistant response to history
      await this.memory.appendTurn(this.instanceId, {
        turnId: generateId(),
        role: 'assistant',
        content: finalContent,
        timestamp: new Date(),
      });

      await this.publishEvent(EventTypes.AGENT_TURN_COMPLETED, {
        agentId: this.definition.id,
        instanceId: this.instanceId,
        turnId,
        tokensUsed: response.usage.totalTokens,
      });

      return finalContent;
    } catch (error) {
      this.metrics.errors++;
      this.status = 'error';
      
      await this.publishEvent(EventTypes.AGENT_ERROR, {
        agentId: this.definition.id,
        instanceId: this.instanceId,
        turnId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      throw error;
    }
  }

  private async executeToolCalls(toolCalls: ToolCallRequest[]): Promise<ToolCallResult[]> {
    const results: ToolCallResult[] = [];
    
    for (const call of toolCalls) {
      const handler = this.tools.get(call.function.name);
      
      if (!handler) {
        results.push({
          toolCallId: call.id,
          content: `Tool not found: ${call.function.name}`,
        });
        continue;
      }

      try {
        const args = JSON.parse(call.function.arguments);
        const result = await handler(args);
        results.push({
          toolCallId: call.id,
          content: JSON.stringify(result),
        });
      } catch (error) {
        results.push({
          toolCallId: call.id,
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    
    return results;
  }

  async pause(): Promise<void> {
    if (this.status === 'running') {
      this.status = 'paused';
      await this.publishEvent(EventTypes.AGENT_PAUSED, {
        agentId: this.definition.id,
        instanceId: this.instanceId,
      });
      logger.info(`Agent ${this.definition.id} paused`);
    }
  }

  async resume(): Promise<void> {
    if (this.status === 'paused') {
      this.status = 'running';
      await this.publishEvent(EventTypes.AGENT_RESUMED, {
        agentId: this.definition.id,
        instanceId: this.instanceId,
      });
      logger.info(`Agent ${this.definition.id} resumed`);
    }
  }

  async stop(): Promise<void> {
    this.status = 'stopped';
    this.metrics.endTime = new Date();
    await this.publishEvent(EventTypes.AGENT_STOPPED, {
      agentId: this.definition.id,
      instanceId: this.instanceId,
      metrics: this.metrics,
    });
    logger.info(`Agent ${this.definition.id} stopped`);
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  getInstance(): AgentInstance {
    return {
      instanceId: this.instanceId,
      definitionId: this.definition.id,
      workflowRunId: this.workflowRunId,
      status: this.status,
      metrics: {
        startTime: this.metrics.startTime,
        endTime: this.metrics.endTime,
        totalTurns: this.metrics.totalTurns,
        totalTokens: this.metrics.totalTokens,
        errors: this.metrics.errors,
      },
    };
  }

  private async publishEvent(type: string, payload: unknown): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type,
      source: { kind: 'agent', id: this.instanceId },
      timestamp: new Date(),
      payload,
      correlationId: this.workflowRunId,
    };
    await this.eventBus.publish(event);
  }
}
