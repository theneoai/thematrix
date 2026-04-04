'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StatusBadge } from '@/components/shared/StatusBadge';

export default function ClusterPage() {
  const { data: nodes } = useQuery({ queryKey: ['cluster-nodes'], queryFn: api.cluster.nodes });
  const { data: health } = useQuery({ queryKey: ['cluster-health'], queryFn: api.cluster.health });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Cluster Management</h1>

      {/* Cluster Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle">Online Nodes</p>
          <p className="mt-1 text-2xl font-semibold text-success">
            {health?.onlineNodes ?? 0}/{health?.totalNodes ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle">Active Tasks</p>
          <p className="mt-1 text-2xl font-semibold text-accent">{health?.totalActiveTasks ?? 0}</p>
        </div>
        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle">Cluster Status</p>
          <p className="mt-1 text-2xl font-semibold">
            <StatusBadge status={health?.status ?? 'offline'} />
          </p>
        </div>
      </div>

      {/* Node List */}
      <div>
        <h2 className="text-lg font-medium mb-4">Nodes</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {nodes?.map((node) => (
            <div key={node.nodeId} className="rounded-lg border border-border bg-background-secondary p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-foreground">{node.hostname}</h3>
                  <p className="text-xs text-foreground-subtle mt-0.5 font-mono">{node.nodeId.slice(0, 12)}</p>
                </div>
                <StatusBadge status={node.status} />
              </div>

              <div className="mt-4 space-y-3">
                {/* CPU Usage */}
                <div>
                  <div className="flex justify-between text-xs text-foreground-muted mb-1">
                    <span>CPU</span>
                    <span>{node.cpuUsage.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-background-tertiary">
                    <div
                      className={`h-full rounded-full ${node.cpuUsage > 80 ? 'bg-error' : node.cpuUsage > 60 ? 'bg-warning' : 'bg-accent'}`}
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
                      className={`h-full rounded-full ${node.memoryUsage > 80 ? 'bg-error' : node.memoryUsage > 60 ? 'bg-warning' : 'bg-success'}`}
                      style={{ width: `${Math.min(100, node.memoryUsage)}%` }}
                    />
                  </div>
                </div>

                <div className="flex justify-between text-xs text-foreground-muted pt-1">
                  <span>Active Tasks</span>
                  <span className="text-foreground">{node.activeTasks}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
