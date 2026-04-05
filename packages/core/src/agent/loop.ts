/**
 * Agent Loop - orchestrates autonomous multi-turn agent execution
 *
 * Wraps AgentRuntime to provide three execution modes:
 *   - single-turn: backward-compatible, calls runTurn() once
 *   - loop: autonomous iteration until [DONE] / exitCondition / maxIterations
 *   - plan-and-execute: plan, execute steps, reflect, optionally revise
 */
import type {
  AgentLoopConfig,
  AgentPlan,
  PlanStep,
  DomainEvent,
} from '@thematrix/types';
import { EventTypes, type IEventBus } from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';
import { AgentRuntime } from './runtime.js';
import { AgentPlanner } from './planner.js';
import { AgentReflector } from './reflection.js';

const logger = new Logger({ prefix: 'AgentLoop' });

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_MAX_TOTAL_TOKENS = 100_000;

export class AgentLoop {
  private runtime: AgentRuntime;
  private config: AgentLoopConfig;
  private eventBus: IEventBus;
  private totalTokens = 0;

  constructor(runtime: AgentRuntime, config: AgentLoopConfig) {
    this.runtime = runtime;
    this.config = config;
    this.eventBus = runtime.getEventBus();
  }

  /**
   * Main entry point. Runs the agent according to the configured execution mode.
   */
  async run(input: string): Promise<string> {
    const mode = this.config.mode;
    logger.info(`Starting agent loop in "${mode}" mode (agent=${this.runtime.definition.id})`);

    switch (mode) {
      case 'single-turn':
        return this.runSingleTurn(input);
      case 'loop':
        return this.runLoop(input);
      case 'plan-and-execute':
        return this.runPlanAndExecute(input);
      default:
        throw new Error(`Unknown execution mode: ${mode}`);
    }
  }

  // ---------------------------------------------------------------------------
  // single-turn
  // ---------------------------------------------------------------------------

  private async runSingleTurn(input: string): Promise<string> {
    const output = await this.runtime.runTurn(input);
    this.totalTokens = this.runtime.getMetrics().totalTokens;
    await this.publishLoopCompleted(1, output);
    return output;
  }

  // ---------------------------------------------------------------------------
  // loop
  // ---------------------------------------------------------------------------

