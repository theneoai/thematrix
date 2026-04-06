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
import { ContextManager } from './context-manager.js';
import { AgentTrace } from './trace.js';
import type { TraceTree } from './trace.js';

const logger = new Logger({ prefix: 'AgentLoop' });

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_MAX_TOTAL_TOKENS = 100_000;

export class AgentLoop {
  private runtime: AgentRuntime;
  private config: AgentLoopConfig;
  private eventBus: IEventBus;
  private totalTokens = 0;
  private contextManager?: ContextManager;
  private trace?: AgentTrace;

  constructor(runtime: AgentRuntime, config: AgentLoopConfig) {
    this.runtime = runtime;
    this.config = config;
    this.eventBus = runtime.getEventBus();

    // Initialize context manager if enabled
    if (config.enableContextManagement) {
      this.contextManager = new ContextManager(
        runtime.getLLMAdapter(),
        runtime.definition.model.model,
        config.maxContextTokens,
      );
    }

    // Initialize tracing if enabled
    if (config.enableTracing) {
      this.trace = new AgentTrace(
        runtime.definition.id,
        runtime.workflowRunId,
        'agent-loop', // goal set on run()
      );
    }
  }

  /**
   * Main entry point. Runs the agent according to the configured execution mode.
   */
  async run(input: string): Promise<string> {
    const mode = this.config.mode;
    logger.info(`Starting agent loop in "${mode}" mode (agent=${this.runtime.definition.id})`);

    // Re-create trace with actual goal if tracing is enabled
    if (this.config.enableTracing) {
      this.trace = new AgentTrace(
        this.runtime.definition.id,
        this.runtime.workflowRunId,
        input.slice(0, 200),
      );
    }

    let result: string;
    const loopSpan = this.trace?.startSpan(`loop:${mode}`, 'turn', { mode, input: input.slice(0, 200) });

    try {
      switch (mode) {
        case 'single-turn':
          result = await this.runSingleTurn(input);
          break;
        case 'loop':
          result = await this.runLoop(input);
          break;
        case 'plan-and-execute':
          result = await this.runPlanAndExecute(input);
          break;
        default:
          throw new Error(`Unknown execution mode: ${mode}`);
      }

      if (loopSpan) {
        this.trace!.endSpan(loopSpan.id, {
          status: 'success',
          output: result.slice(0, 500),
          tokensUsed: this.totalTokens,
        });
      }

      // Publish trace if enabled
      if (this.trace) {
        await this.publishTrace(this.trace.getTrace());
      }

      return result;
    } catch (error) {
      if (loopSpan) {
        this.trace!.endSpan(loopSpan.id, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (this.trace) {
        await this.publishTrace(this.trace.getTrace());
      }
      throw error;
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

      const iterSpan = this.trace?.startSpan(`iteration-${iteration}`, 'turn', { iteration });

      // Context window management: auto-summarize if history is growing too large
      if (this.contextManager) {
        try {
          await this.contextManager.manageContext(
            this.runtime.instanceId,
            this.runtime.getMemory(),
          );
        } catch (err) {
          logger.warn(`Context management failed (non-fatal): ${(err as Error).message}`);
        }
      }

      try {
        lastOutput = await this.runtime.runTurn(currentInput);
        consecutiveErrors = 0;
      } catch (error) {
        consecutiveErrors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Loop iteration ${iteration} failed: ${errorMsg}`);

        if (iterSpan) {
          this.trace!.endSpan(iterSpan.id, { status: 'error', error: errorMsg });
        }

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

      if (iterSpan) {
        this.trace!.endSpan(iterSpan.id, {
          status: 'success',
          output: lastOutput.slice(0, 300),
          tokensUsed: this.totalTokens,
        });
      }

      await this.publishIteration(iteration, lastOutput);

      // Check termination conditions
      if (lastOutput.includes('[DONE]')) {
        logger.info('Agent signalled [DONE]');
        this.trace?.addDecision({
          id: generateId(),
          type: 'terminate',
          reasoning: 'Agent output contains [DONE] marker',
          chosen: 'stop',
          timestamp: new Date(),
        });
        break;
      }

      if (this.config.exitCondition && lastOutput.includes(this.config.exitCondition)) {
        logger.info(`Exit condition met: "${this.config.exitCondition}"`);
        this.trace?.addDecision({
          id: generateId(),
          type: 'terminate',
          reasoning: `Exit condition "${this.config.exitCondition}" found in output`,
          chosen: 'stop',
          timestamp: new Date(),
        });
        break;
      }

      if (this.totalTokens >= maxTokens) {
        logger.warn(`Token budget exhausted (${this.totalTokens}/${maxTokens})`);
        this.trace?.addDecision({
          id: generateId(),
          type: 'terminate',
          reasoning: `Token budget exhausted: ${this.totalTokens}/${maxTokens}`,
          chosen: 'stop',
          timestamp: new Date(),
        });
        break;
      }

      // Optional reflection
      if (this.config.enableReflection) {
        const reflectionSpan = this.trace?.startSpan('reflection', 'reflection');
        const reflector = this.createReflector();
        const history = await this.getHistorySummaries();
        const reflection = await reflector.reflect(input, lastOutput, history);

        if (reflection.quality === 'good') {
          logger.info('Reflection: quality is good, stopping loop');
          if (reflectionSpan) {
            this.trace!.endSpan(reflectionSpan.id, { status: 'success', output: 'quality=good' });
          }
          this.trace?.addDecision({
            id: generateId(),
            type: 'terminate',
            reasoning: 'Reflection assessed quality as good',
            chosen: 'stop',
            timestamp: new Date(),
          });
          break;
        }

        if (!reflection.shouldRetry) {
          logger.info('Reflection: shouldRetry=false, stopping loop');
          if (reflectionSpan) {
            this.trace!.endSpan(reflectionSpan.id, { status: 'success', output: 'shouldRetry=false' });
          }
          break;
        }

        if (reflectionSpan) {
          this.trace!.endSpan(reflectionSpan.id, {
            status: 'success',
            output: `retry with: ${reflection.suggestion?.slice(0, 200) ?? 'no suggestion'}`,
          });
        }

        this.trace?.addDecision({
          id: generateId(),
          type: 'retry',
          reasoning: reflection.suggestion ?? 'Reflection suggested retry',
          chosen: 'continue loop',
          timestamp: new Date(),
        });

        // Feed the suggestion back as input for the next iteration, preserving original goal
        const feedback = reflection.suggestion || lastOutput;
        const truncatedFeedback = feedback.length > 2000 ? feedback.slice(0, 2000) + '... [truncated]' : feedback;
        currentInput = `Original goal: ${input}\n\nReflection feedback: ${truncatedFeedback}`;
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
    const planSpan = this.trace?.startSpan('create-plan', 'planning');
    const planner = this.createPlanner();
    const availableTools = Array.from(this.runtime.getTools().keys());
    const availableAgents = this.config.handoffTargets ?? [];

    let plan = await planner.createPlan(input, availableTools, availableAgents);
    plan.status = 'executing';

    if (planSpan) {
      this.trace!.endSpan(planSpan.id, {
        status: 'success',
        output: `Plan: ${plan.steps.length} steps`,
      });
    }

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
          const unmetDeps: string[] = [];
          const allDepsCompleted = step.dependsOn.every(depId => {
            const dep = plan.steps.find(s => s.id === depId);
            if (!dep) {
              logger.error(`Step ${step.id} depends on unknown step "${depId}" — treating as unmet`);
              unmetDeps.push(`${depId}(missing)`);
              return false;
            }
            if (dep.status !== 'completed') {
              unmetDeps.push(`${depId}(${dep.status})`);
              return false;
            }
            return true;
          });
          if (!allDepsCompleted) {
            logger.warn(`Skipping step ${step.id}: unmet dependencies: ${unmetDeps.join(', ')}`);
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

        // Context window management before each step
        if (this.contextManager) {
          try {
            await this.contextManager.manageContext(
              this.runtime.instanceId,
              this.runtime.getMemory(),
            );
          } catch (err) {
            logger.warn(`Context management failed (non-fatal): ${(err as Error).message}`);
          }
        }

        step.status = 'running';
        await this.publishPlanStepStarted(plan, step);

        const stepSpan = this.trace?.startSpan(`step:${step.id}`, 'turn', {
          stepId: step.id,
          description: step.description,
          toolName: step.toolName,
        });

        try {
          const stepInput = this.buildStepInput(input, step, outputs);
          const stepOutput = await this.runtime.runTurn(stepInput);
          this.totalTokens = this.runtime.getMetrics().totalTokens;

          step.status = 'completed';
          step.output = stepOutput;
          outputs.push(stepOutput);

          if (stepSpan) {
            this.trace!.endSpan(stepSpan.id, {
              status: 'success',
              output: stepOutput.slice(0, 300),
              tokensUsed: this.totalTokens,
            });
          }

          await this.publishPlanStepCompleted(plan, step);
          await this.publishIteration(iteration, stepOutput);
        } catch (error) {
          step.status = 'failed';
          step.output = error instanceof Error ? error.message : String(error);
          logger.error(`Step ${step.id} failed: ${step.output}`);

          if (stepSpan) {
            this.trace!.endSpan(stepSpan.id, {
              status: 'error',
              error: String(step.output),
            });
          }

          await this.publishPlanStepCompleted(plan, step);
        }

        // 3. Reflect after each step (if enabled) — reflect on both success and failure
        if (this.config.enableReflection && (step.status === 'completed' || step.status === 'failed')) {
          const reflectionSpan = this.trace?.startSpan('step-reflection', 'reflection');
          const reflector = this.createReflector();
          const history = outputs.slice();
          const reflection = await reflector.reflect(input, String(step.output), history);

          if (reflection.shouldRevise && revisionCount < maxRevisions) {
            logger.info(`Reflection suggests plan revision (${revisionCount + 1}/${maxRevisions})`);
            const feedback = reflection.suggestion || reflection.issues.join('; ');

            if (reflectionSpan) {
              this.trace!.endSpan(reflectionSpan.id, {
                status: 'success',
                output: `revise plan: ${feedback.slice(0, 200)}`,
              });
            }

            this.trace?.addDecision({
              id: generateId(),
              type: 'rewrite',
              reasoning: feedback,
              chosen: `revise plan (revision ${revisionCount + 1})`,
              timestamp: new Date(),
            });

            plan = await planner.revisePlan(plan, feedback);
            plan.status = 'executing';
            revisionCount++;
            planRevised = true;
            break; // Break inner for-loop to restart with revised plan
          }

          if (reflectionSpan) {
            this.trace!.endSpan(reflectionSpan.id, {
              status: 'success',
              output: 'no revision needed',
            });
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
      cognitiveMemory: this.runtime.getCognitiveMemory(),
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

  /** Get the trace tree if tracing is enabled, otherwise undefined. */
  getTrace(): TraceTree | undefined {
    return this.trace?.getTrace();
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

  private async publishTrace(trace: TraceTree): Promise<void> {
    const event: DomainEvent = {
      eventId: generateId(),
      type: 'agent.trace.completed',
      source: { kind: 'agent', id: this.runtime.instanceId },
      timestamp: new Date(),
      payload: {
        agentId: trace.agentId,
        workflowRunId: trace.workflowRunId,
        goal: trace.goal,
        totalDurationMs: trace.totalDurationMs,
        totalTokens: trace.totalTokens,
        totalToolCalls: trace.totalToolCalls,
        decisions: trace.decisions.length,
        spans: trace.rootSpans.length,
      },
      correlationId: this.runtime.workflowRunId,
    };
    await this.eventBus.publish(event);
  }
}
