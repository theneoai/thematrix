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
  private operationInProgress = false;
  private operationQueue: Array<() => void> = [];

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger({ prefix: 'NodeRegistry' });
  }

  /**
   * Acquire a simple async mutex to serialize mutations.
   */
  private async acquireLock(): Promise<void> {
    if (!this.operationInProgress) {
      this.operationInProgress = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.operationQueue.push(() => {
        this.operationInProgress = true;
        resolve();
      });
    });
  }

  private releaseLock(): void {
    const next = this.operationQueue.shift();
    if (next) {
      next();
    } else {
      this.operationInProgress = false;
    }
  }

  /**
   * Register a new node and return its generated nodeId.
   */
  async register(config: NodeRegistration): Promise<string> {
    await this.acquireLock();
    try {
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
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Remove a node from the registry.
   */
  async deregister(nodeId: string): Promise<void> {
    await this.acquireLock();
    try {
      const node = this.nodes.get(nodeId);
      if (node) {
        this.nodes.delete(nodeId);
        this.logger.info(`Node deregistered: ${nodeId} (${node.hostname})`);
      }
    } finally {
      this.releaseLock();
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
  async updateHeartbeat(nodeId: string, load: NodeLoad): Promise<void> {
    await this.acquireLock();
    try {
      const node = this.nodes.get(nodeId);
      if (node) {
        node.lastHeartbeat = new Date();
        node.currentLoad = load;
        this.logger.debug(`Heartbeat updated for node ${nodeId}`);
      }
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Update a node's status.
   */
  async updateStatus(nodeId: string, status: NodeStatus): Promise<void> {
    await this.acquireLock();
    try {
      const node = this.nodes.get(nodeId);
      if (node) {
        const previous = node.status;
        node.status = status;
        this.logger.info(`Node ${nodeId} status changed: ${previous} -> ${status}`);
      }
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Mark nodes as offline if no heartbeat received within the timeout.
   */
  async checkStaleNodes(timeoutMs: number): Promise<void> {
    await this.acquireLock();
    try {
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
    } finally {
      this.releaseLock();
    }
  }
}
