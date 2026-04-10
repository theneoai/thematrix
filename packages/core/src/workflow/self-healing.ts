/**
 * Self-Healing Workflow Strategy
 *
 * When a workflow node fails, instead of just retrying with the same config,
 * uses an Evaluator Agent to analyze the failure and suggest adjustments
 * (prompt modification, temperature change, model switch) before retrying.
 */
import type {
  AgentDefinition,
  IEventBus,
  IMemoryManager,
  LLMAdapter,
  DomainEvent,
  ICognitiveMemoryManager,
} from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';
import { AgentRuntime } from '../agent/runtime.js';

const logger = new Logger({ prefix: 'SelfHealing' });

export interface HealingStrategy {
  /** Whether to retry with modifications */
  shouldRetry: boolean;
  /** Modified system prompt (if any) */
  modifiedPrompt?: string;
  /** Modified temperature (if any) */
  modifiedTemperature?: number;
  /** Suggested alternative model (if any) */
  alternativeModel?: string;
  /** Explanation of the diagnosis */
  diagnosis: string;
  /** Confidence in the healing strategy (0-1) */
  confidence: number;
}

export interface SelfHealingOptions {
  eventBus: IEventBus;
  memory: IMemoryManager;
  llmAdapterFactory: (config: { provider: string; model: string }) => LLMAdapter;
  cognitiveMemory?: ICognitiveMemoryManager;
  /** The model to use for the healing agent (defaults to the failed agent's model) */
  healingModel?: { provider: string; model: string };
}

export class SelfHealingStrategy {
  private eventBus: IEventBus;
  private memory: IMemoryManager;
  private llmAdapterFactory: (config: { provider: string; model: string }) => LLMAdapter;
  private cognitiveMemory?: ICognitiveMemoryManager;
  private healingModel?: { provider: string; model: string };

  constructor(options: SelfHealingOptions) {
    this.eventBus = options.eventBus;
    this.memory = options.memory;
    this.llmAdapterFactory = options.llmAdapterFactory;
    this.cognitiveMemory = options.cognitiveMemory;
    this.healingModel = options.healingModel;
  }

  /**
   * Analyze a failed agent execution and produce a healing strategy.
   */
  async diagnose(
    failedAgent: AgentDefinition,
    input: string,
    error: Error,
    workflowRunId: string,
  ): Promise<HealingStrategy> {
    logger.info(`Diagnosing failure for agent ${failedAgent.id}: ${error.message}`);

    const modelConfig = this.healingModel ?? {
      provider: failedAgent.model.provider,
      model: failedAgent.model.model,
    };

    const llmAdapter = this.llmAdapterFactory(modelConfig);

    const healingPrompt = [
      'You are an AI system diagnostician. Analyze why an agent failed and suggest fixes.',
      '',
      `Failed Agent: ${failedAgent.id} (${failedAgent.name})`,
      `Agent Role: ${failedAgent.persona.role}`,
      `System Prompt (first 500 chars): ${failedAgent.persona.systemPrompt.slice(0, 500)}`,
      `Temperature: ${failedAgent.persona.temperature ?? 'default'}`,
      `Model: ${failedAgent.model.provider}/${failedAgent.model.model}`,
      '',
      `Input (first 500 chars): ${input.slice(0, 500)}`,
      `Error: ${error.message}`,
      '',
      'Respond ONLY with valid JSON:',
      '{',
      '  "shouldRetry": boolean,',
      '  "modifiedPrompt": "improved system prompt or null",',
      '  "modifiedTemperature": number or null,',
      '  "alternativeModel": "model-name or null",',
      '  "diagnosis": "what went wrong and why",',
      '  "confidence": number (0-1)',
      '}',
    ].join('\n');

    try {
      const response = await llmAdapter.chat({
        model: modelConfig.model,
        messages: [
          { role: 'system', content: 'You are a diagnostic agent. Always respond with valid JSON.' },
          { role: 'user', content: healingPrompt },
        ],
        temperature: 0,
        maxTokens: 1024,
      });

      const strategy = JSON.parse(response.content) as HealingStrategy;

      // Record diagnosis in cognitive memory for future learning
      if (this.cognitiveMemory) {
        try {
          await this.cognitiveMemory.recordEpisode({
            agentId: 'self-healing',
            eventType: 'error-recovery',
            summary: `Diagnosed failure for ${failedAgent.id}: ${strategy.diagnosis.slice(0, 200)}`,
            context: {
              input: `agent=${failedAgent.id}, error=${error.message}`,
              output: strategy.shouldRetry ? 'retry-with-modifications' : 'abort',
              agentsInvolved: [failedAgent.id],
            },
            outcome: 'success',
            importance: 0.7,
          });
        } catch {
          // Non-critical
        }
      }

      await this.publishEvent(workflowRunId, 'workflow.self_healing.diagnosis', {
        agentId: failedAgent.id,
        diagnosis: strategy.diagnosis,
        shouldRetry: strategy.shouldRetry,
        confidence: strategy.confidence,
      });

      logger.info(`Diagnosis for ${failedAgent.id}: shouldRetry=${strategy.shouldRetry}, confidence=${strategy.confidence}`);
      return strategy;
    } catch (diagErr) {
      logger.error(`Self-healing diagnosis failed: ${diagErr instanceof Error ? diagErr.message : String(diagErr)}`);
      return {
        shouldRetry: false,
        diagnosis: `Diagnosis failed: ${diagErr instanceof Error ? diagErr.message : String(diagErr)}`,
        confidence: 0,
      };
    }
  }

  /**
   * Apply a healing strategy to create a modified agent definition.
   */
  applyStrategy(original: AgentDefinition, strategy: HealingStrategy): AgentDefinition {
    const modified = { ...original, persona: { ...original.persona }, model: { ...original.model } };

    if (strategy.modifiedPrompt) {
      modified.persona.systemPrompt = strategy.modifiedPrompt;
    }
    if (strategy.modifiedTemperature !== undefined && strategy.modifiedTemperature !== null) {
      modified.persona.temperature = strategy.modifiedTemperature;
    }
    if (strategy.alternativeModel) {
      modified.model.model = strategy.alternativeModel;
    }

    return modified;
  }

  private async publishEvent(correlationId: string, type: string, payload: unknown): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type,
      source: { kind: 'system', id: 'self-healing' },
      timestamp: new Date(),
      payload,
      correlationId,
    };
    await this.eventBus.publish(event);
  }
}
