/**
 * Docker Execution Backend
 *
 * Runs agents inside Docker containers, communicating with the Docker daemon
 * via the Docker Engine API over a Unix socket (or TCP).
 */

import type {
  ExecutionBackend,
  ExecutionTask,
  ExecutionResult,
  ExecutionStatus,
  ExecutionStatusType,
  BackendConfig,
  DockerBackendConfig,
  BackendHealthStatus,
  ExecutionMetrics,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'DockerBackend' });

interface ContainerRecord {
  taskId: string;
  containerId: string;
  status: ExecutionStatusType;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export class DockerExecutionBackend implements ExecutionBackend {
  readonly type = 'docker' as const;

  private config: DockerBackendConfig | undefined;
  private maxConcurrent = 5;
  private containers = new Map<string, ContainerRecord>();
  private dockerHost = 'unix:///var/run/docker.sock';

  async initialize(config: BackendConfig): Promise<void> {
    this.config = config as DockerBackendConfig;
    this.maxConcurrent = config.maxConcurrent ?? 5;
    this.dockerHost = this.config.dockerHost ?? 'unix:///var/run/docker.sock';
    logger.info(`Docker backend initialized, image=${this.config.image}, host=${this.dockerHost}`);
  }

  async execute(task: ExecutionTask): Promise<ExecutionResult> {
    if (!this.config) {
      throw new Error('Docker backend not initialized. Call initialize() first.');
    }

    const startedAt = new Date();
    const record: ContainerRecord = {
      taskId: task.taskId,
      containerId: '',
      status: 'pending',
      startedAt,
    };
    this.containers.set(task.taskId, record);

    logger.info(`Creating container for task ${task.taskId}, image=${this.config.image}`);

    try {
      // Build environment variables from the task
      const env = this.buildEnvVars(task);

      // Create the container
      const containerId = await this.createContainer(task, env);
      record.containerId = containerId;
      record.status = 'running';

      logger.info(`Container ${containerId} created for task ${task.taskId}, starting...`);

      // Start the container
      await this.startContainer(containerId);

      // Wait for the container to finish
      const exitCode = await this.waitForContainer(containerId, task.timeout ?? 300_000);

      const completedAt = new Date();
      record.completedAt = completedAt;

      // Collect logs as output
      const logs = await this.getContainerLogs(containerId);

      const metrics: ExecutionMetrics = {
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };

      if (exitCode === 0) {
        record.status = 'completed';
        logger.info(`Task ${task.taskId} completed successfully in container ${containerId}`);
        return { taskId: task.taskId, status: 'completed', output: logs, metrics };
      } else {
        record.status = 'failed';
        record.error = `Container exited with code ${exitCode}`;
        logger.error(`Task ${task.taskId} failed with exit code ${exitCode}`);
        return { taskId: task.taskId, status: 'failed', error: record.error, output: logs, metrics };
      }
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : String(error);
      record.status = 'failed';
      record.completedAt = completedAt;
      record.error = errorMessage;

      logger.error(`Task ${task.taskId} failed: ${errorMessage}`);
      return {
        taskId: task.taskId,
        status: 'failed',
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
    const record = this.containers.get(taskId);
    if (!record || !record.containerId) {
      logger.warn(`Cannot cancel unknown task ${taskId}`);
      return;
    }

    logger.info(`Stopping container ${record.containerId} for task ${taskId}`);

    try {
      await this.dockerFetch(`/containers/${record.containerId}/stop`, { method: 'POST' });
      record.status = 'cancelled';
      record.completedAt = new Date();
    } catch (error) {
      logger.error(`Failed to stop container: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getStatus(taskId: string): Promise<ExecutionStatus> {
    const record = this.containers.get(taskId);
    if (!record) {
      return { taskId, status: 'failed', message: 'Task not found' };
    }

    // If running, try to inspect the container for live status
    if (record.status === 'running' && record.containerId) {
      try {
        const inspection = await this.dockerFetch(`/containers/${record.containerId}/json`);
        const state = inspection?.State;
        if (state?.Running === false) {
          record.status = state.ExitCode === 0 ? 'completed' : 'failed';
          record.completedAt = new Date();
        }
      } catch {
        // Container may have been removed; keep existing status
      }
    }

    return {
      taskId,
      status: record.status,
      startedAt: record.startedAt,
      message: record.error,
    };
  }

  async healthCheck(): Promise<BackendHealthStatus> {
    const activeTasks = [...this.containers.values()].filter(
      (r) => r.status === 'running' || r.status === 'pending',
    ).length;

    let healthy = false;
    let message = 'Docker daemon unreachable';

    try {
      const info = await this.dockerFetch('/info');
      if (info?.ID) {
        healthy = true;
        message = `Docker daemon reachable, containers=${info.ContainersRunning ?? 0}`;
      }
    } catch (error) {
      message = `Docker health check failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    return {
      type: 'docker',
      healthy,
      message,
      activeTasks,
      capacity: this.maxConcurrent,
      checkedAt: new Date(),
    };
  }

  async dispose(): Promise<void> {
    // Stop and remove all managed containers
    for (const [taskId, record] of this.containers) {
      if (record.status === 'running' && record.containerId) {
        try {
          await this.dockerFetch(`/containers/${record.containerId}/stop`, { method: 'POST' });
          await this.dockerFetch(`/containers/${record.containerId}`, { method: 'DELETE' });
          logger.info(`Disposed: removed container ${record.containerId} for task ${taskId}`);
        } catch {
          // Best-effort cleanup
        }
      }
    }
    this.containers.clear();
    logger.info('Docker backend disposed');
  }

  // ---- Docker Engine API helpers ----

  private buildEnvVars(task: ExecutionTask): string[] {
    const env: string[] = [
      `TASK_ID=${task.taskId}`,
      `WORKFLOW_RUN_ID=${task.workflowRunId}`,
      `AGENT_DEFINITION=${JSON.stringify(task.agentDefinition)}`,
      `TASK_INPUT=${JSON.stringify(task.input)}`,
    ];

    if (task.environment) {
      for (const [key, value] of Object.entries(task.environment)) {
        env.push(`${key}=${value}`);
      }
    }

    return env;
  }

  private async createContainer(task: ExecutionTask, env: string[]): Promise<string> {
    const config = this.config!;
    const body: Record<string, unknown> = {
      Image: config.image,
      Env: env,
      HostConfig: {
        NetworkMode: config.network ?? 'bridge',
        Binds: (config.volumes ?? []).map(
          (v) => `${v.hostPath}:${v.containerPath}${v.readOnly ? ':ro' : ''}`,
        ),
      },
      Labels: {
        'thematrix.task-id': task.taskId,
        'thematrix.workflow-run-id': task.workflowRunId,
      },
    };

    // Apply resource limits
    if (task.resources) {
      const hostConfig = body.HostConfig as Record<string, unknown>;
      if (task.resources.memory) {
        hostConfig.Memory = this.parseMemory(task.resources.memory);
      }
      if (task.resources.cpu) {
        hostConfig.NanoCpus = this.parseCpu(task.resources.cpu);
      }
    }

    const result = await this.dockerFetch('/containers/create', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return result.Id;
  }

  private async startContainer(containerId: string): Promise<void> {
    await this.dockerFetch(`/containers/${containerId}/start`, { method: 'POST' });
  }

  private async waitForContainer(containerId: string, timeoutMs: number): Promise<number> {
    // Docker wait API blocks until container stops
    const result = await this.dockerFetch(
      `/containers/${containerId}/wait?condition=not-running`,
      { method: 'POST', timeout: timeoutMs },
    );
    return result?.StatusCode ?? 1;
  }

  private async getContainerLogs(containerId: string): Promise<string> {
    const result = await this.dockerFetch(
      `/containers/${containerId}/logs?stdout=true&stderr=true`,
      { rawText: true },
    );
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  private async dockerFetch(
    path: string,
    options: { method?: string; body?: string; timeout?: number; rawText?: boolean } = {},
  ): Promise<any> {
    const { method = 'GET', body, timeout: timeoutMs, rawText } = options;

    // Construct the URL. For unix sockets we use the http+unix scheme
    // which is handled by Node.js 18+ native fetch via undici.
    const isUnixSocket = this.dockerHost.startsWith('unix://');
    const socketPath = isUnixSocket ? this.dockerHost.replace('unix://', '') : undefined;
    const baseUrl = isUnixSocket ? 'http://localhost' : this.dockerHost;
    const url = `${baseUrl}/v1.43${path}`;

    const headers: Record<string, string> = {};
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      // NOTE: Unix socket support requires a custom agent in production.
      // For now we make a standard fetch call; in a real deployment
      // you would use undici's Agent with the socketPath option.
      const response = await fetch(url, {
        method,
        headers,
        body: body ?? undefined,
        signal: controller.signal,
        // @ts-expect-error -- undici dispatcher option for unix socket
        dispatcher: socketPath ? { socketPath } : undefined,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Docker API ${method} ${path} returned ${response.status}: ${text}`);
      }

      if (rawText) {
        return response.text();
      }
      const text = await response.text();
      return text ? JSON.parse(text) : undefined;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private parseMemory(memory: string): number {
    const units: Record<string, number> = {
      Ki: 1024,
      Mi: 1024 ** 2,
      Gi: 1024 ** 3,
      Ti: 1024 ** 4,
    };
    for (const [suffix, multiplier] of Object.entries(units)) {
      if (memory.endsWith(suffix)) {
        return parseInt(memory.replace(suffix, ''), 10) * multiplier;
      }
    }
    return parseInt(memory, 10);
  }

  private parseCpu(cpu: string): number {
    // Docker NanoCpus: 1 CPU = 1e9
    if (cpu.endsWith('m')) {
      return parseInt(cpu.replace('m', ''), 10) * 1_000_000;
    }
    return parseFloat(cpu) * 1_000_000_000;
  }
}
