/**
 * Execution Backend 类型定义
 *
 * 借鉴 HermesAgent 的多执行后端模式:
 * 同一代码库支持 Local / Docker / SSH / K8s 执行目标
 */

import type { AgentDefinition } from './agent.js';

// ============================================================
// Execution Backend
// ============================================================

export type ExecutionBackendType = 'local' | 'docker' | 'ssh' | 'kubernetes';

export interface ExecutionBackend {
  readonly type: ExecutionBackendType;

  /** 初始化后端 */
  initialize(config: BackendConfig): Promise<void>;

  /** 执行任务 */
  execute(task: ExecutionTask): Promise<ExecutionResult>;

  /** 取消任务 */
  cancel(taskId: string): Promise<void>;

  /** 查询任务状态 */
  getStatus(taskId: string): Promise<ExecutionStatus>;

  /** 健康检查 */
  healthCheck(): Promise<BackendHealthStatus>;

  /** 释放资源 */
  dispose(): Promise<void>;
}

// ============================================================
// Execution Task
// ============================================================

export interface ExecutionTask {
  taskId: string;
  workflowRunId: string;
  agentDefinition: AgentDefinition;
  input: unknown;
  resources?: ResourceLimits;
  timeout?: number;
  workspace?: WorkspaceConfig;
  environment?: Record<string, string>;
  priority?: 'low' | 'normal' | 'high' | 'critical';
}

export interface ResourceLimits {
  cpu?: string;        // e.g., "2", "500m"
  memory?: string;     // e.g., "4Gi", "512Mi"
  gpu?: number;        // GPU count
  ephemeralStorage?: string;
}

export interface WorkspaceConfig {
  type: 'temp-dir' | 'git-worktree' | 'shared-volume';
  basePath?: string;
  gitRepo?: string;
  gitBranch?: string;
  cleanup: boolean;
}

// ============================================================
// Execution Result & Status
// ============================================================

export type ExecutionStatusType =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface ExecutionResult {
  taskId: string;
  status: ExecutionStatusType;
  output?: unknown;
  error?: string;
  metrics: ExecutionMetrics;
}

export interface ExecutionStatus {
  taskId: string;
  status: ExecutionStatusType;
  progress?: number;     // 0-100
  startedAt?: Date;
  message?: string;
}

export interface ExecutionMetrics {
  startedAt: Date;
  completedAt?: Date;
  durationMs: number;
  tokensUsed?: number;
  peakMemoryBytes?: number;
  cpuTimeMs?: number;
}

// ============================================================
// Backend Configs
// ============================================================

export interface BackendConfig {
  type: ExecutionBackendType;
  maxConcurrent?: number;
}

export interface LocalBackendConfig extends BackendConfig {
  type: 'local';
  workDir?: string;
}

export interface DockerBackendConfig extends BackendConfig {
  type: 'docker';
  image: string;
  dockerHost?: string;        // e.g., "unix:///var/run/docker.sock"
  network?: string;
  volumes?: DockerVolumeMount[];
  registryAuth?: {
    username: string;
    password: string;
    serverAddress: string;
  };
}

export interface DockerVolumeMount {
  hostPath: string;
  containerPath: string;
  readOnly?: boolean;
}

export interface SSHBackendConfig extends BackendConfig {
  type: 'ssh';
  host: string;
  port?: number;
  username: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
  workDir?: string;           // 远程工作目录
  nodeVersion?: string;       // 远程 Node.js 版本要求
}

export interface K8sBackendConfig extends BackendConfig {
  type: 'kubernetes';
  kubeconfig?: string;        // kubeconfig 路径, 默认 in-cluster
  namespace: string;
  image: string;
  serviceAccount?: string;
  nodeSelector?: Record<string, string>;
  tolerations?: K8sToleration[];
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  resources?: ResourceLimits;
  imagePullSecrets?: string[];
  ttlAfterFinished?: number;  // Job TTL seconds
}

export interface K8sToleration {
  key: string;
  operator: 'Exists' | 'Equal';
  value?: string;
  effect: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute';
  tolerationSeconds?: number;
}

// ============================================================
// Backend Health
// ============================================================

export interface BackendHealthStatus {
  type: ExecutionBackendType;
  healthy: boolean;
  message?: string;
  activeTasks: number;
  capacity: number;          // max concurrent tasks
  checkedAt: Date;
}

// ============================================================
// Execution Config (嵌入 workflow definition)
// ============================================================

export interface ExecutionConfig {
  backend: ExecutionBackendType;
  config: BackendConfig;
  parallelism?: number;       // 最大并行 agent 数
  retryOnBackendFailure?: boolean;
}
