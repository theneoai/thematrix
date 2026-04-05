'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/shared/Button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { useNotificationStore } from '@/stores/notifications';

type Strategy = 'round-robin' | 'least-loaded' | 'resource-aware' | 'label-match';

const STRATEGY_OPTIONS: { value: Strategy; label: string }[] = [
  { value: 'round-robin', label: 'Round Robin' },
  { value: 'least-loaded', label: 'Least Loaded' },
  { value: 'resource-aware', label: 'Resource Aware' },
  { value: 'label-match', label: 'Label Match' },
];

export default function ClusterPage() {
  const queryClient = useQueryClient();
  const notify = useNotificationStore((s) => s.addNotification);

  const [drainTarget, setDrainTarget] = useState<{ nodeId: string; hostname: string } | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);

  // ---------- queries ----------
  const {
    data: nodes,
    isLoading: nodesLoading,
    error: nodesError,
  } = useQuery({ queryKey: ['cluster-nodes'], queryFn: api.cluster.nodes });

  const {
    data: health,
    isLoading: healthLoading,
    error: healthError,
  } = useQuery({ queryKey: ['cluster-health'], queryFn: api.cluster.health });

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useQuery({ queryKey: ['cluster-stats'], queryFn: api.cluster.stats });

  // ---------- mutations ----------
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['cluster-nodes'] });
    queryClient.invalidateQueries({ queryKey: ['cluster-health'] });
    queryClient.invalidateQueries({ queryKey: ['cluster-stats'] });
  };

  const drainMutation = useMutation({
    mutationFn: (nodeId: string) => api.cluster.drainNode(nodeId),
    onSuccess: () => {
      notify('success', 'Node is now draining');
      invalidateAll();
      setDrainTarget(null);
    },
    onError: (err: Error) => {
      notify('error', 'Failed to drain node', err.message);
    },
  });

  const enableMutation = useMutation({
    mutationFn: (nodeId: string) => api.cluster.enableNode(nodeId),
    onSuccess: () => {
      notify('success', 'Node re-enabled');
      invalidateAll();
    },
    onError: (err: Error) => {
      notify('error', 'Failed to enable node', err.message);
    },
  });

  const strategyMutation = useMutation({
    mutationFn: (strategy: Strategy) => api.cluster.setStrategy(strategy),
    onSuccess: () => {
      notify('success', 'Strategy updated');
      invalidateAll();
      setSelectedStrategy(null);
    },
    onError: (err: Error) => {
      notify('error', 'Failed to update strategy', err.message);
    },
  });

  // ---------- derived ----------
  const isLoading = nodesLoading || healthLoading || statsLoading;
  const error = nodesError ?? healthError ?? statsError;
  const activeStrategy: Strategy = selectedStrategy ?? (stats?.strategy as Strategy) ?? 'round-robin';

  // ---------- loading state ----------
  if (isLoading && !nodes && !health && !stats) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Cluster Management</h1>
        <div className="grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-border bg-background-secondary"
            />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-lg border border-border bg-background-secondary"
            />
          ))}
        </div>
      </div>
    );
  }

  // ---------- error state ----------
  if (error && !nodes && !health && !stats) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Cluster Management</h1>
        <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-error">
          Failed to load cluster data: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Cluster Management</h1>

      {/* ---------- Cluster Stats ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle">Online Nodes</p>
          <p className="mt-1 text-2xl font-semibold text-success">
            {health?.onlineNodes ?? 0}/{health?.totalNodes ?? 0}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle">Active Tasks</p>
          <p className="mt-1 text-2xl font-semibold text-accent">
            {health?.totalActiveTasks ?? 0}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle">Cluster Status</p>
          <p className="mt-1 text-2xl font-semibold">
            <StatusBadge status={health?.status ?? 'offline'} />
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle">Throughput / Hour</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            {stats?.throughputPerHour ?? '—'}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle">Error Rate</p>
          <p className="mt-1 text-2xl font-semibold text-error">
            {stats ? `${(stats.errorRate * 100).toFixed(1)}%` : '—'}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle">Avg Task Duration</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            {stats ? `${(stats.avgTaskDurationMs / 1000).toFixed(1)}s` : '—'}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle">Queue Size</p>
          <p className="mt-1 text-2xl font-semibold text-warning">
            {stats?.taskQueueSize ?? '—'}
          </p>
        </div>

        {/* Strategy selector */}
        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle mb-2">Distribution Strategy</p>
          <div className="flex items-center gap-2">
            <select
              className="flex-1 rounded-md border border-border bg-background-tertiary px-2 py-1 text-sm text-foreground"
              value={activeStrategy}
              onChange={(e) => setSelectedStrategy(e.target.value as Strategy)}
            >
              {STRATEGY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="primary"
              disabled={activeStrategy === stats?.strategy}
              loading={strategyMutation.isPending}
              onClick={() => strategyMutation.mutate(activeStrategy)}
            >
              Apply
            </Button>
          </div>
        </div>
      </div>

      {/* ---------- Node List ---------- */}
      <div>
        <h2 className="text-lg font-medium mb-4">Nodes</h2>

        {error && (
          <div className="rounded-lg border border-border bg-background-secondary p-4 text-center text-error mb-4">
            Some cluster data failed to load: {error.message}
          </div>
        )}

        {nodes && nodes.length === 0 ? (
          <EmptyState
            icon="🖥️"
            title="No nodes registered"
            description="There are no nodes in the cluster yet."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {nodes?.map((node) => (
              <div
                key={node.nodeId}
                className="rounded-lg border border-border bg-background-secondary p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-foreground">{node.hostname}</h3>
                    <p className="text-xs text-foreground-subtle mt-0.5 font-mono">
                      {node.nodeId.slice(0, 12)}
                    </p>
                  </div>
                  <StatusBadge status={node.status} />
                </div>

                {/* Labels */}
                {node.labels && Object.keys(node.labels).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {Object.entries(node.labels).map(([key, value]) => (
                      <span
                        key={key}
                        className="inline-flex rounded-full bg-background-tertiary px-2 py-0.5 text-[10px] text-foreground-muted"
                      >
                        {key}={value}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-4 space-y-3">
                  {/* CPU Usage */}
                  <div>
                    <div className="flex justify-between text-xs text-foreground-muted mb-1">
                      <span>CPU</span>
                      <span>{node.cpuUsage.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-background-tertiary">
                      <div
                        className={`h-full rounded-full ${
                          node.cpuUsage > 80
                            ? 'bg-error'
                            : node.cpuUsage > 60
                              ? 'bg-warning'
                              : 'bg-accent'
                        }`}
                        style={{ width: `${Math.min(100, node.cpuUsage)}%` }}
                      />
                    </div>
                  </div>

                  {/* Memory Usage */}
                  <div>
                    <div className="flex justify-between text-xs text-foreground-muted mb-1">
                      <span>Memory</span>
                      <span>{node.memoryUsage.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-background-tertiary">
                      <div
                        className={`h-full rounded-full ${
                          node.memoryUsage > 80
                            ? 'bg-error'
                            : node.memoryUsage > 60
                              ? 'bg-warning'
                              : 'bg-success'
                        }`}
                        style={{ width: `${Math.min(100, node.memoryUsage)}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex justify-between text-xs text-foreground-muted pt-1">
                    <span>Active Tasks</span>
                    <span className="text-foreground">{node.activeTasks}</span>
                  </div>
                </div>

                {/* Node actions */}
                <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
                  {node.status === 'draining' ? (
                    <Button
                      size="sm"
                      variant="primary"
                      loading={enableMutation.isPending}
                      onClick={() => enableMutation.mutate(node.nodeId)}
                    >
                      Enable
                    </Button>
                  ) : node.status === 'healthy' || node.status === 'online' ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        setDrainTarget({ nodeId: node.nodeId, hostname: node.hostname })
                      }
                    >
                      Drain
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- Drain confirmation dialog ---------- */}
      <ConfirmDialog
        open={drainTarget !== null}
        onClose={() => setDrainTarget(null)}
        onConfirm={() => {
          if (drainTarget) drainMutation.mutate(drainTarget.nodeId);
        }}
        title="Drain Node"
        message={`Are you sure you want to drain "${drainTarget?.hostname ?? ''}"? Active tasks will be migrated to other nodes and no new tasks will be scheduled on this node.`}
        confirmLabel="Drain Node"
        variant="danger"
        loading={drainMutation.isPending}
      />
    </div>
  );
}
