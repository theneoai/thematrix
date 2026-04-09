/**
 * Resource-Aware distribution strategy
 *
 * Considers task resource requirements against node capabilities,
 * including GPU filtering and scoring based on available CPU/memory.
 */

import type {
  ClusterNode,
  DistributionStrategy,
  DistributionStrategyType,
} from '@thematrix/types';
import type { ExecutionTask } from '@thematrix/types';

export interface ResourceAwareWeights {
  cpu: number;
  memory: number;
  disk: number;
}

export interface ResourceAwareOptions {
  weights?: Partial<ResourceAwareWeights>;
}

const DEFAULT_WEIGHTS: ResourceAwareWeights = { cpu: 0.35, memory: 0.35, disk: 0.30 };

export class ResourceAwareStrategy implements DistributionStrategy {
  readonly type: DistributionStrategyType = 'resource-aware';
  private readonly weights: ResourceAwareWeights;

  constructor(options?: ResourceAwareOptions) {
    this.weights = { ...DEFAULT_WEIGHTS, ...options?.weights };
  }

  selectNode(nodes: ClusterNode[], task: ExecutionTask): ClusterNode | null {
    if (nodes.length === 0) {
      return null;
    }

    let candidates = nodes;

    // If the task requires GPU, filter to GPU-capable nodes
    const gpuRequired = task.resources?.gpu && task.resources.gpu > 0;
    if (gpuRequired) {
      candidates = candidates.filter(
        (node) =>
          node.capabilities.gpuCount !== undefined &&
          node.capabilities.gpuCount >= (task.resources!.gpu ?? 0),
      );

      if (candidates.length === 0) {
        return null;
      }
    }

    // Score each node based on available resources
    const scored: Array<{ node: ClusterNode; score: number }> = [];

    for (const node of candidates) {
      const cpuAvailable = 100 - node.currentLoad.cpuUsagePercent;
      const memAvailable = 100 - node.currentLoad.memoryUsagePercent;

      // Weighted score: CPU availability + memory availability + task capacity
      // Task capacity accounts for both active and queued tasks
      const totalTasks = node.currentLoad.activeTasks + node.currentLoad.queuedTasks;
      const taskCapacity =
        node.capabilities.maxConcurrentTasks > 0
          ? Math.max(0, (1 - totalTasks / node.capabilities.maxConcurrentTasks) * 100)
          : 0;

      const score =
        cpuAvailable * this.weights.cpu +
        memAvailable * this.weights.memory +
        taskCapacity * this.weights.disk;

      // Guard against NaN and -Infinity scores from corrupted load data
      if (!Number.isFinite(score)) continue;

      scored.push({ node, score });
    }

    if (scored.length === 0) {
      return null;
    }

    scored.sort((a, b) => b.score - a.score);
    return scored[0].node;
  }
}
