/**
 * Cluster Distribution Strategies — Unit tests
 *
 * Covers: RoundRobinStrategy, LeastLoadedStrategy, ResourceAwareStrategy
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RoundRobinStrategy } from './round-robin.js';
import { LeastLoadedStrategy } from './least-loaded.js';
import { ResourceAwareStrategy } from './resource-aware.js';
import type { ClusterNode, ExecutionTask } from '@thematrix/types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  overrides: Partial<ClusterNode> = {},
): ClusterNode {
  return {
    nodeId: id,
    hostname: `host-${id}`,
    endpoint: `http://${id}:3000`,
    backendType: 'local',
    status: 'online',
    capabilities: {
      cpuCores: 8,
      memoryGb: 16,
      maxConcurrentTasks: 10,
    },
    currentLoad: {
      activeTasks: 0,
      queuedTasks: 0,
      cpuUsagePercent: 20,
      memoryUsagePercent: 30,
    },
    labels: {},
    registeredAt: new Date(),
    lastHeartbeat: new Date(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  return {
    taskId: 'task-1',
    agentId: 'agent-1',
    workflowRunId: 'wf-1',
    type: 'agent',
    payload: {},
    priority: 1,
    createdAt: new Date(),
    ...overrides,
  } as ExecutionTask;
}

// ─────────────────────────────────────────────────────────────────────────────
// RoundRobinStrategy
// ─────────────────────────────────────────────────────────────────────────────

describe('RoundRobinStrategy', () => {
  let strategy: RoundRobinStrategy;
  const task = makeTask();

  beforeEach(() => {
    strategy = new RoundRobinStrategy();
  });

  it('returns null for empty node list', () => {
    expect(strategy.selectNode([], task)).toBeNull();
  });

  it('returns the only node when list has one entry', () => {
    const node = makeNode('n1');
    expect(strategy.selectNode([node], task)).toBe(node);
  });

  it('cycles through nodes in order', () => {
    const nodes = [makeNode('n1'), makeNode('n2'), makeNode('n3')];
    expect(strategy.selectNode(nodes, task)?.nodeId).toBe('n1');
    expect(strategy.selectNode(nodes, task)?.nodeId).toBe('n2');
    expect(strategy.selectNode(nodes, task)?.nodeId).toBe('n3');
    // Wraps back to n1
    expect(strategy.selectNode(nodes, task)?.nodeId).toBe('n1');
  });

  it('wraps correctly when node list shrinks between calls', () => {
    const nodes3 = [makeNode('n1'), makeNode('n2'), makeNode('n3')];
    const nodes2 = [makeNode('n1'), makeNode('n2')];

    strategy.selectNode(nodes3, task); // idx=0 → n1
    strategy.selectNode(nodes3, task); // idx=1 → n2
    // Now smaller list — index 2 % 2 = 0 → n1
    expect(strategy.selectNode(nodes2, task)?.nodeId).toBe('n1');
  });

  it('has type property equal to "round-robin"', () => {
    expect(strategy.type).toBe('round-robin');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LeastLoadedStrategy
// ─────────────────────────────────────────────────────────────────────────────

describe('LeastLoadedStrategy', () => {
  let strategy: LeastLoadedStrategy;
  const task = makeTask();

  beforeEach(() => {
    strategy = new LeastLoadedStrategy();
  });

  it('returns null for empty node list', () => {
    expect(strategy.selectNode([], task)).toBeNull();
  });

  it('selects the node with the lowest active/max ratio', () => {
    const low = makeNode('low', {
      currentLoad: { activeTasks: 1, queuedTasks: 0, cpuUsagePercent: 10, memoryUsagePercent: 10 },
      capabilities: { cpuCores: 4, memoryGb: 8, maxConcurrentTasks: 10 },
    });
    const high = makeNode('high', {
      currentLoad: { activeTasks: 8, queuedTasks: 0, cpuUsagePercent: 80, memoryUsagePercent: 80 },
      capabilities: { cpuCores: 4, memoryGb: 8, maxConcurrentTasks: 10 },
    });

    expect(strategy.selectNode([high, low], task)).toBe(low);
  });

  it('treats maxConcurrentTasks=0 as Infinity ratio (never selected)', () => {
    const broken = makeNode('broken', {
      currentLoad: { activeTasks: 0, queuedTasks: 0, cpuUsagePercent: 0, memoryUsagePercent: 0 },
      capabilities: { cpuCores: 4, memoryGb: 8, maxConcurrentTasks: 0 },
    });
    const normal = makeNode('normal', {
      currentLoad: { activeTasks: 5, queuedTasks: 0, cpuUsagePercent: 50, memoryUsagePercent: 50 },
      capabilities: { cpuCores: 4, memoryGb: 8, maxConcurrentTasks: 10 },
    });

    expect(strategy.selectNode([broken, normal], task)).toBe(normal);
  });

  it('returns any node when all have equal load', () => {
    const nodes = [
      makeNode('n1', { currentLoad: { activeTasks: 5, queuedTasks: 0, cpuUsagePercent: 50, memoryUsagePercent: 50 } }),
      makeNode('n2', { currentLoad: { activeTasks: 5, queuedTasks: 0, cpuUsagePercent: 50, memoryUsagePercent: 50 } }),
    ];
    const selected = strategy.selectNode(nodes, task);
    expect(selected).not.toBeNull();
  });

  it('has type property equal to "least-loaded"', () => {
    expect(strategy.type).toBe('least-loaded');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ResourceAwareStrategy
// ─────────────────────────────────────────────────────────────────────────────

describe('ResourceAwareStrategy', () => {
  let strategy: ResourceAwareStrategy;

  beforeEach(() => {
    strategy = new ResourceAwareStrategy();
  });

  function makeFreeNode(id: string): ClusterNode {
    return makeNode(id, {
      currentLoad: {
        activeTasks: 0,
        queuedTasks: 0,
        cpuUsagePercent: 10,
        memoryUsagePercent: 10,
      },
      capabilities: { cpuCores: 16, memoryGb: 32, maxConcurrentTasks: 20 },
    });
  }

  function makeBusyNode(id: string): ClusterNode {
    return makeNode(id, {
      currentLoad: {
        activeTasks: 18,
        queuedTasks: 2,
        cpuUsagePercent: 90,
        memoryUsagePercent: 85,
      },
      capabilities: { cpuCores: 16, memoryGb: 32, maxConcurrentTasks: 20 },
    });
  }

  it('returns null for empty node list', () => {
    expect(strategy.selectNode([], makeTask())).toBeNull();
  });

  it('selects the least loaded node by weighted score', () => {
    const free = makeFreeNode('free');
    const busy = makeBusyNode('busy');
    expect(strategy.selectNode([busy, free], makeTask())).toBe(free);
  });

  it('filters to GPU-capable nodes when task requires GPU', () => {
    const gpuNode = makeNode('gpu', {
      capabilities: { cpuCores: 8, memoryGb: 32, maxConcurrentTasks: 4, gpuCount: 2 },
      currentLoad: { activeTasks: 1, queuedTasks: 0, cpuUsagePercent: 20, memoryUsagePercent: 30 },
    });
    const cpuOnly = makeNode('cpu', {
      capabilities: { cpuCores: 32, memoryGb: 128, maxConcurrentTasks: 20 },
      currentLoad: { activeTasks: 0, queuedTasks: 0, cpuUsagePercent: 5, memoryUsagePercent: 10 },
    });

    const task = makeTask({ resources: { cpu: 1, memory: 1024, gpu: 1 } } as Partial<ExecutionTask>);
    // Only GPU node qualifies despite higher load
    expect(strategy.selectNode([cpuOnly, gpuNode], task)).toBe(gpuNode);
  });

  it('returns null when GPU is required but no GPU nodes are available', () => {
    const cpuOnly = makeNode('cpu');
    const task = makeTask({ resources: { cpu: 1, memory: 1024, gpu: 1 } } as Partial<ExecutionTask>);
    expect(strategy.selectNode([cpuOnly], task)).toBeNull();
  });

  it('respects custom weight configuration', () => {
    // CPU-heavy weights: CPU matters most
    const cpuStrategy = new ResourceAwareStrategy({ weights: { cpu: 0.9, memory: 0.05, disk: 0.05 } });

    const cpuFree = makeNode('cpuFree', {
      currentLoad: { activeTasks: 5, queuedTasks: 0, cpuUsagePercent: 10, memoryUsagePercent: 90 },
      capabilities: { cpuCores: 8, memoryGb: 16, maxConcurrentTasks: 10 },
    });
    const cpuBusy = makeNode('cpuBusy', {
      currentLoad: { activeTasks: 1, queuedTasks: 0, cpuUsagePercent: 85, memoryUsagePercent: 20 },
      capabilities: { cpuCores: 8, memoryGb: 16, maxConcurrentTasks: 10 },
    });

    // With CPU-heavy weight, cpuFree should win even though memory is high
    expect(cpuStrategy.selectNode([cpuBusy, cpuFree], makeTask())).toBe(cpuFree);
  });

  it('ignores nodes with non-finite scores (NaN / Infinity)', () => {
    const corrupt = makeNode('corrupt', {
      currentLoad: {
        activeTasks: NaN,
        queuedTasks: 0,
        cpuUsagePercent: NaN,
        memoryUsagePercent: NaN,
      },
      capabilities: { cpuCores: 8, memoryGb: 16, maxConcurrentTasks: 10 },
    });
    const good = makeFreeNode('good');

    expect(strategy.selectNode([corrupt, good], makeTask())).toBe(good);
  });

  it('has type property equal to "resource-aware"', () => {
    expect(strategy.type).toBe('resource-aware');
  });
});
