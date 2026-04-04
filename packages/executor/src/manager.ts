/**
 * Executor Manager
 *
 * Central registry for execution backends. Routes tasks to the appropriate
 * backend and tracks active executions.
 */

import type {
  ExecutionBackend,
  ExecutionBackendType,
  ExecutionTask,
  ExecutionResult,
  ExecutionStatus,
  BackendHealthStatus,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'ExecutorManager' });

export class ExecutorManager {
  private backends = new Map<ExecutionBackendType, ExecutionBackend>();
  private activeTasks = new Map<string, ExecutionBackendType>();
  private defaultBackend: ExecutionBackendType = 'local';

  /**
   * Register an execution backend. Replaces any existing backend of the same type.
   */
  registerBackend(backend: ExecutionBackend): void {
    this.backends.set(backend.type, backend);
    logger.info(`Registered backend: ${backend.type}`);
  }

  /**
   * Retrieve a registered backend by type.
   */
  getBackend(type: ExecutionBackendType): ExecutionBackend | undefined {
    return this.backends.get(type);
  }

  /**
   * Set the default backend type used when execute() is called without a
   * specific backend type.
   */
  setDefaultBackend(type: ExecutionBackendType): void {
    if (!this.backends.has(type)) {
      throw new Error(`Cannot set default to unregistered backend: ${type}`);
    }
    this.defaultBackend = type;
    logger.info(`Default backend set to: ${type}`);
  }

  /**
   * Execute a task on the specified (or default) backend.
   */
  async execute(task: ExecutionTask, backendType?: ExecutionBackendType): Promise<ExecutionResult> {
    const type = backendType ?? this.defaultBackend;
    const backend = this.backends.get(type);

    if (!backend) {
      throw new Error(
        `No backend registered for type '${type}'. Available: [${[...this.backends.keys()].join(', ')}]`,
      );
    }

    this.activeTasks.set(task.taskId, type);
    logger.info(`Executing task ${task.taskId} on ${type} backend`);

    try {
      const result = await backend.execute(task);
      return result;
    } finally {
      this.activeTasks.delete(task.taskId);
    }
  }

  /**
   * Cancel a running task. Delegates to the backend that is running it.
   */
  async cancel(taskId: string): Promise<void> {
    const type = this.activeTasks.get(taskId);
    if (!type) {
      logger.warn(`Cannot cancel task ${taskId}: not found in active tasks`);
      return;
    }

    const backend = this.backends.get(type);
    if (backend) {
      await backend.cancel(taskId);
    }
    this.activeTasks.delete(taskId);
  }

  /**
   * Get the status of a task from its backend.
   */
  async getStatus(taskId: string): Promise<ExecutionStatus | undefined> {
    // Try the backend we know about
    const type = this.activeTasks.get(taskId);
    if (type) {
      const backend = this.backends.get(type);
      if (backend) {
        return backend.getStatus(taskId);
      }
    }

    // Fall back: check all backends
    for (const backend of this.backends.values()) {
      const status = await backend.getStatus(taskId);
      if (status.status !== 'failed' || status.message !== 'Task not found') {
        return status;
      }
    }

    return undefined;
  }

  /**
   * Run health checks on all registered backends.
   */
  async healthCheck(): Promise<BackendHealthStatus[]> {
    const results: BackendHealthStatus[] = [];
    for (const backend of this.backends.values()) {
      results.push(await backend.healthCheck());
    }
    return results;
  }

  /**
   * Return the number of currently active tasks across all backends.
   */
  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  /**
   * List all registered backend types.
   */
  getRegisteredBackends(): ExecutionBackendType[] {
    return [...this.backends.keys()];
  }

  /**
   * Dispose all backends and clear state.
   */
  async dispose(): Promise<void> {
    for (const backend of this.backends.values()) {
      await backend.dispose();
    }
    this.backends.clear();
    this.activeTasks.clear();
    logger.info('ExecutorManager disposed');
  }
}
