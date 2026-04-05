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
  GuardrailConfig,
  ResponseFormat,
} from '@thematrix/types';
import { EventTypes, type IEventBus } from '@thematrix/types';
import { Logger, generateAgentInstanceId, withRetry, timeout } from '@thematrix/utils';
import { generateId } from '@thematrix/utils';
import { GuardrailRunner, OutputValidator } from '../guardrails/index.js';

const logger = new Logger({ prefix: 'AgentRuntime' });

export interface AgentRuntimeOptions {
  definition: AgentDefinition;
  workflowRunId: string;
  llmAdapter: LLMAdapter;
  memory: IMemoryManager;
  eventBus: IEventBus;
  tools?: Map<string, ToolHandler>;
  /** Guardrail configurations (overrides definition.guardrails if provided) */
  guardrails?: GuardrailConfig[];
  /** Output schema for structured output validation (overrides definition.outputSchema if provided) */
  outputSchema?: Record<string, unknown>;
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
  private guardrailRunner: GuardrailRunner;
  private outputValidator: OutputValidator;
  private guardrails: GuardrailConfig[];
  private outputSchema?: Record<string, unknown>;
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
    this.guardrails = options.guardrails ?? options.definition.guardrails ?? [];
    this.outputSchema = options.outputSchema ?? options.definition.outputSchema;
    this.guardrailRunner = new GuardrailRunner(options.eventBus, options.llmAdapter, options.workflowRunId);
    this.outputValidator = new OutputValidator();
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
      // ── Input guardrails ──────────────────────────────────────
      let effectiveInput = input;
      if (this.guardrails.length > 0) {
        const inputResult = await this.guardrailRunner.runInputGuardrails(input, this.guardrails);
        if (!inputResult.passed) {
          throw new Error(
            `Input blocked by guardrail: ${inputResult.results
              .filter(r => !r.passed)
              .flatMap(r => r.violations.map(v => v.message))
              .join('; ')}`,
          );
        }
        if (inputResult.rewrittenInput) {
          effectiveInput = inputResult.rewrittenInput;
          logger.info('Input was rewritten by guardrails');
        }
      }

      // Add user message to history (reuse event turnId for correlation)
      await this.memory.appendTurn(this.instanceId, {
        turnId,
        role: 'user',
        content: effectiveInput,
        timestamp: new Date(),
      });

      // Get conversation history
      const history = await this.memory.getHistory(this.instanceId);

      // Build messages for LLM — preserve toolCalls/toolResults so adapters can format them correctly
      const messages = [
        { role: 'system' as const, content: this.definition.persona.systemPrompt },
        ...history.map(h => ({
          role: h.role as 'user' | 'assistant' | 'tool',
          content: h.content,
          toolCalls: h.toolCalls,
          toolResults: h.toolResults,
        })),
      ];

      // ── Build response format for structured output ───────────
      let responseFormat: ResponseFormat | undefined;
      if (this.outputSchema) {
        responseFormat = {
          type: 'json_schema',
          schema: {
            name: 'structured_output',
            description: 'Agent structured output',
            schema: this.outputSchema,
            strict: true,
          },
        };
      }

