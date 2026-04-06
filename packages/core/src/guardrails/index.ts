/**
 * GuardrailRunner - Input/output safety checks for agent interactions
 */
import type {
  GuardrailConfig,
  GuardrailResult,
  GuardrailViolation,
  LLMAdapter,
  DomainEvent,
} from '@thematrix/types';
import { EventTypes, type IEventBus } from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';
import { OutputValidator } from './validators.js';

export { OutputValidator } from './validators.js';

const logger = new Logger({ prefix: 'GuardrailRunner' });

/** Harmful/toxic content keyword blocklist */
const CONTENT_SAFETY_PATTERNS: RegExp[] = [
  /\b(kill|murder|assassinate)\s+(yourself|himself|herself|themselves|someone|people)\b/gi,
  /\b(how\s+to\s+(make|build|create)\s+(a\s+)?(bomb|explosive|weapon))\b/gi,
  /\b(self[- ]?harm|suicide\s+method)\b/gi,
  /\b(child\s+(porn|exploitation|abuse))\b/gi,
  /\b(hate\s+speech|racial\s+slur)\b/gi,
];

/** PII detection patterns */
const PII_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: 'phone', pattern: /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'credit-card', pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
];

/** Prompt injection patterns */
const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /ignore\s+(all\s+)?above\s+instructions/gi,
  /disregard\s+(all\s+)?previous/gi,
  /\bsystem\s*:/gi,
  /you\s+are\s+now\s+/gi,
  /\bact\s+as\s+(if|though)\s+/gi,
  /\bpretend\s+(you\s+are|to\s+be)\s+/gi,
  /\bdo\s+anything\s+now\b/gi,
  /\bjailbreak\b/gi,
  /\bDAN\s+mode\b/gi,
];

export interface GuardrailRunResult {
  passed: boolean;
  results: GuardrailResult[];
  rewrittenInput?: string;
}

export interface GuardrailOutputRunResult {
  passed: boolean;
  results: GuardrailResult[];
  rewrittenOutput?: string;
}

export class GuardrailRunner {
  private eventBus: IEventBus;
  private llmAdapter?: LLMAdapter;
  private outputValidator: OutputValidator;
  private correlationId: string;

  constructor(eventBus: IEventBus, llmAdapter?: LLMAdapter, correlationId?: string) {
    this.eventBus = eventBus;
    this.llmAdapter = llmAdapter;
    this.outputValidator = new OutputValidator();
    this.correlationId = correlationId ?? '';
  }

  /**
   * Run input guardrails on user input.
   * Filters guardrails to those with type 'input' or 'both'.
   */
  async runInputGuardrails(
    input: string,
    guardrails: GuardrailConfig[],
  ): Promise<GuardrailRunResult> {
    const applicable = guardrails.filter(g => g.type === 'input' || g.type === 'both');
    const results: GuardrailResult[] = [];
    let passed = true;
    let rewrittenInput: string | undefined;

    for (const guardrail of applicable) {
      const result = await this.evaluateGuardrail(guardrail, rewrittenInput ?? input);
      results.push(result);

      if (!result.passed) {
        await this.publishEvent(EventTypes.GUARDRAIL_TRIGGERED, {
          guardrailId: guardrail.id,
          guardrailName: guardrail.name,
          direction: 'input',
          violations: result.violations,
        });

        if (guardrail.action === 'block') {
          passed = false;
          await this.publishEvent(EventTypes.GUARDRAIL_BLOCKED, {
            guardrailId: guardrail.id,
            guardrailName: guardrail.name,
            direction: 'input',
            violations: result.violations,
          });
          break;
        }

        if (guardrail.action === 'warn') {
          logger.warn(
            `Guardrail "${guardrail.name}" triggered (warn): ${result.violations.map(v => v.message).join('; ')}`,
          );
        }

        if (guardrail.action === 'rewrite' && result.rewrittenContent) {
          rewrittenInput = result.rewrittenContent;
          await this.publishEvent(EventTypes.GUARDRAIL_REWRITTEN, {
            guardrailId: guardrail.id,
            guardrailName: guardrail.name,
            direction: 'input',
          });
        }
      }
    }

    return { passed, results, rewrittenInput };
  }

