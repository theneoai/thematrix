/**
 * @thematrix/cluster - Multi-node cluster management for distributed agent execution
 */

export { NodeRegistry } from './registry.js';
export { WorkDistributor } from './distributor.js';
export { ClusterHealthMonitor } from './health.js';
export type { HealthCheckResponse, ClusterHealthMonitorOptions } from './health.js';
export { ClusterManager } from './manager.js';

// Strategies
export { RoundRobinStrategy } from './strategies/round-robin.js';
export { LeastLoadedStrategy } from './strategies/least-loaded.js';
export { ResourceAwareStrategy } from './strategies/resource-aware.js';
export { LabelMatchStrategy } from './strategies/label-match.js';
