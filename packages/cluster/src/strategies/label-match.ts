/**
 * Label-Match distribution strategy
 *
 * Matches task labels/environment against node labels.
 * Falls back to least-loaded selection if no label match is found.
 */

import type {
  ClusterNode,
  DistributionStrategy,
  DistributionStrategyType,
} from '@thematrix/types';
import type { ExecutionTask } from '@thematrix/types';
import { LeastLoadedStrategy } from './least-loaded.js';

export class LabelMatchStrategy implements DistributionStrategy {
  readonly type: DistributionStrategyType = 'label-match';
  private fallback = new LeastLoadedStrategy();

  selectNode(nodes: ClusterNode[], task: ExecutionTask): ClusterNode | null {
    if (nodes.length === 0) {
      return null;
    }

    const taskLabels = task.environment ?? {};
    const taskLabelKeys = Object.keys(taskLabels);

    if (taskLabelKeys.length === 0) {
      // No labels to match on, fall back to least-loaded
      return this.fallback.selectNode(nodes, task);
    }

    // Score nodes by how many task labels they match
    let bestNode: ClusterNode | null = null;
    let bestMatchCount = 0;

    for (const node of nodes) {
      let matchCount = 0;
      for (const key of taskLabelKeys) {
        if (node.labels[key] === taskLabels[key]) {
          matchCount++;
        }
      }

      if (
        matchCount > bestMatchCount ||
        (matchCount === bestMatchCount && bestNode && node.currentLoad.activeTasks < bestNode.currentLoad.activeTasks)
      ) {
        bestMatchCount = matchCount;
        bestNode = node;
      }
    }

    // If no label matches found, fall back to least-loaded
    if (bestNode === null) {
      return this.fallback.selectNode(nodes, task);
    }

    return bestNode;
  }
}
