'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StatusBadge } from '@/components/shared/StatusBadge';
import Link from 'next/link';

export default function WorkflowsPage() {
  const { data: workflows, isLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: api.workflows.list,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Workflows</h1>
        <div className="flex gap-2">
          <select className="rounded-md border border-border bg-background-secondary px-3 py-1.5 text-sm text-foreground-muted">
            <option value="all">All Status</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background-secondary text-left text-foreground-subtle">
              <th className="px-4 py-3 font-medium">Run ID</th>
              <th className="px-4 py-3 font-medium">Workflow</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Nodes</th>
              <th className="px-4 py-3 font-medium">Started</th>
              <th className="px-4 py-3 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-foreground-subtle">
                  Loading workflows...
                </td>
              </tr>
            ) : !workflows?.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-foreground-subtle">
                  No workflow runs found
                </td>
              </tr>
            ) : (
              workflows.map((run) => (
                <tr key={run.runId} className="border-b border-border last:border-0 hover:bg-background-secondary/50">
                  <td className="px-4 py-3">
                    <Link href={`/workflows/${run.runId}`} className="text-accent hover:underline font-mono text-xs">
                      {run.runId.slice(0, 12)}...
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-foreground">{run.workflowId}</td>
                  <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                  <td className="px-4 py-3 text-foreground-muted">{run.nodeCount}</td>
                  <td className="px-4 py-3 text-foreground-muted">{new Date(run.startedAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {run.completedAt
                      ? `${Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s`
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
