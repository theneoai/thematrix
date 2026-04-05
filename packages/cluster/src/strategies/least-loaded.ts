/**
 * Least-Loaded distribution strategy
 */

import type {
  ClusterNode,
  DistributionStrategy,
  DistributionStrategyType,
} from '@thematrix/types';
import type { ExecutionTask } from '@thematrix/types';

export class LeastLoadedStrategy implements DistributionStrategy {
  readonly type: DistributionStrategyType = 'least-loaded';

  selectNode(nodes: ClusterNode[], _task: ExecutionTask): ClusterNode | null {
    if (nodes.length === 0) {
      return null;
    }

    let bestNode: ClusterNode | null = null;
    let lowestRatio = Infinity;

    for (const node of nodes) {
      const ratio =
        node.capabilities.maxConcurrentTasks > 0
          ? node.currentLoad.activeTasks / node.capabilities.maxConcurrentTasks
          : Infinity;

      if (ratio < lowestRatio) {
        lowestRatio = ratio;
        bestNode = node;
      }
    }

    return bestNode;
  }
}
