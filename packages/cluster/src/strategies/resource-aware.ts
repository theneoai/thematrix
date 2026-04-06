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

export class ResourceAwareStrategy implements DistributionStrategy {
  readonly type: DistributionStrategyType = 'resource-aware';

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
    let bestNode: ClusterNode | null = null;
    let highestScore = -Infinity;

    for (const node of candidates) {
      const cpuAvailable = 100 - node.currentLoad.cpuUsagePercent;
      const memAvailable = 100 - node.currentLoad.memoryUsagePercent;

      // Weighted score: CPU availability (35%) + memory availability (35%) + task capacity (30%)
      // Task capacity accounts for both active and queued tasks
      const totalTasks = node.currentLoad.activeTasks + node.currentLoad.queuedTasks;
      const taskCapacity =
        node.capabilities.maxConcurrentTasks > 0
          ? Math.max(0, (1 - totalTasks / node.capabilities.maxConcurrentTasks) * 100)
          : 0;

      const score = cpuAvailable * 0.35 + memAvailable * 0.35 + taskCapacity * 0.3;

      if (score > highestScore) {
        highestScore = score;
        bestNode = node;
      }
    }

    return bestNode;
  }
}