  private async runLoop(input: string): Promise<string> {
    const maxIterations = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxTokens = this.config.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS;

    let currentInput = input;
    let lastOutput = '';
    let iteration = 0;

    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    while (iteration < maxIterations) {
      iteration++;
      logger.info(`Loop iteration ${iteration}/${maxIterations}`);

      try {
        lastOutput = await this.runtime.runTurn(currentInput);
        consecutiveErrors = 0;
      } catch (error) {
        consecutiveErrors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Loop iteration ${iteration} failed: ${errorMsg}`);

        if (consecutiveErrors >= maxConsecutiveErrors) {
          logger.error(`${maxConsecutiveErrors} consecutive errors, stopping loop`);
          lastOutput = `Loop terminated after ${maxConsecutiveErrors} consecutive errors. Last error: ${errorMsg}`;
          break;
        }
        // Reset runtime from error state so next runTurn() call is allowed
        this.runtime.resetFromError();
        // Retry with error feedback
        currentInput = `Previous attempt failed with error: ${errorMsg}\nPlease try a different approach.`;
        continue;
      }

      this.totalTokens = this.runtime.getMetrics().totalTokens;

      await this.publishIteration(iteration, lastOutput);

      // Check termination conditions
      if (lastOutput.includes('[DONE]')) {
        logger.info('Agent signalled [DONE]');
        break;
      }

      if (this.config.exitCondition && lastOutput.includes(this.config.exitCondition)) {
        logger.info(`Exit condition met: "${this.config.exitCondition}"`);
        break;
      }

      if (this.totalTokens >= maxTokens) {
        logger.warn(`Token budget exhausted (${this.totalTokens}/${maxTokens})`);
        break;
      }

      // Optional reflection
      if (this.config.enableReflection) {
        const reflector = this.createReflector();
        const history = await this.getHistorySummaries();
        const reflection = await reflector.reflect(input, lastOutput, history);

        if (reflection.quality === 'good') {
          logger.info('Reflection: quality is good, stopping loop');
          break;
        }

        if (!reflection.shouldRetry) {
          logger.info('Reflection: shouldRetry=false, stopping loop');
          break;
        }

        // Feed the suggestion back as input for the next iteration, preserving original goal
        currentInput = `Original goal: ${input}\n\nReflection feedback: ${reflection.suggestion || lastOutput}`;
      } else {
        // Without reflection, feed agent output as next input
        currentInput = lastOutput;
      }
    }

    await this.publishLoopCompleted(iteration, lastOutput);
    return lastOutput;
  }

  // ---------------------------------------------------------------------------
  // plan-and-execute
  // ---------------------------------------------------------------------------

  private async runPlanAndExecute(input: string): Promise<string> {
    const maxIterations = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxTokens = this.config.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS;
    const maxRevisions = 3;

    // 1. Create plan
    const planner = this.createPlanner();
    const availableTools = Array.from(this.runtime.getTools().keys());
    const availableAgents = this.config.handoffTargets ?? [];

    let plan = await planner.createPlan(input, availableTools, availableAgents);
    plan.status = 'executing';

    const outputs: string[] = [];
    let iteration = 0;
    let revisionCount = 0;

    // Outer loop to handle plan revisions
    let planRevised = true;
    while (planRevised) {
      planRevised = false;

      // 2. Execute each pending step
      for (const step of plan.steps) {
        if (step.status === 'completed' || step.status === 'skipped') continue;

        // Check dependencies
        if (step.dependsOn && step.dependsOn.length > 0) {
          const allDepsCompleted = step.dependsOn.every(depId => {
            const dep = plan.steps.find(s => s.id === depId);
            return dep && dep.status === 'completed';
          });
          if (!allDepsCompleted) {
            logger.warn(`Skipping step ${step.id}: dependencies not met`);
            step.status = 'skipped';
            continue;
          }
        }

        iteration++;
        if (iteration > maxIterations) {
          logger.warn('Max iterations reached during plan execution');
          break;
        }
        if (this.totalTokens >= maxTokens) {
          logger.warn('Token budget exhausted during plan execution');
          break;
        }

        step.status = 'running';
        await this.publishPlanStepStarted(plan, step);

        try {
          const stepInput = this.buildStepInput(input, step, outputs);
          const stepOutput = await this.runtime.runTurn(stepInput);
          this.totalTokens = this.runtime.getMetrics().totalTokens;

          step.status = 'completed';
          step.output = stepOutput;
          outputs.push(stepOutput);

          await this.publishPlanStepCompleted(plan, step);
          await this.publishIteration(iteration, stepOutput);
        } catch (error) {
          step.status = 'failed';
          step.output = error instanceof Error ? error.message : String(error);
          logger.error(`Step ${step.id} failed: ${step.output}`);

          await this.publishPlanStepCompleted(plan, step);
        }

        // 3. Reflect after each step (if enabled)
        if (this.config.enableReflection && step.status === 'completed') {
          const reflector = this.createReflector();
          const history = outputs.slice();
          const reflection = await reflector.reflect(input, String(step.output), history);

          if (reflection.shouldRevise && revisionCount < maxRevisions) {
            logger.info(`Reflection suggests plan revision (${revisionCount + 1}/${maxRevisions})`);
            const feedback = reflection.suggestion || reflection.issues.join('; ');
            plan = await planner.revisePlan(plan, feedback);
            plan.status = 'executing';
            revisionCount++;
            planRevised = true;
            break; // Break inner for-loop to restart with revised plan
          }
        }
      }
    }

    // Determine final output
    const completedOutputs = plan.steps
      .filter(s => s.status === 'completed' && s.output)
      .map(s => String(s.output));

    const allCompleted = plan.steps.every(
      s => s.status === 'completed' || s.status === 'skipped',
    );
    plan.status = allCompleted ? 'completed' : 'failed';

    const finalOutput = completedOutputs.length > 0
      ? completedOutputs[completedOutputs.length - 1]
      : 'Plan execution completed with no output.';

    await this.publishLoopCompleted(iteration, finalOutput);

    return finalOutput;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildStepInput(goal: string, step: PlanStep, priorOutputs: string[]): string {
    const parts = [
      `Overall goal: ${goal}`,
      `Current step: ${step.description}`,
    ];
    if (step.toolName) {
      parts.push(`Use tool: ${step.toolName}`);
    }
    if (priorOutputs.length > 0) {
      parts.push(`Results from prior steps:\n${priorOutputs.map((o, i) => `Step ${i + 1}: ${o}`).join('\n')}`);
    }
    return parts.join('\n\n');
  }

  private createPlanner(): AgentPlanner {
    return new AgentPlanner({
      llmAdapter: this.runtime.getLLMAdapter(),
      eventBus: this.eventBus,
      model: this.runtime.definition.model.model,
      sourceId: this.runtime.instanceId,
      correlationId: this.runtime.workflowRunId,
    });
  }

  private createReflector(): AgentReflector {
    return new AgentReflector({
      llmAdapter: this.runtime.getLLMAdapter(),
      eventBus: this.eventBus,
      model: this.runtime.definition.model.model,
      sourceId: this.runtime.instanceId,
      correlationId: this.runtime.workflowRunId,
    });
  }

  private async getHistorySummaries(): Promise<string[]> {
    const memory = this.runtime.getMemory();
    try {
      const history = await memory.getHistory(this.runtime.instanceId);
      return history.map((h) => `[${h.role}] ${h.content}`);
    } catch (error) {
      logger.error('Failed to get history summaries:', error);
      return [];
    }
  }

  getTotalTokens(): number {
    return this.totalTokens;
  }

  // ---------------------------------------------------------------------------
  // Event publishing
  // ---------------------------------------------------------------------------

  private async publishIteration(iteration: number, output: string): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type: EventTypes.AGENT_LOOP_ITERATION,
      source: { kind: 'agent', id: this.runtime.instanceId },
      timestamp: new Date(),
      payload: {
        agentId: this.runtime.definition.id,
        instanceId: this.runtime.instanceId,
        iteration,
        output,
        totalTokens: this.totalTokens,
      },
      correlationId: this.runtime.workflowRunId,
    };
    await this.eventBus.publish(event);
  }

  private async publishLoopCompleted(iterations: number, finalOutput: string): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type: EventTypes.AGENT_LOOP_COMPLETED,
      source: { kind: 'agent', id: this.runtime.instanceId },
      timestamp: new Date(),
      payload: {
        agentId: this.runtime.definition.id,
        instanceId: this.runtime.instanceId,
        iterations,
        totalTokens: this.totalTokens,
        finalOutput,
        mode: this.config.mode,
      },
      correlationId: this.runtime.workflowRunId,
    };
    await this.eventBus.publish(event);
  }

  private async publishPlanStepStarted(plan: AgentPlan, step: PlanStep): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type: EventTypes.AGENT_PLAN_STEP_STARTED,
      source: { kind: 'agent', id: this.runtime.instanceId },
      timestamp: new Date(),
      payload: {
        planId: plan.planId,
        stepId: step.id,
        description: step.description,
      },
      correlationId: this.runtime.workflowRunId,
    };
    await this.eventBus.publish(event);
  }

  private async publishPlanStepCompleted(plan: AgentPlan, step: PlanStep): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type: EventTypes.AGENT_PLAN_STEP_COMPLETED,
      source: { kind: 'agent', id: this.runtime.instanceId },
      timestamp: new Date(),
      payload: {
        planId: plan.planId,
        stepId: step.id,
        status: step.status,
        output: step.output,
      },
      correlationId: this.runtime.workflowRunId,
    };
    await this.eventBus.publish(event);
  }
}
