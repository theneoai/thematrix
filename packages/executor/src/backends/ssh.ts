/**
 * SSH Execution Backend
 *
 * Runs agents on remote machines via SSH, using child_process to spawn
 * ssh/scp commands for connectivity.
 */

import { spawn } from 'node:child_process';
import type {
  ExecutionBackend,
  ExecutionTask,
  ExecutionResult,
  ExecutionStatus,
  ExecutionStatusType,
  BackendConfig,
  SSHBackendConfig,
  BackendHealthStatus,
  ExecutionMetrics,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'SSHBackend' });

interface RemoteTaskRecord {
  taskId: string;
  remotePid: number | undefined;
  status: ExecutionStatusType;
  startedAt: Date;
  completedAt?: Date;
  output?: string;
  error?: string;
}

export class SSHExecutionBackend implements ExecutionBackend {
  readonly type = 'ssh' as const;

  private config: SSHBackendConfig | undefined;
  private maxConcurrent = 5;
  private tasks = new Map<string, RemoteTaskRecord>();

  async initialize(config: BackendConfig): Promise<void> {
    this.config = config as SSHBackendConfig;
    this.maxConcurrent = config.maxConcurrent ?? 5;
    logger.info(
      `SSH backend initialized, host=${this.config.host}:${this.config.port ?? 22}, user=${this.config.username}`,
    );
  }

  async execute(task: ExecutionTask): Promise<ExecutionResult> {
    if (!this.config) {
      throw new Error('SSH backend not initialized. Call initialize() first.');
    }

    const startedAt = new Date();
    const record: RemoteTaskRecord = {
      taskId: task.taskId,
      remotePid: undefined,
      status: 'pending',
      startedAt,
    };
    this.tasks.set(task.taskId, record);

    logger.info(`Executing task ${task.taskId} via SSH on ${this.config.host}`);

    try {
      // 1. Upload the task payload to the remote host
      // Sanitize taskId to prevent shell injection
      const safeTaskId = task.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const remoteDir = this.config.workDir
        ? `${this.config.workDir}/${safeTaskId}`
        : `/tmp/thematrix/${safeTaskId}`;
      await this.sshExec(`mkdir -p -- "${remoteDir}"`);

      const taskPayload = JSON.stringify({
        taskId: task.taskId,
        workflowRunId: task.workflowRunId,
        agentDefinition: task.agentDefinition,
        input: task.input,
        environment: task.environment,
      });

      // Write payload to remote file via stdin piping
      await this.sshExec(`cat > "${remoteDir}/task.json"`, taskPayload);

      // 2. Execute the agent remotely
      record.status = 'running';
      const nodeCmd = this.config.nodeVersion
        ? `nvm use ${this.config.nodeVersion} && node`
        : 'node';

      // Run a minimal script that reads the task payload and executes it.
      // In production, you would have a pre-deployed agent runner binary on the remote host.
      const remoteScript = [
        `cd "${remoteDir}"`,
        `echo $$ > "${remoteDir}/pid"`,
        `${nodeCmd} -e "`,
        `const fs = require('fs');`,
        `const task = JSON.parse(fs.readFileSync('task.json', 'utf-8'));`,
        `console.log(JSON.stringify({ status: 'completed', taskId: task.taskId, output: task.input }));`,
        `"`,
      ].join(' ');

      const { stdout, exitCode } = await this.sshExec(remoteScript, undefined, task.timeout);

      // 3. Try to read the remote PID
      try {
        const pidOutput = await this.sshExec(`cat "${remoteDir}/pid"`);
        record.remotePid = parseInt(pidOutput.stdout.trim(), 10) || undefined;
      } catch {
        // PID file may not exist if the command finished too quickly
      }

      const completedAt = new Date();
      record.completedAt = completedAt;

      const metrics: ExecutionMetrics = {
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };

      if (exitCode === 0) {
        record.status = 'completed';
        record.output = stdout;
        logger.info(`Task ${task.taskId} completed on remote host`);
        return { taskId: task.taskId, status: 'completed', output: stdout, metrics };
      } else {
        record.status = 'failed';
        record.error = `Remote process exited with code ${exitCode}`;
        logger.error(`Task ${task.taskId} failed: ${record.error}`);
        return { taskId: task.taskId, status: 'failed', error: record.error, output: stdout, metrics };
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
    const record = this.tasks.get(taskId);
    if (!record) {
      logger.warn(`Cannot cancel unknown task ${taskId}`);
      return;
    }

    if (record.remotePid) {
      logger.info(`Killing remote process ${record.remotePid} for task ${taskId}`);
      try {
        await this.sshExec(`kill -TERM ${record.remotePid}`);
      } catch {
        // Process may have already exited
      }
    }

    record.status = 'cancelled';
    record.completedAt = new Date();
    logger.info(`Task ${taskId} cancelled`);
  }

  async getStatus(taskId: string): Promise<ExecutionStatus> {
    const record = this.tasks.get(taskId);
    if (!record) {
      return { taskId, status: 'failed', message: 'Task not found' };
    }

    // Check if a running task's remote process is still alive
    if (record.status === 'running' && record.remotePid) {
      try {
        await this.sshExec(`kill -0 ${record.remotePid}`);
        // Process is still running
      } catch {
        // Process has exited
        record.status = 'completed';
        record.completedAt = new Date();
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
    const activeTasks = [...this.tasks.values()].filter(
      (r) => r.status === 'running' || r.status === 'pending',
    ).length;

    if (!this.config) {
      return {
        type: 'ssh',
        healthy: false,
        message: 'SSH backend not initialized',
        activeTasks,
        capacity: this.maxConcurrent,
        checkedAt: new Date(),
      };
    }

    let healthy = false;
    let message = 'SSH connection failed';

    try {
      const result = await this.sshExec('echo ok', undefined, 10_000);
      if (result.stdout.trim() === 'ok') {
        healthy = true;
        message = `SSH connection to ${this.config.host} successful`;
      }
    } catch (error) {
      message = `SSH health check failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    return {
      type: 'ssh',
      healthy,
      message,
      activeTasks,
      capacity: this.maxConcurrent,
      checkedAt: new Date(),
    };
  }

  async dispose(): Promise<void> {
    // Kill all running remote processes
    for (const [taskId, record] of this.tasks) {
      if ((record.status === 'running' || record.status === 'pending') && record.remotePid) {
        try {
          await this.sshExec(`kill -TERM ${record.remotePid}`);
          logger.info(`Disposed: killed remote process ${record.remotePid} for task ${taskId}`);
        } catch {
          // Best-effort cleanup
        }
      }
    }
    this.tasks.clear();
    logger.info('SSH backend disposed');
  }

  // ---- SSH command helpers ----

  private buildSshArgs(): string[] {
    const config = this.config!;
    const args: string[] = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
    ];

    if (config.port && config.port !== 22) {
      args.push('-p', String(config.port));
    }

    if (config.privateKeyPath) {
      args.push('-i', config.privateKeyPath);
    }

    args.push(`${config.username}@${config.host}`);
    return args;
  }

  private sshExec(
    command: string,
    stdin?: string,
    timeoutMs?: number,
  ): Promise<{ stdout: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const args = [...this.buildSshArgs(), command];
      const proc = spawn('ssh', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      if (stdin) {
        proc.stdin.write(stdin);
        proc.stdin.end();
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs) {
        timer = setTimeout(() => {
          proc.kill('SIGTERM');
          reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      proc.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ stdout, exitCode: code ?? 1 });
      });

      proc.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }
}
