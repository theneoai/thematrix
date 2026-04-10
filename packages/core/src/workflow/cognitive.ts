/**
 * Cognitive Workflow Executor — Plan-Generate-Evaluate pattern
 *
 * Implements the Anthropic multi-agent harness design:
 * 1. Planner decomposes the goal into steps
 * 2. Generators produce outputs for each step
 * 3. Evaluator assesses quality against criteria
 * 4. Loop until quality threshold is met or max iterations exhausted
 */
import type {
  WorkflowDefinition,
  WorkflowRun,
  CognitiveWorkflowConfig,
  IEventBus,
  IMemoryManager,
  LLMAdapter,
  DomainEvent,
  ITelemetryProvider,
  ICognitiveMemoryManager,
} from '@thematrix/types';
import { EventTypes } from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';
import { AgentRuntime } from '../agent/runtime.js';
import { AgentRegistry } from '../agent/registry.js';
import { WorkflowError } from '../error/index.js';

const logger = new Logger({ prefix: 'CognitiveWorkflow' });

export interface CognitiveWorkflowOptions {
  eventBus: IEventBus;
  memory: IMemoryManager;
  agentRegistry: AgentRegistry;
  llmAdapterFactory: (config: { provider: string; model: string }) => LLMAdapter;
  telemetry?: ITelemetryProvider;
  cognitiveMemory?: ICognitiveMemoryManager;
}

interface EvaluationResult {
  passed: boolean;
  score: number;
  feedback: string;
  improvements: string[];
}

export class CognitiveWorkflowExecutor {
  private eventBus: IEventBus;
  private memory: IMemoryManager;
  private agentRegistry: AgentRegistry;
  private llmAdapterFactory: (config: { provider: string; model: string }) => LLMAdapter;
  private telemetry?: ITelemetryProvider;
  private cognitiveMemory?: ICognitiveMemoryManager;

  constructor(options: CognitiveWorkflowOptions) {
    this.eventBus = options.eventBus;
    this.memory = options.memory;
    this.agentRegistry = options.agentRegistry;
    this.llmAdapterFactory = options.llmAdapterFactory;
    this.telemetry = options.telemetry;
    this.cognitiveMemory = options.cognitiveMemory;
  }

