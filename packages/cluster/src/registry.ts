/**
 * Node Registry - manages cluster node registration and tracking
 */

import type {
  ClusterNode,
  NodeLoad,
  NodeRegistration,
  NodeStatus,
} from '@thematrix/types';
import { generateId, Logger } from '@thematrix/utils';

export class NodeRegistry {
  private nodes: Map<string, ClusterNode> = new Map();
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger({ prefix: 'NodeRegistry' });
  }

  /**
   * Register a new node and return its generated nodeId.
   */
  register(config: NodeRegistration): string {
    const nodeId = `node-${generateId()}`;
    const now = new Date();

    const node: ClusterNode = {
      nodeId,
      hostname: config.hostname,
      endpoint: config.endpoint,
      backendType: config.backendType,
      capabilities: config.capabilities,
      status: 'online',
      currentLoad: {
        activeTasks: 0,
        cpuUsagePercent: 0,
        memoryUsagePercent: 0,
        queuedTasks: 0,
      },
      labels: config.labels ?? {},
      registeredAt: now,
      lastHeartbeat: now,
    };

    this.nodes.set(nodeId, node);
    this.logger.info(`Node registered: ${nodeId} (${config.hostname} at ${config.endpoint})`);
    return nodeId;
  }

  /**
   * Remove a node from the registry.
   */
  deregister(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      this.nodes.delete(nodeId);
      this.logger.info(`Node deregistered: ${nodeId} (${node.hostname})`);
    }
  }

  /**
   * Get a node by ID.
   */
  getNode(nodeId: string): ClusterNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Get all registered nodes.
   */
  getAll(): ClusterNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get healthy nodes (online with recent heartbeat).
   */
  getHealthy(): ClusterNode[] {
    return this.getAll().filter((node) => node.status === 'online');
  }

  /**
   * Update a node's heartbeat timestamp and load information.
   */
  updateHeartbeat(nodeId: string, load: NodeLoad): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.lastHeartbeat = new Date();
      node.currentLoad = load;
      this.logger.debug(`Heartbeat updated for node ${nodeId}`);
    }
  }

  /**
   * Update a node's status.
   */
  updateStatus(nodeId: string, status: NodeStatus): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      const previous = node.status;
      node.status = status;
      this.logger.info(`Node ${nodeId} status changed: ${previous} -> ${status}`);
    }
  }

  /**
   * Mark nodes as offline if no heartbeat received within the timeout.
   */
  checkStaleNodes(timeoutMs: number): void {
    const now = Date.now();
    for (const node of this.nodes.values()) {
      if (node.status === 'online') {
        const elapsed = now - node.lastHeartbeat.getTime();
        if (elapsed > timeoutMs) {
          this.logger.warn(
            `Node ${node.nodeId} heartbeat stale (${elapsed}ms > ${timeoutMs}ms), marking offline`,
          );
          node.status = 'offline';
        }
      }
    }
  }
}
