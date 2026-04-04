/**
 * Local Execution Backend
 *
 * Runs agents directly in the current Node.js process.
 */

import type {
  ExecutionBackend,
  ExecutionTask,
  ExecutionResult,
  ExecutionStatus,
  ExecutionStatusType,
  BackendConfig,
  LocalBackendConfig,
  BackendHealthStatus,
  ExecutionMetrics,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'LocalBackend' });

interface TaskRecord {
  task: ExecutionTask;
  status: ExecutionStatusType;
  startedAt: Date;
  completedAt?: Date;
  output?: unknown;
  error?: string;
  abortController: AbortController;
}

export class LocalExecutionBackend implements ExecutionBackend {
  readonly type = 'local' as const;

  private config: LocalBackendConfig | undefined;
  private tasks = new Map<string, TaskRecord>();
  private maxConcurrent = 10;

  async initialize(config: BackendConfig): Promise<void> {
    this.config = config as LocalBackendConfig;
    this.maxConcurrent = config.maxConcurrent ?? 10;
    logger.info(`Local backend initialized, workDir=${this.config.workDir ?? process.cwd()}, maxConcurrent=${this.maxConcurrent}`);
  }

  async execute(task: ExecutionTask): Promise<ExecutionResult> {
    const startedAt = new Date();
    const abortController = new AbortController();

    const record: TaskRecord = {
      task,
      status: 'running',
      startedAt,
      abortController,
    };
    this.tasks.set(task.taskId, record);

    logger.info(`Executing task ${task.taskId} locally for agent ${task.agentDefinition.id}`);

    try {
      // Run the agent locally by dynamically importing core and creating a runtime.
      // We wrap in a timeout-aware promise so callers can cancel or time out.
      const output = await this.runAgent(task, abortController.signal);

      const completedAt = new Date();
      record.status = 'completed';
      record.completedAt = completedAt;
      record.output = output;

      const metrics: ExecutionMetrics = {
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };

      logger.info(`Task ${task.taskId} completed in ${metrics.durationMs}ms`);

      return {
        taskId: task.taskId,
        status: 'completed',
        output,
        metrics,
      };
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : String(error);

      const isCancelled = abortController.signal.aborted;
      record.status = isCancelled ? 'cancelled' : 'failed';
      record.completedAt = completedAt;
      record.error = errorMessage;

      logger.error(`Task ${task.taskId} ${record.status}: ${errorMessage}`);

      return {
        taskId: task.taskId,
        status: record.status,
        error: errorMessage,
        metrics: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
      };
    }
  }

  async cancel(taskId: string): Promise<void> {
    const record = this.tasks.get(taskId);
    if (!record) {
      logger.warn(`Cannot cancel unknown task ${taskId}`);
      return;
    }
    if (record.status !== 'running' && record.status !== 'pending') {
      logger.warn(`Task ${taskId} is already in terminal state: ${record.status}`);
      return;
    }

    record.abortController.abort();
    record.status = 'cancelled';
    record.completedAt = new Date();
    logger.info(`Task ${taskId} cancelled`);
  }

  async getStatus(taskId: string): Promise<ExecutionStatus> {
    const record = this.tasks.get(taskId);
    if (!record) {
      return {
        taskId,
        status: 'failed',
        message: 'Task not found',
      };
    }

    return {
      taskId,
      status: record.status,
      startedAt: record.startedAt,
      message: record.error,
    };
  }

  async healthCheck(): Promise<BackendHealthStatus> {
    const activeTasks = [...this.tasks.values()].filter(
      (r) => r.status === 'running' || r.status === 'pending',
    ).length;

    return {
      type: 'local',
      healthy: true,
      message: 'Local backend is always available',
      activeTasks,
      capacity: this.maxConcurrent,
      checkedAt: new Date(),
    };
  }

  async dispose(): Promise<void> {
    // Cancel all running tasks
    for (const [taskId, record] of this.tasks) {
      if (record.status === 'running' || record.status === 'pending') {
        record.abortController.abort();
        record.status = 'cancelled';
        record.completedAt = new Date();
        logger.info(`Disposed: cancelled task ${taskId}`);
      }
    }
    this.tasks.clear();
    logger.info('Local backend disposed');
  }

  /**
   * Run an agent task locally. Creates an AgentRuntime from @thematrix/core
   * and executes a single turn with the provided input.
   */
  private async runAgent(task: ExecutionTask, signal: AbortSignal): Promise<unknown> {
    // Create a promise that rejects on abort
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(new Error('Task cancelled'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('Task cancelled')), { once: true });
    });

    // Create a timeout promise if timeout is specified
    const timeoutMs = task.timeout ?? 300_000; // default 5 minutes
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    // The actual agent execution
    const executionPromise = (async () => {
      // Dynamically import core to create a runtime
      const { AgentRuntime, SQLiteEventStore, EventBus, MemoryManager } = await import('@thematrix/core');

      // Create lightweight in-process dependencies backed by in-memory storage
      const eventStore = new SQLiteEventStore(':memory:');
      const eventBus = new EventBus(eventStore);
      const memory = new MemoryManager();

      // For local execution we need an LLM adapter. The task's agentDefinition
      // contains model config; the caller is responsible for wiring providers
      // before handing the task to the executor. Here we create a minimal
      // pass-through that returns the input as output, suitable for testing and
      // orchestration-level execution where the real LLM call happens elsewhere.
      const inputStr = typeof task.input === 'string' ? task.input : JSON.stringify(task.input);
      const noopAdapter = {
        provider: 'local-executor-noop',
        chat: async (_request: unknown) => ({
          id: task.taskId,
          model: task.agentDefinition.model.model,
          content: inputStr,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }),
        async *chatStream(_request: unknown) {
          yield { id: task.taskId, content: inputStr };
        },
        countTokens: async (_text: unknown) => 0,
      };

      const runtime = new AgentRuntime({
        definition: task.agentDefinition,
        workflowRunId: task.workflowRunId,
        llmAdapter: noopAdapter as any,
        memory,
        eventBus,
      });

      await runtime.initialize();
      const result = await runtime.runTurn(inputStr);
      await runtime.stop();

      return result;
    })();

    // Race execution against abort and timeout
    return Promise.race([executionPromise, abortPromise, timeoutPromise]);
  }
}
