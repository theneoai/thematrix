'use client';

import { MetricsGrid } from '@/components/monitoring/MetricsGrid';
import { RunTimeline } from '@/components/workflow/RunTimeline';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-foreground-muted mt-1">Multi-Agent Cluster System Overview</p>
      </div>

      <MetricsGrid />

      <div>
        <h2 className="text-lg font-medium text-foreground mb-4">Recent Workflow Runs</h2>
        <RunTimeline />
      </div>
    </div>
  );
}
