/**
 * Agent Reflector - evaluates output quality via LLM self-reflection
 */
import type {
  ReflectionResult,
  LLMAdapter,
  DomainEvent,
} from '@thematrix/types';
import { EventTypes, type IEventBus } from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';

const logger = new Logger({ prefix: 'AgentReflector' });

const REFLECTION_SYSTEM_PROMPT = `You are a reflection agent evaluating whether an output meets a stated goal.

Given:
- The original goal
- The agent's output
- Optionally, prior conversation history

Evaluate the output and respond ONLY with valid JSON in this exact format:
{
  "quality": "good" | "acceptable" | "poor",
  "issues": ["list of specific issues found, empty array if none"],
  "suggestion": "a concrete suggestion for improvement, or empty string if output is good",
  "shouldRetry": false,
  "shouldRevise": false
}

Guidelines:
- "good": output fully satisfies the goal with no significant issues
- "acceptable": output mostly satisfies the goal but has minor issues
- "poor": output fails to meet the goal or has critical issues
- Set shouldRetry=true only if quality is "poor" and retrying the same approach could help
- Set shouldRevise=true only if the plan/approach itself needs changing (for plan-and-execute mode)`;

export class AgentReflector {
  private llmAdapter: LLMAdapter;
  private eventBus: IEventBus;
  private model: string;
  private sourceId: string;
  private correlationId: string;

  constructor(options: {
    llmAdapter: LLMAdapter;
    eventBus: IEventBus;
    model: string;
    sourceId: string;
    correlationId: string;
  }) {
    this.llmAdapter = options.llmAdapter;
    this.eventBus = options.eventBus;
    this.model = options.model;
    this.sourceId = options.sourceId;
    this.correlationId = options.correlationId;
  }

  async reflect(
    goal: string,
    output: string,
    history: string[],
  ): Promise<ReflectionResult> {
    logger.info(`Reflecting on output for goal: ${goal}`);

    const historySection = history.length > 0
      ? `\nPrior conversation history (most recent entries):\n${history.slice(-10).join('\n')}`
      : '';

    const userContent = [
      `Goal: ${goal}`,
      '',
      `Agent output:`,
      output,
      historySection,
    ].join('\n');

    const response = await this.llmAdapter.chat({
      model: this.model,
      messages: [
        { role: 'system', content: REFLECTION_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      responseFormat: { type: 'json_object' },
      temperature: 0.1,
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      logger.error(`Failed to parse reflection JSON: ${response.content.slice(0, 200)}`);
      // Return a safe default rather than crashing
      return {
        quality: 'acceptable',
        issues: ['Failed to parse reflection output'],
        suggestion: '',
        shouldRetry: false,
        shouldRevise: false,
      };
    }

    const qualityValues = ['good', 'acceptable', 'poor'] as const;
    const rawQuality = String(parsed.quality ?? 'acceptable');
    const quality = qualityValues.includes(rawQuality as typeof qualityValues[number])
      ? (rawQuality as ReflectionResult['quality'])
      : 'acceptable';

    const result: ReflectionResult = {
      quality,
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      suggestion: String(parsed.suggestion ?? ''),
      shouldRetry: Boolean(parsed.shouldRetry),
      shouldRevise: Boolean(parsed.shouldRevise),
    };

    await this.publishEvent(EventTypes.AGENT_REFLECTION, {
      goal,
      quality: result.quality,
      issues: result.issues,
      shouldRetry: result.shouldRetry,
      shouldRevise: result.shouldRevise,
    });

    logger.info(`Reflection result: quality=${result.quality}, shouldRetry=${result.shouldRetry}, shouldRevise=${result.shouldRevise}`);

    return result;
  }

  private async publishEvent(type: string, payload: unknown): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type,
      source: { kind: 'agent', id: this.sourceId },
      timestamp: new Date(),
      payload,
      correlationId: this.correlationId,
    };
    await this.eventBus.publish(event);
  }
}
