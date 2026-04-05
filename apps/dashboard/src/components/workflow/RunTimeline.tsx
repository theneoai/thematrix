'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StatusBadge } from '@/components/shared/StatusBadge';
import Link from 'next/link';

export function RunTimeline() {
  const { data: workflows, isLoading, error } = useQuery({
    queryKey: ['workflows'],
    queryFn: api.workflows.list,
  });

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-error">
        Failed to load workflows: {error.message}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg border border-border bg-background-secondary"
          />
        ))}
      </div>
    );
  }

  if (!workflows?.length) {
    return (
      <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-foreground-subtle">
        No workflow runs yet. Trigger a workflow to get started.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {workflows.slice(0, 20).map((run) => (
        <Link
          key={run.runId}
          href={`/workflows/${run.runId}`}
          className="flex items-center justify-between rounded-lg border border-border bg-background-secondary p-4 transition-colors hover:border-border-hover"
        >
          <div className="flex items-center gap-4">
            <StatusBadge status={run.status} />
            <div>
              <p className="text-sm font-medium text-foreground">{run.workflowId}</p>
              <p className="text-xs text-foreground-subtle">{run.runId}</p>
            </div>
          </div>

          <div className="flex items-center gap-6 text-xs text-foreground-subtle">
            <span>{run.nodeCount} nodes</span>
            <span>{new Date(run.startedAt).toLocaleTimeString()}</span>
            {run.completedAt && (
              <span>
                {Math.round(
                  (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000
                )}s
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