      // Call LLM
      const response = await withRetry(
        () => timeout(
          this.llmAdapter.chat({
            model: this.definition.model.model,
            messages,
            temperature: this.definition.persona.temperature,
            maxTokens: this.definition.model.maxTokens,
            responseFormat,
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

      // Agentic tool-use loop: execute tool calls and feed results back to LLM
      let finalContent = response.content;
      let currentResponse = response;
      let toolCallIterations = 0;
      const maxToolCallIterations = 20;

      while (currentResponse.toolCalls && currentResponse.toolCalls.length > 0) {
        toolCallIterations++;
        if (toolCallIterations > maxToolCallIterations) {
          logger.error(`Max tool call iterations (${maxToolCallIterations}) exceeded, terminating loop`);
          break;
        }
        const toolResults = await this.executeToolCalls(currentResponse.toolCalls);

        for (const result of toolResults) {
          if (result.content.startsWith('Error:') || result.content.startsWith('Tool not found:')) {
            this.metrics.errors++;
          }
        }

        // Append assistant message with tool calls to history
        await this.memory.appendTurn(this.instanceId, {
          turnId: generateId(),
          role: 'assistant',
          content: currentResponse.content,
          toolCalls: currentResponse.toolCalls,
          timestamp: new Date(),
        });

        // Append tool results as a tool turn
        await this.memory.appendTurn(this.instanceId, {
          turnId: generateId(),
          role: 'tool',
          content: JSON.stringify(toolResults),
          toolResults,
          timestamp: new Date(),
        });

        // Re-fetch history and call LLM again with tool results
        const updatedHistory = await this.memory.getHistory(this.instanceId);
        const updatedMessages = [
          { role: 'system' as const, content: this.definition.persona.systemPrompt },
          ...updatedHistory.map(h => ({
            role: h.role as 'user' | 'assistant' | 'tool',
            content: h.content,
            toolCalls: h.toolCalls,
            toolResults: h.toolResults,
          })),
        ];

        currentResponse = await withRetry(
          () => timeout(
            this.llmAdapter.chat({
              model: this.definition.model.model,
              messages: updatedMessages,
              temperature: this.definition.persona.temperature,
              maxTokens: this.definition.model.maxTokens,
              responseFormat,
            }),
            this.definition.turnTimeoutMs,
            'Agent turn timed out'
          ),
          { maxRetries: 2, retryDelayMs: 1000 }
        );

        this.metrics.totalTokens += currentResponse.usage.totalTokens;
        finalContent = currentResponse.content;
      }

      // ── Structured output validation with retry ───────────────
      if (this.outputSchema) {
        const validation = this.outputValidator.validateStructuredOutput(finalContent, this.outputSchema);
        if (!validation.valid) {
          logger.warn(`Structured output validation failed, retrying: ${validation.errors.join('; ')}`);

          // Append the invalid response and a corrective user message
          await this.memory.appendTurn(this.instanceId, {
            turnId: generateId(),
            role: 'assistant',
            content: finalContent,
            timestamp: new Date(),
          });
          await this.memory.appendTurn(this.instanceId, {
            turnId: generateId(),
            role: 'user',
            content:
              `Your previous response did not match the required JSON schema. Validation errors:\n${validation.errors.join('\n')}\n\nPlease fix your response to match the schema and return ONLY valid JSON.`,
            timestamp: new Date(),
          });

          const retryHistory = await this.memory.getHistory(this.instanceId);
          const retryMessages = [
            { role: 'system' as const, content: this.definition.persona.systemPrompt },
            ...retryHistory.map(h => ({
              role: h.role as 'user' | 'assistant' | 'tool',
              content: h.content,
              toolCalls: h.toolCalls,
              toolResults: h.toolResults,
            })),
          ];

          const retryResponse = await withRetry(
            () => timeout(
              this.llmAdapter.chat({
                model: this.definition.model.model,
                messages: retryMessages,
                temperature: this.definition.persona.temperature,
                maxTokens: this.definition.model.maxTokens,
                responseFormat,
              }),
              this.definition.turnTimeoutMs,
              'Agent turn timed out'
            ),
            { maxRetries: 2, retryDelayMs: 1000 }
          );

          this.metrics.totalTokens += retryResponse.usage.totalTokens;
          finalContent = retryResponse.content;

          // Log if retry also failed validation (best-effort: return whatever we got)
          const retryValidation = this.outputValidator.validateStructuredOutput(retryResponse.content, this.outputSchema!);
          if (!retryValidation.valid) {
            logger.warn(`Structured output retry also failed validation: ${retryValidation.errors.join('; ')}`);
          }
        }
      }

      // ── Output guardrails ─────────────────────────────────────
      if (this.guardrails.length > 0) {
        const outputResult = await this.guardrailRunner.runOutputGuardrails(finalContent, this.guardrails);
        if (!outputResult.passed) {
          throw new Error(
            `Output blocked by guardrail: ${outputResult.results
              .filter(r => !r.passed)
              .flatMap(r => r.violations.map(v => v.message))
              .join('; ')}`,
          );
        }
        if (outputResult.rewrittenOutput) {
          finalContent = outputResult.rewrittenOutput;
          logger.info('Output was rewritten by guardrails');
        }
      }

      // Add final assistant response to history
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
        if (typeof args !== 'object' || args === null || Array.isArray(args)) {
          results.push({
            toolCallId: call.id,
            content: `Error: Tool arguments must be a JSON object, got ${Array.isArray(args) ? 'array' : typeof args}`,
          });
          continue;
        }
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

  /** Reset from error state to running, allowing retries */
  resetFromError(): void {
    if (this.status === 'error') {
      this.status = 'running';
      logger.info(`Agent ${this.definition.id} (${this.instanceId}) reset from error state`);
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
    if (this.status === 'stopped') return; // idempotent
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

  /** Expose eventBus for privileged wrappers (AgentLoop, HandoffManager) */
  getEventBus(): IEventBus {
    return this.eventBus;
  }

  /** Expose LLM adapter for privileged wrappers (AgentPlanner, AgentReflector) */
  getLLMAdapter(): LLMAdapter {
    return this.llmAdapter;
  }

  /** Expose memory manager for privileged wrappers */
  getMemory(): IMemoryManager {
    return this.memory;
  }

  /** Expose tools map for privileged wrappers (HandoffManager) */
  getTools(): Map<string, ToolHandler> {
    return this.tools;
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