  async execute(definition: WorkflowDefinition, run: WorkflowRun): Promise<void> {
    const config = definition.cognitiveConfig;
    if (!config) {
      throw new WorkflowError(
        'CognitiveWorkflowConfig is required for cognitive execution mode',
        definition.id,
        run.runId,
      );
    }

    const maxIterations = config.maxIterations ?? 3;
    const qualityThreshold = config.qualityThreshold ?? 0.8;
    const criteria = config.evaluationCriteria ?? ['correctness', 'completeness', 'quality'];

    const goal = JSON.stringify(run.input);
    let bestOutput = '';
    let bestScore = 0;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;
      logger.info(`Cognitive iteration ${iteration}/${maxIterations} for workflow ${run.runId}`);

      await this.publishEvent(run, 'workflow.cognitive.iteration_started', {
        iteration,
        maxIterations,
      });

      // Phase 1: PLAN — Planner decomposes the goal into actionable steps
      const plannerFeedback = iteration > 1
        ? `\n\nPrevious attempt scored ${bestScore.toFixed(2)}/${qualityThreshold}. Evaluator feedback:\n${bestOutput}`
        : '';

      const plan = await this.runAgent(
        config.plannerAgentId,
        run,
        `You are a planner. Decompose this goal into clear, actionable steps.\n\nGoal: ${goal}${plannerFeedback}\n\nReturn a numbered list of steps.`,
        'planner',
      );

      run.context.nodeOutputs[`plan-${iteration}`] = plan;

      // Phase 2: GENERATE — Each generator produces output for its area
      const generatorOutputs: Record<string, string> = {};
      for (const generatorId of config.generatorAgentIds) {
        const output = await this.runAgent(
          generatorId,
          run,
          `Execute the following plan. Focus on your area of expertise.\n\nGoal: ${goal}\n\nPlan:\n${plan}\n\nProduce your output.`,
          `generator:${generatorId}`,
        );
        generatorOutputs[generatorId] = output;
      }

      const combinedOutput = Object.entries(generatorOutputs)
        .map(([id, output]) => `--- Output from ${id} ---\n${output}`)
        .join('\n\n');

      run.context.nodeOutputs[`generate-${iteration}`] = generatorOutputs;

      // Phase 3: EVALUATE — Evaluator judges quality against criteria
      const evaluationPrompt = [
        'You are a quality evaluator. Assess the following outputs against the criteria.',
        `\nGoal: ${goal}`,
        `\nCriteria: ${criteria.join(', ')}`,
        `\nOutputs:\n${combinedOutput}`,
        '\nRespond ONLY with valid JSON:',
        '{ "passed": boolean, "score": number (0-1), "feedback": "...", "improvements": ["..."] }',
      ].join('\n');

      const evalRaw = await this.runAgent(
        config.evaluatorAgentId,
        run,
        evaluationPrompt,
        'evaluator',
      );

      let evaluation: EvaluationResult;
      try {
        evaluation = JSON.parse(evalRaw);
        if (typeof evaluation.score !== 'number') evaluation.score = 0;
        if (!Array.isArray(evaluation.improvements)) evaluation.improvements = [];
      } catch {
        logger.warn(`Evaluator returned invalid JSON, treating as failure: ${evalRaw.slice(0, 200)}`);
        evaluation = { passed: false, score: 0, feedback: evalRaw, improvements: ['Fix JSON format'] };
      }

      run.context.nodeOutputs[`evaluate-${iteration}`] = evaluation;

      await this.publishEvent(run, 'workflow.cognitive.evaluation_completed', {
        iteration,
        score: evaluation.score,
        passed: evaluation.passed,
        feedback: evaluation.feedback.slice(0, 500),
      });

      logger.info(`Cognitive evaluation: score=${evaluation.score.toFixed(2)}, threshold=${qualityThreshold}, passed=${evaluation.passed}`);

      // Track best result
      if (evaluation.score > bestScore) {
        bestScore = evaluation.score;
        bestOutput = combinedOutput;
      }

      // Check if quality threshold met
      if (evaluation.score >= qualityThreshold || evaluation.passed) {
        logger.info(`Quality threshold met at iteration ${iteration} (score: ${evaluation.score.toFixed(2)})`);
        run.context.nodeOutputs['final'] = {
          output: combinedOutput,
          score: evaluation.score,
          iterations: iteration,
          feedback: evaluation.feedback,
        };
        return;
      }

      // Feed evaluation feedback back for next iteration
      bestOutput = evaluation.feedback + '\n\nImprovements needed:\n' +
        evaluation.improvements.map((imp, i) => `${i + 1}. ${imp}`).join('\n');
    }

    // Max iterations reached — use best result
    logger.warn(`Max iterations (${maxIterations}) reached, using best result (score: ${bestScore.toFixed(2)})`);
    run.context.nodeOutputs['final'] = {
      output: bestOutput,
      score: bestScore,
      iterations: maxIterations,
      maxIterationsReached: true,
    };
  }

  private async runAgent(
    agentId: string,
    run: WorkflowRun,
    input: string,
    role: string,
  ): Promise<string> {
    const agentDef = this.agentRegistry.get(agentId);
    if (!agentDef) {
      throw new WorkflowError(
        `Agent "${agentId}" not found in registry (role: ${role})`,
        run.workflowId,
        run.runId,
      );
    }

    const llmAdapter = this.llmAdapterFactory({
      provider: agentDef.model.provider,
      model: agentDef.model.model,
    });

    const runtime = new AgentRuntime({
      definition: agentDef,
      workflowRunId: run.runId,
      llmAdapter,
      memory: this.memory,
      eventBus: this.eventBus,
      guardrails: agentDef.guardrails,
      outputSchema: agentDef.outputSchema,
      telemetry: this.telemetry,
      cognitiveMemory: this.cognitiveMemory,
    });

    try {
      await runtime.initialize();
      return await runtime.runTurn(input);
    } finally {
      await runtime.stop();
    }
  }

  private async publishEvent(run: WorkflowRun, type: string, payload: unknown): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type,
      source: { kind: 'workflow', id: run.runId },
      timestamp: new Date(),
      payload: { workflowId: run.workflowId, runId: run.runId, ...payload as Record<string, unknown> },
      correlationId: run.runId,
    };
    await this.eventBus.publish(event);
  }
}
