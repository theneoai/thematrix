/**
 * Cluster Management 类型定义
 *
 * 多节点集群管理，支持远程 PC 和 K8s 计算集群
 */

import type { ExecutionTask, ExecutionResult, ExecutionBackendType } from './executor.js';

// ============================================================
// Cluster Node
// ============================================================

export type NodeStatus = 'online' | 'offline' | 'draining' | 'maintenance';

export interface ClusterNode {
  nodeId: string;
  hostname: string;
  endpoint: string;           // HTTP endpoint for task submission
  backendType: ExecutionBackendType;
  capabilities: NodeCapabilities;
  status: NodeStatus;
  currentLoad: NodeLoad;
  labels: Record<string, string>;
  registeredAt: Date;
  lastHeartbeat: Date;
}

export interface NodeCapabilities {
  cpuCores: number;
  memoryGb: number;
  gpuCount?: number;
  gpuModel?: string;
  maxConcurrentTasks: number;
  supportedProviders?: string[];   // 本地 Ollama 等
  features?: string[];             // 'docker', 'gpu', 'fast-storage'
}

export interface NodeLoad {
  activeTasks: number;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  gpuUsagePercent?: number;
  networkBandwidthMbps?: number;
  queuedTasks: number;
}

// ============================================================
// Work Distribution
// ============================================================

export type DistributionStrategyType =
  | 'round-robin'
  | 'least-loaded'
  | 'resource-aware'
  | 'label-match';

export interface DistributionStrategy {
  readonly type: DistributionStrategyType;
  selectNode(nodes: ClusterNode[], task: ExecutionTask): ClusterNode | null;
}

export interface DistributionConfig {
  strategy: DistributionStrategyType;
  /** 节点无响应超时 (ms) */
  heartbeatTimeoutMs?: number;
  /** 心跳间隔 (ms) */
  heartbeatIntervalMs?: number;
  /** 任务排队超时 (ms) */
  queueTimeoutMs?: number;
  /** 失败节点任务自动迁移 */
  autoFailover?: boolean;
}

// ============================================================
// Cluster Manager Interface
// ============================================================

export interface IClusterManager {
  /** 注册节点 */
  registerNode(config: NodeRegistration): Promise<string>;

  /** 注销节点 */
  deregisterNode(nodeId: string): Promise<void>;

  /** 获取所有节点 */
  getNodes(): ClusterNode[];

  /** 获取健康节点 */
  getHealthyNodes(): ClusterNode[];

  /** 分发任务到最优节点 */
  distributeTask(task: ExecutionTask): Promise<DistributionResult>;

  /** 设置分发策略 */
  setStrategy(strategy: DistributionStrategy): void;

  /** 将节点设为 draining (不接受新任务，等待现有任务完成) */
  drainNode(nodeId: string): Promise<void>;

  /** 获取集群统计 */
  getClusterStats(): ClusterStats;

  /** 启动集群管理器 */
  start(): Promise<void>;

  /** 停止集群管理器 */
  stop(): Promise<void>;
}

export interface NodeRegistration {
  hostname: string;
  endpoint: string;
  backendType: ExecutionBackendType;
  capabilities: NodeCapabilities;
  labels?: Record<string, string>;
}

export interface DistributionResult {
  nodeId: string;
  taskId: string;
  result: ExecutionResult;
}

export interface ClusterStats {
  totalNodes: number;
  onlineNodes: number;
  totalActiveTasks: number;
  totalQueuedTasks: number;
  avgCpuUsage: number;
  avgMemoryUsage: number;
  taskCompletionRate: number;   // 最近1小时
}

// ============================================================
// Monitor & Alerts
// ============================================================

export interface MonitorConfig {
  port: number;
  host?: string;
  metricsPath?: string;       // 默认 "/metrics"
  enableWebSocket?: boolean;
  enableAlerts?: boolean;
  alertRules?: AlertRule[];
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  metric: string;             // e.g., "agent.error_rate", "token.budget_usage"
  condition: AlertCondition;
  severity: AlertSeverity;
  cooldownMs?: number;        // 告警冷却时间
  notifyChannels?: string[];  // 通知渠道 IDs
  enabled: boolean;
}

export interface AlertCondition {
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  threshold: number;
  durationMs?: number;        // 持续时间阈值: "error rate > 5% for 5 min"
  windowMs?: number;          // 时间窗口
}

export interface Alert {
  id: string;
  ruleId: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  metric: string;
  currentValue: number;
  threshold: number;
  firedAt: Date;
  resolvedAt?: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  status: 'firing' | 'acknowledged' | 'resolved';
}

export interface IMonitorServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPort(): number;
}
