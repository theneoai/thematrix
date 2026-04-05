/**
 * Evaluation Runner - runs eval suites against agents
 */
import type {
  EvalCase,
  EvalResult,
  EvalSuite,
  EvalMetricConfig,
} from '@thematrix/types';
import type { AgentRuntime } from '@thematrix/core';
import { Logger } from '@thematrix/utils';
import { createMetric, type CreateMetricOptions, type EvalMetricFunction } from './metrics.js';

const logger = new Logger({ prefix: 'EvalRunner' });

export interface EvalRunnerOptions {
  /** Max number of cases to run concurrently. Default 1 (sequential). */
  concurrency?: number;
  /** Timeout per case in milliseconds. */
  timeout?: number;
  /** Options for creating metrics (LLM adapter, embedding provider, etc.) */
  metricOptions?: CreateMetricOptions;
}

export type AgentRuntimeFactory = () => Promise<AgentRuntime>;

export class EvalRunner {
  private readonly agentId: string;
  private readonly runtimeFactory: AgentRuntimeFactory;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly metricOptions: CreateMetricOptions;

  constructor(
    agentId: string,
    runtimeFactory: AgentRuntimeFactory,
    options: EvalRunnerOptions = {},
  ) {
    this.agentId = agentId;
    this.runtimeFactory = runtimeFactory;
    this.concurrency = options.concurrency ?? 1;
    this.timeoutMs = options.timeout ?? 60_000;
    this.metricOptions = options.metricOptions ?? {};
  }

  /**
   * Run an entire eval suite against the agent.
   */
  async run(suite: EvalSuite): Promise<EvalResult[]> {
    logger.info(`Running eval suite "${suite.name}" (${suite.cases.length} cases)`);

    const results: EvalResult[] = [];
    const cases = [...suite.cases];

    if (this.concurrency <= 1) {
      // Sequential execution
      for (const evalCase of cases) {
        const result = await this.runSingle(evalCase, suite.metrics);
        results.push(result);
      }
    } else {
      // Concurrent execution with queued semaphore pattern
      let inFlight = 0;
      const waitQueue: Array<() => void> = [];

      const waitForSlot = (): Promise<void> => {
        if (inFlight < this.concurrency) return Promise.resolve();
        return new Promise<void>((resolve) => { waitQueue.push(resolve); });
      };

      const releaseSlot = (): void => {
        inFlight--;
        const next = waitQueue.shift();
        if (next) next();
      };

      const promises: Promise<void>[] = [];

      for (const evalCase of cases) {
        await waitForSlot();
        inFlight++;

        const p = this.runSingle(evalCase, suite.metrics)
          .then((result) => { results.push(result); })
          .finally(() => { releaseSlot(); });

        promises.push(p);
      }

      await Promise.all(promises);
    }

    logger.info(`Eval suite "${suite.name}" complete: ${results.length} results`);
    return results;
  }

  /**
   * Run a single eval case and score it against the given metrics.
   */
  async runSingle(
    evalCase: EvalCase,
    metrics: EvalMetricConfig[],
  ): Promise<EvalResult> {
    logger.info(`Running case "${evalCase.id}"`);

    const metricFunctions: EvalMetricFunction[] = metrics.map((m) =>
      createMetric(m, this.metricOptions),
    );

    // Create a fresh agent runtime
    const runtime = await this.runtimeFactory();

    try {
      // Initialize the runtime
      await runtime.initialize();

      // Run the agent with the case input, measuring latency
      const startTime = Date.now();

      let output: string;
      if (this.timeoutMs > 0) {
        output = await withTimeout(
          runtime.runTurn(evalCase.input),
          this.timeoutMs,
        );
      } else {
        output = await runtime.runTurn(evalCase.input);
      }

      const latencyMs = Date.now() - startTime;

      // Get token count from runtime metrics
      const runtimeMetrics = runtime.getMetrics();
      const tokenCount = runtimeMetrics.totalTokens;

      // Score the output against each metric
      const scores = await Promise.all(
        metricFunctions.map((fn) =>
          fn(evalCase.input, output, evalCase.expectedOutput),
        ),
      );

      // Stop the runtime
      await runtime.stop();

      return {
        caseId: evalCase.id,
        agentId: this.agentId,
        output,
        scores,
        latencyMs,
        tokenCount,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error(
        `Case "${evalCase.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Stop the runtime on error
      try {
        await runtime.stop();
      } catch {
        // Ignore cleanup errors
      }

      return {
        caseId: evalCase.id,
        agentId: this.agentId,
        output: '',
        scores: metrics.map((m) => ({
          metric: m.name,
          score: 0,
          reason: `Error: ${error instanceof Error ? error.message : String(error)}`,
        })),
        latencyMs: 0,
        tokenCount: 0,
        timestamp: new Date(),
      };
    }
  }
}

/**
 * Promise timeout helper.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Eval case timed out after ${ms}ms`));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