  /**
   * Run output guardrails on agent output.
   * Filters guardrails to those with type 'output' or 'both'.
   */
  async runOutputGuardrails(
    output: string,
    guardrails: GuardrailConfig[],
  ): Promise<GuardrailOutputRunResult> {
    const applicable = guardrails.filter(g => g.type === 'output' || g.type === 'both');
    const results: GuardrailResult[] = [];
    let passed = true;
    let rewrittenOutput: string | undefined;

    for (const guardrail of applicable) {
      const result = await this.evaluateGuardrail(guardrail, rewrittenOutput ?? output);
      results.push(result);

      if (!result.passed) {
        await this.publishEvent(EventTypes.GUARDRAIL_TRIGGERED, {
          guardrailId: guardrail.id,
          guardrailName: guardrail.name,
          direction: 'output',
          violations: result.violations,
        });

        if (guardrail.action === 'block') {
          passed = false;
          await this.publishEvent(EventTypes.GUARDRAIL_BLOCKED, {
            guardrailId: guardrail.id,
            guardrailName: guardrail.name,
            direction: 'output',
            violations: result.violations,
          });
          break;
        }

        if (guardrail.action === 'warn') {
          logger.warn(
            `Guardrail "${guardrail.name}" triggered (warn): ${result.violations.map(v => v.message).join('; ')}`,
          );
        }

        if (guardrail.action === 'rewrite' && result.rewrittenContent) {
          rewrittenOutput = result.rewrittenContent;
          await this.publishEvent(EventTypes.GUARDRAIL_REWRITTEN, {
            guardrailId: guardrail.id,
            guardrailName: guardrail.name,
            direction: 'output',
          });
        }
      }
    }

    return { passed, results, rewrittenOutput };
  }

  /**
   * Evaluate a single guardrail against the given content.
   */
  private async evaluateGuardrail(
    guardrail: GuardrailConfig,
    content: string,
  ): Promise<GuardrailResult> {
    // Built-in guardrails
    if (guardrail.builtin) {
      switch (guardrail.builtin) {
        case 'content-safety':
          return this.checkContentSafety(guardrail, content);
        case 'pii-detection':
          return this.checkPiiDetection(guardrail, content);
        case 'schema-validation':
          return this.checkSchemaValidation(guardrail, content);
        case 'prompt-injection':
          return this.checkPromptInjection(guardrail, content);
        default:
          logger.warn(`Unknown built-in guardrail type: ${guardrail.builtin}`);
          return {
            guardrailId: guardrail.id,
            passed: true,
            action: guardrail.action,
            violations: [],
          };
      }
    }

    // Custom LLM-based guardrail
    if (guardrail.prompt) {
      return this.checkCustomLlm(guardrail, content);
    }

    // No evaluation logic configured
    logger.warn(`Guardrail "${guardrail.name}" has no builtin or prompt configured, skipping`);
    return {
      guardrailId: guardrail.id,
      passed: true,
      action: guardrail.action,
      violations: [],
    };
  }

  // ----------------------------------------------------------------
  // Built-in guardrail implementations
  // ----------------------------------------------------------------

  /** Maximum input length for regex-based guardrails to prevent ReDoS on very long inputs */
  private static readonly MAX_REGEX_INPUT_LENGTH = 100_000;

