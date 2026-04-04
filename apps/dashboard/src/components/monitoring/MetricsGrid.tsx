'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

interface MetricCard {
  label: string;
  value: string | number;
  change?: string;
  status?: 'success' | 'warning' | 'error' | 'info';
}

export function MetricsGrid() {
  const { data: workflows } = useQuery({
    queryKey: ['workflows'],
    queryFn: api.workflows.list,
  });

  const { data: tokenUsage } = useQuery({
    queryKey: ['token-usage'],
    queryFn: api.tokens.usage,
  });

  const { data: clusterHealth } = useQuery({
    queryKey: ['cluster-health'],
    queryFn: api.cluster.health,
  });

  const activeRuns = workflows?.filter(w => w.status === 'running').length ?? 0;
  const completedToday = workflows?.filter(w =>
    w.status === 'completed' &&
    w.completedAt &&
    new Date(w.completedAt).toDateString() === new Date().toDateString()
  ).length ?? 0;
  const totalTokens = tokenUsage?.reduce((sum, u) => sum + u.totalTokens, 0) ?? 0;
  const totalCost = tokenUsage?.reduce((sum, u) => sum + u.totalCostUsd, 0) ?? 0;

  const metrics: MetricCard[] = [
    {
      label: 'Active Runs',
      value: activeRuns,
      status: activeRuns > 0 ? 'info' : 'success',
    },
    {
      label: 'Completed Today',
      value: completedToday,
      status: 'success',
    },
    {
      label: 'Tokens Used (24h)',
      value: totalTokens > 1_000_000
        ? `${(totalTokens / 1_000_000).toFixed(1)}M`
        : totalTokens > 1_000
          ? `${(totalTokens / 1_000).toFixed(1)}K`
          : totalTokens,
      status: 'info',
    },
    {
      label: 'Cost (24h)',
      value: `$${totalCost.toFixed(2)}`,
      status: totalCost > 10 ? 'warning' : 'info',
    },
    {
      label: 'Cluster Nodes',
      value: `${clusterHealth?.onlineNodes ?? 0}/${clusterHealth?.totalNodes ?? 0}`,
      status: (clusterHealth?.onlineNodes ?? 0) === (clusterHealth?.totalNodes ?? 0)
        ? 'success' : 'warning',
    },
    {
      label: 'Active Tasks',
      value: clusterHealth?.totalActiveTasks ?? 0,
      status: 'info',
    },
  ];

  const statusColors = {
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-error',
    info: 'text-accent',
  };

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="rounded-lg border border-border bg-background-secondary p-4"
        >
          <p className="text-xs text-foreground-subtle">{metric.label}</p>
          <p className={`mt-1 text-2xl font-semibold ${statusColors[metric.status ?? 'info']}`}>
            {metric.value}
          </p>
        </div>
      ))}
    </div>
  );
}
