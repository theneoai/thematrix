/**
 * Cluster Health Monitor - periodically checks node health
 */

import type { NodeLoad } from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import type { NodeRegistry } from './registry.js';

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  load: NodeLoad;
}

export interface ClusterHealthMonitorOptions {
  onNodeOffline?: (nodeId: string) => void;
}

export class ClusterHealthMonitor {
  private registry: NodeRegistry;
  private logger: Logger;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private onNodeOffline?: (nodeId: string) => void;

  constructor(registry: NodeRegistry, options?: ClusterHealthMonitorOptions, logger?: Logger) {
    this.registry = registry;
    this.onNodeOffline = options?.onNodeOffline;
    this.logger = logger ?? new Logger({ prefix: 'ClusterHealthMonitor' });
  }

  /**
   * Start the periodic health checking loop.
   */
  start(intervalMs: number): void {
    if (this.intervalHandle) {
      this.logger.warn('Health monitor already running');
      return;
    }

    this.logger.info(`Starting health monitor with ${intervalMs}ms interval`);
    this.intervalHandle = setInterval(() => {
      void this.checkAllNodes();
    }, intervalMs);
  }

  /**
   * Stop the health checking loop.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.info('Health monitor stopped');
    }
  }

  /**
   * Check health of all registered nodes.
   */
  async checkAllNodes(): Promise<void> {
    const nodes = this.registry.getAll();

    const checks = nodes.map(async (node) => {
      if (node.status === 'maintenance') {
        return; // Skip nodes in maintenance mode
      }

      try {
        const url = `${node.endpoint}/health`;
        const response = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const data = (await response.json()) as HealthCheckResponse;
          this.registry.updateHeartbeat(node.nodeId, data.load);

          if (node.status === 'offline') {
            this.logger.info(`Node ${node.nodeId} is back online`);
            this.registry.updateStatus(node.nodeId, 'online');
          }
        } else {
          this.logger.warn(
            `Health check failed for node ${node.nodeId}: HTTP ${response.status}`,
          );
          this.markNodeOffline(node.nodeId);
        }
      } catch (error) {
        this.logger.warn(`Health check failed for node ${node.nodeId}: ${error}`);
        this.markNodeOffline(node.nodeId);
      }
    });

    // Add overall timeout to prevent health checks from blocking the event loop
    await Promise.race([
      Promise.allSettled(checks),
      new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
    ]);
  }

  private markNodeOffline(nodeId: string): void {
    const node = this.registry.getNode(nodeId);
    if (node && node.status !== 'offline') {
      this.registry.updateStatus(nodeId, 'offline');
      this.onNodeOffline?.(nodeId);
    }
  }
}
