/**
 * Work Distributor - distributes tasks to cluster nodes using a strategy
 */

import type {
  DistributionResult,
  DistributionStrategy,
  ExecutionResult,
} from '@thematrix/types';
import type { ExecutionTask } from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import type { NodeRegistry } from './registry.js';

export class WorkDistributor {
  private registry: NodeRegistry;
  private strategy: DistributionStrategy;
  private logger: Logger;
  private activeTasksByNode: Map<string, Set<string>> = new Map();

  constructor(registry: NodeRegistry, strategy: DistributionStrategy, logger?: Logger) {
    this.registry = registry;
    this.strategy = strategy;
    this.logger = logger ?? new Logger({ prefix: 'WorkDistributor' });
  }

  /**
   * Distribute a task to the best available node.
   */
  async distribute(task: ExecutionTask): Promise<DistributionResult> {
    const healthyNodes = this.registry.getHealthy();

    if (healthyNodes.length === 0) {
      throw new Error('No healthy nodes available for task distribution');
    }

    const selectedNode = this.strategy.selectNode(healthyNodes, task);

    if (!selectedNode) {
      throw new Error('Strategy could not select a node for the task');
    }

    this.logger.info(
      `Distributing task ${task.taskId} to node ${selectedNode.nodeId} (${selectedNode.hostname})`,
    );

    // Track active task
    this.trackTask(selectedNode.nodeId, task.taskId);

    try {
      // Submit task to the selected node via HTTP POST
      const url = `${selectedNode.endpoint}/tasks`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Node ${selectedNode.nodeId} rejected task: ${response.status} ${errorText}`,
        );
      }

      const result = (await response.json()) as ExecutionResult;

      this.logger.info(
        `Task ${task.taskId} completed on node ${selectedNode.nodeId} with status ${result.status}`,
      );

      return {
        nodeId: selectedNode.nodeId,
        taskId: task.taskId,
        result,
      };
    } catch (error) {
      this.logger.error(
        `Failed to distribute task ${task.taskId} to node ${selectedNode.nodeId}: ${error}`,
      );
      throw error;
    } finally {
      this.untrackTask(selectedNode.nodeId, task.taskId);
    }
  }

  /**
   * Change the distribution strategy.
   */
  setStrategy(strategy: DistributionStrategy): void {
    this.logger.info(`Strategy changed from ${this.strategy.type} to ${strategy.type}`);
    this.strategy = strategy;
  }

  /**
   * Get active tasks for a specific node.
   */
  getActiveTasksForNode(nodeId: string): Set<string> {
    return this.activeTasksByNode.get(nodeId) ?? new Set();
  }

  private trackTask(nodeId: string, taskId: string): void {
    let tasks = this.activeTasksByNode.get(nodeId);
    if (!tasks) {
      tasks = new Set();
      this.activeTasksByNode.set(nodeId, tasks);
    }
    tasks.add(taskId);
  }

  private untrackTask(nodeId: string, taskId: string): void {
    const tasks = this.activeTasksByNode.get(nodeId);
    if (tasks) {
      tasks.delete(taskId);
    }
  }
}