  private checkContentSafety(
    guardrail: GuardrailConfig,
    content: string,
  ): GuardrailResult {
    const violations: GuardrailViolation[] = [];

    // Truncate extremely long inputs to prevent regex performance issues
    const safeContent = content.length > GuardrailRunner.MAX_REGEX_INPUT_LENGTH
      ? content.slice(0, GuardrailRunner.MAX_REGEX_INPUT_LENGTH)
      : content;

    for (const pattern of CONTENT_SAFETY_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(safeContent)) !== null) {
        violations.push({
          type: 'content-safety',
          severity: 'critical',
          message: `Harmful content detected: "${match[0]}"`,
          span: { start: match.index, end: match.index + match[0].length },
        });
      }
    }

    return {
      guardrailId: guardrail.id,
      passed: violations.length === 0,
      action: guardrail.action,
      violations,
    };
  }

  private checkPiiDetection(
    guardrail: GuardrailConfig,
    content: string,
  ): GuardrailResult {
    const violations: GuardrailViolation[] = [];

    // Truncate extremely long inputs to prevent regex performance issues
    const safeContent = content.length > GuardrailRunner.MAX_REGEX_INPUT_LENGTH
      ? content.slice(0, GuardrailRunner.MAX_REGEX_INPUT_LENGTH)
      : content;

    for (const { name, pattern } of PII_PATTERNS) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(safeContent)) !== null) {
        violations.push({
          type: 'pii-detection',
          severity: name === 'ssn' || name === 'credit-card' ? 'high' : 'medium',
          message: `PII detected (${name}): "${match[0]}"`,
          span: { start: match.index, end: match.index + match[0].length },
        });
      }
    }

    return {
      guardrailId: guardrail.id,
      passed: violations.length === 0,
      action: guardrail.action,
      violations,
    };
  }

  private checkSchemaValidation(
    guardrail: GuardrailConfig,
    content: string,
  ): GuardrailResult {
    const schema = guardrail.config?.['schema'] as Record<string, unknown> | undefined;
    if (!schema) {
      logger.warn(`schema-validation guardrail "${guardrail.name}" missing config.schema`);
      return {
        guardrailId: guardrail.id,
        passed: true,
        action: guardrail.action,
        violations: [],
      };
    }

    const { valid, errors } = this.outputValidator.validateStructuredOutput(content, schema);

    const violations: GuardrailViolation[] = errors.map(err => ({
      type: 'schema-validation',
      severity: 'high' as const,
      message: err,
    }));

    return {
      guardrailId: guardrail.id,
      passed: valid,
      action: guardrail.action,
      violations,
    };
  }

  private checkPromptInjection(
    guardrail: GuardrailConfig,
    content: string,
  ): GuardrailResult {
    const violations: GuardrailViolation[] = [];

    // Truncate extremely long inputs to prevent regex performance issues
    const safeContent = content.length > GuardrailRunner.MAX_REGEX_INPUT_LENGTH
      ? content.slice(0, GuardrailRunner.MAX_REGEX_INPUT_LENGTH)
      : content;

    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(safeContent)) !== null) {
        violations.push({
          type: 'prompt-injection',
          severity: 'critical',
          message: `Prompt injection pattern detected: "${match[0]}"`,
          span: { start: match.index, end: match.index + match[0].length },
        });
      }
    }

    return {
      guardrailId: guardrail.id,
      passed: violations.length === 0,
      action: guardrail.action,
      violations,
    };
  }

  // ----------------------------------------------------------------
  // Custom LLM-based guardrail
  // ----------------------------------------------------------------

  private async checkCustomLlm(
    guardrail: GuardrailConfig,
    content: string,
  ): Promise<GuardrailResult> {
    if (!this.llmAdapter) {
      logger.warn(
        `Custom guardrail "${guardrail.name}" requires an LLM adapter but none was provided; skipping`,
      );
      return {
        guardrailId: guardrail.id,
        passed: true,
        action: guardrail.action,
        violations: [],
      };
    }

    try {
      const response = await this.llmAdapter.chat({
        model: (guardrail.config?.['model'] as string) ?? 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a content safety evaluator. Evaluate the following content against the given guardrail rule. ' +
              'Respond ONLY with a JSON object: { "passed": boolean, "violations": [{ "message": string, "severity": "low"|"medium"|"high"|"critical" }] }',
          },
          {
            role: 'user',
            content: `Guardrail rule: ${guardrail.prompt}\n\nContent to evaluate:\n${content}`,
          },
        ],
        temperature: 0,
        maxTokens: 512,
      });

      let parsed: {
        passed: boolean;
        violations?: { message: string; severity: 'low' | 'medium' | 'high' | 'critical' }[];
      };
      try {
        parsed = JSON.parse(response.content);
      } catch {
        logger.warn(`Custom guardrail "${guardrail.name}" returned invalid JSON, failing closed`);
        return {
          guardrailId: guardrail.id,
          passed: false,
          action: guardrail.action,
          violations: [{
            type: 'custom',
            severity: 'high',
            message: `Guardrail "${guardrail.name}" returned unparseable response; blocked as a precaution`,
          }],
        };
      }

      if (typeof parsed.passed !== 'boolean') {
        logger.warn(`Custom guardrail "${guardrail.name}" response missing 'passed' field, failing closed`);
        return {
          guardrailId: guardrail.id,
          passed: false,
          action: guardrail.action,
          violations: [{
            type: 'custom',
            severity: 'high',
            message: `Guardrail "${guardrail.name}" returned invalid response (missing 'passed'); blocked as a precaution`,
          }],
        };
      }

      const violations: GuardrailViolation[] = (parsed.violations ?? []).map(v => ({
        type: 'custom',
        severity: v.severity,
        message: v.message,
      }));

      let rewrittenContent: string | undefined;

      // If action is rewrite and there are violations, ask LLM to rewrite
      if (guardrail.action === 'rewrite' && !parsed.passed) {
        rewrittenContent = await this.rewriteContent(content, guardrail, violations);
        // Validate rewritten content against the same guardrail to prevent bypass
        if (rewrittenContent) {
          try {
            const revalidation = await this.checkCustomLlm(guardrail, rewrittenContent);
            if (!revalidation.passed) {
              logger.warn(`Rewritten content still fails guardrail "${guardrail.name}", discarding rewrite`);
              rewrittenContent = undefined;
            }
          } catch (revalErr) {
            logger.warn(`Failed to validate rewritten content for guardrail "${guardrail.name}", discarding rewrite`);
            rewrittenContent = undefined;
          }
        }
      }

      return {
        guardrailId: guardrail.id,
        passed: parsed.passed,
        action: guardrail.action,
        violations,
        rewrittenContent,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Custom guardrail "${guardrail.name}" evaluation failed: ${message}`);
      // Fail closed on evaluation errors — blocking is safer than allowing unchecked content
      return {
        guardrailId: guardrail.id,
        passed: false,
        action: guardrail.action,
        violations: [{
          type: 'custom',
          severity: 'high',
          message: `Guardrail "${guardrail.name}" evaluation failed (${message}); blocked as a precaution`,
        }],
      };
    }
  }

  /**
   * Use LLM to rewrite content to remove violations.
   */
  private async rewriteContent(
    content: string,
    guardrail: GuardrailConfig,
    violations: GuardrailViolation[],
  ): Promise<string | undefined> {
    if (!this.llmAdapter) return undefined;

    try {
      const violationDescriptions = violations.map(v => `- ${v.message}`).join('\n');
      const response = await this.llmAdapter.chat({
        model: (guardrail.config?.['model'] as string) ?? 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a content rewriter. Rewrite the following content to remove the identified violations ' +
              'while preserving the original meaning as much as possible. Return ONLY the rewritten content, nothing else.',
          },
          {
            role: 'user',
            content: `Violations found:\n${violationDescriptions}\n\nOriginal content:\n${content}`,
          },
        ],
        temperature: 0,
        maxTokens: 2048,
      });

      return response.content;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Content rewrite failed for guardrail "${guardrail.name}": ${message}`);
      return undefined;
    }
  }

  // ----------------------------------------------------------------
  // Event publishing
  // ----------------------------------------------------------------

  private async publishEvent(type: string, payload: unknown): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type,
      source: { kind: 'system', id: 'guardrail-runner' },
      timestamp: new Date(),
      payload,
      correlationId: this.correlationId,
    };
    await this.eventBus.publish(event).catch(err => {
      logger.error('Failed to publish guardrail event:', err);
    });
  }
}
