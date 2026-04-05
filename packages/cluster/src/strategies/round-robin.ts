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
    this.currentIndex = (this.currentIndex + 1) % nodes.length;
    return nodes[index];
  }
}
