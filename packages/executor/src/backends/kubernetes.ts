/**
 * Kubernetes Execution Backend
 *
 * Runs agents as Kubernetes Jobs, communicating with the K8s API server
 * via fetch (works both in-cluster and with kubeconfig).
 */

import { readFile } from 'node:fs/promises';
import type {
  ExecutionBackend,
  ExecutionTask,
  ExecutionResult,
  ExecutionStatus,
  ExecutionStatusType,
  BackendConfig,
  K8sBackendConfig,
  BackendHealthStatus,
  ExecutionMetrics,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'K8sBackend' });

interface JobRecord {
  taskId: string;
  jobName: string;
  namespace: string;
  status: ExecutionStatusType;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export class K8sExecutionBackend implements ExecutionBackend {
  readonly type = 'kubernetes' as const;

  private config: K8sBackendConfig | undefined;
  private maxConcurrent = 20;
  private jobs = new Map<string, JobRecord>();

  // K8s API server connection details (resolved during initialize)
  private apiServer = '';
  private authToken = '';
  private caCertPath = '';

  async initialize(config: BackendConfig): Promise<void> {
    this.config = config as K8sBackendConfig;
    this.maxConcurrent = config.maxConcurrent ?? 20;

    // Resolve API server details
    if (this.config.kubeconfig) {
      // Parse kubeconfig file for server and auth
      await this.loadFromKubeconfig(this.config.kubeconfig);
    } else {
      // In-cluster config: use service account token and internal DNS
      this.apiServer = 'https://kubernetes.default.svc';
      this.caCertPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
      try {
        this.authToken = await readFile(
          '/var/run/secrets/kubernetes.io/serviceaccount/token',
          'utf-8',
        );
      } catch {
        logger.warn('Could not read in-cluster service account token');
      }
    }

    logger.info(
      `K8s backend initialized, namespace=${this.config.namespace}, image=${this.config.image}, apiServer=${this.apiServer}`,
    );
  }

  private static readonly MAX_TIMEOUT_MS = 3_600_000;
  private static readonly MIN_TIMEOUT_MS = 1_000;

  async execute(task: ExecutionTask): Promise<ExecutionResult> {
    if (!this.config) {
      throw new Error('K8s backend not initialized. Call initialize() first.');
    }

    // Prevent duplicate taskId from overwriting an active task
    const existing = this.jobs.get(task.taskId);
    if (existing && (existing.status === 'running' || existing.status === 'pending')) {
      throw new Error(`Task ${task.taskId} is already running`);
    }

    const startedAt = new Date();
    const jobName = `thematrix-${task.taskId.slice(0, 8).toLowerCase()}`;
    const namespace = this.config.namespace;

    const record: JobRecord = {
      taskId: task.taskId,
      jobName,
      namespace,
      status: 'pending',
      startedAt,
    };
    this.jobs.set(task.taskId, record);

    logger.info(`Creating K8s Job ${jobName} in namespace ${namespace} for task ${task.taskId}`);

    try {
      // Build the Job manifest
      const jobManifest = this.buildJobManifest(task, jobName);

      // Create the Job
      await this.k8sFetch(
        `/apis/batch/v1/namespaces/${namespace}/jobs`,
        { method: 'POST', body: JSON.stringify(jobManifest) },
      );

      record.status = 'running';
      logger.info(`Job ${jobName} created, waiting for completion...`);

      // Poll for job completion
      const rawTimeout = task.timeout ?? 600_000;
      const timeoutMs = Math.min(Math.max(rawTimeout, K8sExecutionBackend.MIN_TIMEOUT_MS), K8sExecutionBackend.MAX_TIMEOUT_MS);
      const result = await this.waitForJob(jobName, namespace, timeoutMs);

      const completedAt = new Date();
      record.completedAt = completedAt;

      const metrics: ExecutionMetrics = {
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };

      if (result.succeeded) {
        record.status = 'completed';
        // Attempt to read pod logs
        const logs = await this.getJobLogs(jobName, namespace);
        logger.info(`Task ${task.taskId} completed via Job ${jobName}`);
        return { taskId: task.taskId, status: 'completed', output: logs, metrics };
      } else {
        record.status = 'failed';
        record.error = result.reason ?? 'Job failed';
        // Capture pod logs before reporting failure
        const logs = await this.getJobLogs(jobName, namespace);
        logger.error(`Task ${task.taskId} failed: ${record.error}`);
        return { taskId: task.taskId, status: 'failed', error: record.error, output: logs, metrics };
      }
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : String(error);
      record.status = 'failed';
      record.completedAt = completedAt;
      record.error = errorMessage;

      // Best-effort capture of pod logs before reporting failure
      let logs: string | undefined;
      try {
        logs = await this.getJobLogs(jobName, namespace);
      } catch {
        // Ignore log retrieval errors
      }

      logger.error(`Task ${task.taskId} failed: ${errorMessage}`);
      return {
        taskId: task.taskId,
        status: 'failed',
        error: errorMessage,
        output: logs,
        metrics: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
      };
    }
  }

  async cancel(taskId: string): Promise<void> {
    const record = this.jobs.get(taskId);
    if (!record) {
      logger.warn(`Cannot cancel unknown task ${taskId}`);
      return;
    }

    logger.info(`Deleting Job ${record.jobName} in namespace ${record.namespace} for task ${taskId}`);

    try {
      // Delete the Job with propagation policy to clean up pods
      await this.k8sFetch(
        `/apis/batch/v1/namespaces/${record.namespace}/jobs/${record.jobName}?propagationPolicy=Foreground`,
        { method: 'DELETE' },
      );
      record.status = 'cancelled';
      record.completedAt = new Date();
    } catch (error) {
      logger.error(`Failed to delete job: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getStatus(taskId: string): Promise<ExecutionStatus> {
    const record = this.jobs.get(taskId);
    if (!record) {
      return { taskId, status: 'failed', message: 'Task not found' };
    }

    // If running, check live status
    if (record.status === 'running') {
      try {
        const job = await this.k8sFetch(
          `/apis/batch/v1/namespaces/${record.namespace}/jobs/${record.jobName}`,
        );
        const conditions = job?.status?.conditions ?? [];
        const completeCond = conditions.find((c: any) => c.type === 'Complete' && c.status === 'True');
        const failedCond = conditions.find((c: any) => c.type === 'Failed' && c.status === 'True');

        if (completeCond) {
          record.status = 'completed';
          record.completedAt = new Date();
        } else if (failedCond) {
          record.status = 'failed';
          record.completedAt = new Date();
          record.error = failedCond.reason ?? 'Job failed';
        }
      } catch {
        // Keep existing status
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
    const activeTasks = [...this.jobs.values()].filter(
      (r) => r.status === 'running' || r.status === 'pending',
    ).length;

    let healthy = false;
    let message = 'K8s API server unreachable';

    try {
      const result = await this.k8sFetch('/healthz', { rawText: true });
      if (result === 'ok') {
        healthy = true;
        message = `K8s API server healthy, namespace=${this.config?.namespace ?? 'unknown'}`;
      }
    } catch (error) {
      message = `K8s health check failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    return {
      type: 'kubernetes',
      healthy,
      message,
      activeTasks,
      capacity: this.maxConcurrent,
      checkedAt: new Date(),
    };
  }

  async dispose(): Promise<void> {
    // Delete all managed jobs
    for (const [taskId, record] of this.jobs) {
      if (record.status === 'running' || record.status === 'pending') {
        try {
          await this.k8sFetch(
            `/apis/batch/v1/namespaces/${record.namespace}/jobs/${record.jobName}?propagationPolicy=Foreground`,
            { method: 'DELETE' },
          );
          logger.info(`Disposed: deleted Job ${record.jobName} for task ${taskId}`);
        } catch {
          // Best-effort cleanup
        }
      }
    }
    this.jobs.clear();
    logger.info('K8s backend disposed');
  }

  // ---- Job manifest builder ----

  private buildJobManifest(task: ExecutionTask, jobName: string): Record<string, unknown> {
    const config = this.config!;

    const envVars = [
      { name: 'TASK_ID', value: task.taskId },
      { name: 'WORKFLOW_RUN_ID', value: task.workflowRunId },
      { name: 'AGENT_DEFINITION', value: JSON.stringify(task.agentDefinition) },
      { name: 'TASK_INPUT', value: JSON.stringify(task.input) },
    ];

    if (task.environment) {
      for (const [key, value] of Object.entries(task.environment)) {
        envVars.push({ name: key, value });
      }
    }

    // Build resource requests/limits
    const resources: Record<string, Record<string, string>> = {};
    const limits = task.resources ?? config.resources;
    if (limits) {
      resources.limits = {};
      resources.requests = {};
      if (limits.cpu) {
        resources.limits.cpu = limits.cpu;
        resources.requests.cpu = limits.cpu;
      }
      if (limits.memory) {
        resources.limits.memory = limits.memory;
        resources.requests.memory = limits.memory;
      }
      if (limits.ephemeralStorage) {
        resources.limits['ephemeral-storage'] = limits.ephemeralStorage;
        resources.requests['ephemeral-storage'] = limits.ephemeralStorage;
      }
      if (limits.gpu) {
        resources.limits['nvidia.com/gpu'] = String(limits.gpu);
      }
    }

    const container: Record<string, unknown> = {
      name: 'agent',
      image: config.image,
      env: envVars,
      resources: Object.keys(resources).length > 0 ? resources : undefined,
    };

    const podSpec: Record<string, unknown> = {
      containers: [container],
      restartPolicy: 'Never',
    };

    if (config.serviceAccount) {
      podSpec.serviceAccountName = config.serviceAccount;
    }
    if (config.nodeSelector) {
      podSpec.nodeSelector = config.nodeSelector;
    }
    if (config.tolerations) {
      podSpec.tolerations = config.tolerations;
    }
    if (config.imagePullSecrets) {
      podSpec.imagePullSecrets = config.imagePullSecrets.map((name) => ({ name }));
    }

    const jobSpec: Record<string, unknown> = {
      template: {
        metadata: {
          labels: {
            'thematrix.io/task-id': task.taskId,
            'thematrix.io/workflow-run-id': task.workflowRunId,
            ...(config.labels ?? {}),
          },
          annotations: config.annotations ?? {},
        },
        spec: podSpec,
      },
      backoffLimit: 0,
    };

    if (config.ttlAfterFinished !== undefined) {
      jobSpec.ttlSecondsAfterFinished = config.ttlAfterFinished;
    }

    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace: config.namespace,
        labels: {
          'thematrix.io/task-id': task.taskId,
          'thematrix.io/workflow-run-id': task.workflowRunId,
          ...(config.labels ?? {}),
        },
      },
      spec: jobSpec,
    };
  }

  // ---- K8s API helpers ----

  private async waitForJob(
    jobName: string,
    namespace: string,
    timeoutMs: number,
  ): Promise<{ succeeded: boolean; reason?: string }> {
    const deadline = Date.now() + timeoutMs;
    const pollIntervalMs = 2_000;

    while (Date.now() < deadline) {
      const job = await this.k8sFetch(
        `/apis/batch/v1/namespaces/${namespace}/jobs/${jobName}`,
      );

      const conditions = job?.status?.conditions ?? [];
      const completeCond = conditions.find((c: any) => c.type === 'Complete' && c.status === 'True');
      const failedCond = conditions.find((c: any) => c.type === 'Failed' && c.status === 'True');

      if (completeCond) {
        return { succeeded: true };
      }
      if (failedCond) {
        return { succeeded: false, reason: failedCond.reason ?? failedCond.message };
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return { succeeded: false, reason: `Job timed out after ${timeoutMs}ms` };
  }

  private async getJobLogs(jobName: string, namespace: string): Promise<string> {
    try {
      // List pods for this job
      const pods = await this.k8sFetch(
        `/api/v1/namespaces/${namespace}/pods?labelSelector=job-name=${jobName}`,
      );

      const podName = pods?.items?.[0]?.metadata?.name;
      if (!podName) {
        return '(no pod logs available)';
      }

      const logs = await this.k8sFetch(
        `/api/v1/namespaces/${namespace}/pods/${podName}/log?container=agent`,
        { rawText: true },
      );
      return typeof logs === 'string' ? logs : JSON.stringify(logs);
    } catch {
      return '(failed to retrieve pod logs)';
    }
  }

  private async loadFromKubeconfig(kubeconfigPath: string): Promise<void> {
    try {
      const content = await readFile(kubeconfigPath, 'utf-8');

      // Parse kubeconfig YAML by splitting into lines and extracting key-value pairs.
      // We look for `server:` under `clusters:` and `token:` under `users:` sections
      // to avoid matching those keys in unrelated sections (e.g. comments, context names).
      const lines = content.split('\n');

      let server: string | undefined;
      let token: string | undefined;
      let inClusters = false;
      let inUsers = false;

      for (const line of lines) {
        const trimmed = line.trimStart();

        // Track top-level sections (no leading whitespace or at section level)
        if (/^clusters\s*:/.test(trimmed)) { inClusters = true; inUsers = false; continue; }
        if (/^users\s*:/.test(trimmed)) { inUsers = true; inClusters = false; continue; }
        if (/^(contexts|current-context|kind|apiVersion|preferences)\s*:/.test(trimmed)) {
          inClusters = false; inUsers = false; continue;
        }

        // Extract server from clusters section
        if (inClusters && !server) {
          const serverMatch = trimmed.match(/^server:\s*["']?(https?:\/\/[^\s"'#]+)["']?\s*$/);
          if (serverMatch) {
            server = serverMatch[1];
          }
        }

        // Extract token from users section
        if (inUsers && !token) {
          const tokenMatch = trimmed.match(/^token:\s*["']?([^\s"'#]+)["']?\s*$/);
          if (tokenMatch) {
            token = tokenMatch[1];
          }
        }
      }

      if (server && /^https?:\/\//.test(server)) {
        this.apiServer = server;
      } else {
        logger.warn(`Invalid or missing server URL in kubeconfig, falling back to default`);
        this.apiServer = 'https://127.0.0.1:6443';
      }

      this.authToken = token ?? '';

      logger.info(`Loaded kubeconfig from ${kubeconfigPath}, server=${this.apiServer}`);
    } catch (error) {
      logger.warn(`Failed to load kubeconfig: ${error instanceof Error ? error.message : String(error)}`);
      this.apiServer = 'https://127.0.0.1:6443';
    }
  }

  private async k8sFetch(
    path: string,
    options: { method?: string; body?: string; rawText?: boolean } = {},
  ): Promise<any> {
    const { method = 'GET', body, rawText } = options;
    const url = `${this.apiServer}${path}`;

    const headers: Record<string, string> = {};
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`K8s API ${method} ${path} returned ${response.status}: ${text}`);
    }

    if (rawText) {
      return response.text();
    }
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }
}
