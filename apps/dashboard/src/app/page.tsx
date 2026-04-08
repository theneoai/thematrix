'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MetricsGrid } from '@/components/monitoring/MetricsGrid';
import { RunTimeline } from '@/components/workflow/RunTimeline';
import { useEventStream } from '@/lib/use-event-stream';

export default function DashboardPage() {
  const queryClient = useQueryClient();

  // Real-time SSE connection for live updates
  const handleEvent = useCallback((event: { type: string; data: unknown }) => {
    // Invalidate relevant queries when events arrive
    if (event.type.startsWith('workflow.')) {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    }
    if (event.type.startsWith('agent.')) {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    }
    if (event.type.startsWith('token.')) {
      queryClient.invalidateQueries({ queryKey: ['token-usage'] });
    }
    if (event.type.startsWith('cluster.')) {
      queryClient.invalidateQueries({ queryKey: ['cluster-health'] });
    }
    if (event.type.startsWith('alert.')) {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    }
  }, [queryClient]);

  const { connected } = useEventStream({ onEvent: handleEvent });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-foreground-muted mt-1">Multi-Agent Cluster System Overview</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-foreground-subtle">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-foreground-subtle'}`} />
          {connected ? 'Live' : 'Polling'}
        </div>
      </div>

      <MetricsGrid />

      <div>
        <h2 className="text-lg font-medium text-foreground mb-4">Recent Workflow Runs</h2>
        <RunTimeline />
      </div>
    </div>
  );
}
