/**
 * Cluster Manager - main entry point for cluster operations
 *
 * Combines NodeRegistry, WorkDistributor, and ClusterHealthMonitor
 * into a unified IClusterManager implementation.
 */

import type {
  ClusterNode,
  ClusterStats,
  DistributionConfig,
  DistributionResult,
  DistributionStrategy,
  IClusterManager,
  NodeRegistration,
} from '@thematrix/types';
import type { ExecutionTask } from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import { NodeRegistry } from './registry.js';
import { WorkDistributor } from './distributor.js';
import { ClusterHealthMonitor } from './health.js';
import { RoundRobinStrategy } from './strategies/round-robin.js';
import { LeastLoadedStrategy } from './strategies/least-loaded.js';
import { ResourceAwareStrategy } from './strategies/resource-aware.js';
import { LabelMatchStrategy } from './strategies/label-match.js';

export class ClusterManager implements IClusterManager {
  private registry: NodeRegistry;
  private distributor: WorkDistributor;
  private healthMonitor: ClusterHealthMonitor;
  private config: DistributionConfig;
  private logger: Logger;
  private completedTasks = 0;
  private completedTasksLastHour = 0;
  private completedTasksResetTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: DistributionConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger ?? new Logger({ prefix: 'ClusterManager' });

    this.registry = new NodeRegistry(this.logger.child('Registry'));

    const strategy = this.createStrategy(config.strategy);
    this.distributor = new WorkDistributor(
      this.registry,
      strategy,
      this.logger.child('Distributor'),
    );

    this.healthMonitor = new ClusterHealthMonitor(
      this.registry,
      {
        onNodeOffline: (nodeId) => this.handleNodeOffline(nodeId),
      },
      this.logger.child('HealthMonitor'),
    );
  }

  async registerNode(config: NodeRegistration): Promise<string> {
    return this.registry.register(config);
  }

  async deregisterNode(nodeId: string): Promise<void> {
    this.registry.deregister(nodeId);
  }

  getNodes(): ClusterNode[] {
    return this.registry.getAll();
  }

  getHealthyNodes(): ClusterNode[] {
    return this.registry.getHealthy();
  }

  async distributeTask(task: ExecutionTask): Promise<DistributionResult> {
    const result = await this.distributor.distribute(task);
    this.completedTasks++;
    this.completedTasksLastHour++;
    return result;
  }

  setStrategy(strategy: DistributionStrategy): void {
    this.distributor.setStrategy(strategy);
  }

  async drainNode(nodeId: string): Promise<void> {
    const node = this.registry.getNode(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    this.logger.info(`Draining node ${nodeId} (${node.hostname})`);
    this.registry.updateStatus(nodeId, 'draining');

    // Wait for active tasks to complete
    const pollIntervalMs = 1000;
    const maxWaitMs = this.config.queueTimeoutMs ?? 60_000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const activeTasks = this.distributor.getActiveTasksForNode(nodeId);
      if (activeTasks.size === 0) {
        this.logger.info(`Node ${nodeId} drained successfully`);
        return;
      }
      this.logger.debug(
        `Node ${nodeId} still has ${activeTasks.size} active tasks, waiting...`,
      );
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    this.logger.warn(`Node ${nodeId} drain timed out, some tasks may still be active`);
  }

  getClusterStats(): ClusterStats {
    const allNodes = this.registry.getAll();
    const onlineNodes = allNodes.filter(
      (n) => n.status === 'online' || n.status === 'draining',
    );

    let totalActiveTasks = 0;
    let totalQueuedTasks = 0;
    let totalCpuUsage = 0;
    let totalMemoryUsage = 0;

    for (const node of onlineNodes) {
      totalActiveTasks += node.currentLoad.activeTasks;
      totalQueuedTasks += node.currentLoad.queuedTasks;
      totalCpuUsage += node.currentLoad.cpuUsagePercent;
      totalMemoryUsage += node.currentLoad.memoryUsagePercent;
    }

    const nodeCount = onlineNodes.length || 1; // avoid division by zero

    return {
      totalNodes: allNodes.length,
      onlineNodes: onlineNodes.length,
      totalActiveTasks,
      totalQueuedTasks,
      avgCpuUsage: totalCpuUsage / nodeCount,
      avgMemoryUsage: totalMemoryUsage / nodeCount,
      taskCompletionRate: this.completedTasksLastHour,
    };
  }

  async start(): Promise<void> {
    const intervalMs = this.config.heartbeatIntervalMs ?? 30_000;
    this.healthMonitor.start(intervalMs);

    // Reset completed-tasks-per-hour counter every hour
    this.completedTasksResetTimer = setInterval(() => {
      this.completedTasksLastHour = 0;
    }, 3_600_000);

    this.logger.info('Cluster manager started');
  }

  async stop(): Promise<void> {
    this.healthMonitor.stop();

    if (this.completedTasksResetTimer) {
      clearInterval(this.completedTasksResetTimer);
      this.completedTasksResetTimer = null;
    }

    this.logger.info('Cluster manager stopped');
  }

  private createStrategy(type: string): DistributionStrategy {
    switch (type) {
      case 'round-robin':
        return new RoundRobinStrategy();
      case 'least-loaded':
        return new LeastLoadedStrategy();
      case 'resource-aware':
        return new ResourceAwareStrategy();
      case 'label-match':
        return new LabelMatchStrategy();
      default:
        this.logger.warn(`Unknown strategy "${type}", defaulting to round-robin`);
        return new RoundRobinStrategy();
    }
  }

  private handleNodeOffline(nodeId: string): void {
    this.logger.warn(`Node ${nodeId} went offline`);

    if (this.config.autoFailover) {
      const activeTasks = this.distributor.getActiveTasksForNode(nodeId);
      if (activeTasks.size > 0) {
        this.logger.info(
          `Auto-failover: ${activeTasks.size} tasks from node ${nodeId} need reassignment`,
        );
        // Note: actual task reassignment would require task state management
        // which is beyond the scope of this module. The callback notifies
        // higher-level orchestration to handle re-submission.
      }
    }
  }
}
