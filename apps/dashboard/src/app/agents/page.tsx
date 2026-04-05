'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StatusBadge } from '@/components/shared/StatusBadge';

export default function AgentsPage() {
  const { data: agents, isLoading, error } = useQuery({
    queryKey: ['agents'],
    queryFn: api.agents.list,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Agent Catalog</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {error ? (
          <p className="col-span-full text-center text-error py-8">Failed to load agents: {error.message}</p>
        ) : isLoading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg border border-border bg-background-secondary" />
          ))
        ) : !agents?.length ? (
          <p className="col-span-full text-center text-foreground-subtle py-8">No agents defined yet.</p>
        ) : (
          agents.map((agent) => (
            <div key={agent.id} className="rounded-lg border border-border bg-background-secondary p-4 hover:border-border-hover transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-foreground">{agent.name}</h3>
                  <p className="text-xs text-foreground-subtle mt-0.5">{agent.id} v{agent.version}</p>
                </div>
                <StatusBadge status={agent.status} />
              </div>

              <div className="mt-4 space-y-2 text-xs text-foreground-muted">
                <div className="flex justify-between">
                  <span>Provider</span>
                  <span className="text-foreground">{agent.provider}</span>
                </div>
                <div className="flex justify-between">
                  <span>Model</span>
                  <span className="text-foreground font-mono">{agent.model}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
