/**
 * @thematrix/executor - Abstract execution backends for running agents
 *
 * Supports Local, Docker, SSH, and Kubernetes execution targets.
 */

// Manager
export { ExecutorManager } from './manager.js';

// Backends
export { LocalExecutionBackend } from './backends/local.js';
export { DockerExecutionBackend } from './backends/docker.js';
export { SSHExecutionBackend } from './backends/ssh.js';
export { K8sExecutionBackend } from './backends/kubernetes.js';

// Workspace
export { WorkspaceManager } from './workspace.js';
export type { WorkspaceInfo } from './workspace.js';

// Re-export relevant types
export type {
  ExecutionBackend,
  ExecutionBackendType,
  ExecutionTask,
  ExecutionResult,
  ExecutionStatus,
  ExecutionStatusType,
  ExecutionMetrics,
  BackendConfig,
  LocalBackendConfig,
  DockerBackendConfig,
  SSHBackendConfig,
  K8sBackendConfig,
  BackendHealthStatus,
  ResourceLimits,
  WorkspaceConfig,
  ExecutionConfig,
} from '@thematrix/types';
