/**
 * Round-Robin distribution strategy
 */

import type {
  ClusterNode,
  DistributionStrategy,
  DistributionStrategyType,
} from '@thematrix/types';
import type { ExecutionTask } from '@thematrix/types';

export class RoundRobinStrategy implements DistributionStrategy {
  readonly type: DistributionStrategyType = 'round-robin';
  private currentIndex = 0;

  selectNode(nodes: ClusterNode[], _task: ExecutionTask): ClusterNode | null {
    if (nodes.length === 0) {
      return null;
    }

    const index = this.currentIndex % nodes.length;
    // Reset to avoid overflow: wrap around nodes.length to keep the counter small
    this.currentIndex = index + 1;
    if (this.currentIndex >= Number.MAX_SAFE_INTEGER - 1) {
      this.currentIndex = 0;
    }
    return nodes[index];
  }
}
