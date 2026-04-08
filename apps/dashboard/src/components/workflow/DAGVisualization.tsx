'use client';

import { useMemo } from 'react';
import type { WorkflowNodeInfo } from '@/lib/api-client';

interface DAGVisualizationProps {
  nodes: WorkflowNodeInfo[];
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'border-success bg-success/10 text-success',
  running: 'border-accent bg-accent/10 text-accent',
  failed: 'border-error bg-error/10 text-error',
  pending: 'border-border bg-background-tertiary text-foreground-subtle',
  paused: 'border-warning bg-warning/10 text-warning',
  cancelled: 'border-foreground-subtle bg-background-tertiary text-foreground-muted',
};

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-success',
  running: 'bg-accent animate-pulse',
  failed: 'bg-error',
  pending: 'bg-foreground-subtle',
  paused: 'bg-warning',
  cancelled: 'bg-foreground-subtle',
};

/**
 * Simple DAG visualization of workflow nodes showing
 * the execution topology with status indicators.
 */
export function DAGVisualization({ nodes }: DAGVisualizationProps) {
  // Group nodes by their execution phase (based on timing or sequential order)
  const phases = useMemo(() => {
    if (!nodes.length) return [];

    // Sort by start time, falling back to array order for pending nodes
    const sorted = [...nodes].sort((a, b) => {
      if (!a.startedAt && !b.startedAt) return 0;
      if (!a.startedAt) return 1;
      if (!b.startedAt) return -1;
      return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
    });

    // Group into phases: nodes that overlap in time go in the same phase
    const result: WorkflowNodeInfo[][] = [];
    let currentPhase: WorkflowNodeInfo[] = [];
    let phaseEndTime = 0;

    for (const node of sorted) {
      const startTime = node.startedAt ? new Date(node.startedAt).getTime() : Infinity;

      if (currentPhase.length === 0 || startTime < phaseEndTime) {
        // Overlaps with current phase (parallel execution)
        currentPhase.push(node);
      } else {
        // New phase (sequential execution)
        if (currentPhase.length > 0) result.push(currentPhase);
        currentPhase = [node];
      }

      const endTime = node.completedAt
        ? new Date(node.completedAt).getTime()
        : startTime + 1000;
      phaseEndTime = Math.max(phaseEndTime, endTime);
    }

    if (currentPhase.length > 0) result.push(currentPhase);
    return result;
  }, [nodes]);

  if (!nodes.length) {
    return (
      <p className="px-4 py-8 text-center text-sm text-foreground-subtle">
        No nodes to visualize
      </p>
    );
  }

  return (
    <div className="flex items-start gap-0 overflow-x-auto py-4 px-2">
      {phases.map((phase, phaseIdx) => (
        <div key={phaseIdx} className="flex items-center shrink-0">
          {/* Phase nodes (vertically stacked for parallel) */}
          <div className="flex flex-col gap-2">
            {phase.map((node) => {
              const colorClass = STATUS_COLORS[node.status] ?? STATUS_COLORS.pending;
              const dotClass = STATUS_DOT[node.status] ?? STATUS_DOT.pending;

              return (
                <div
                  key={node.id}
                  className={`rounded-lg border-2 px-3 py-2 min-w-[140px] max-w-[180px] ${colorClass}`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
                    <span className="text-xs font-semibold truncate">{node.id}</span>
                  </div>
                  <div className="text-[10px] text-foreground-muted truncate">
                    {node.type}
                  </div>
                  <div className="text-[10px] text-foreground-subtle truncate font-mono">
                    {node.agentId}
                  </div>
                  {node.error && (
                    <div className="text-[10px] text-error mt-1 truncate" title={node.error}>
                      {node.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Connector arrow between phases */}
          {phaseIdx < phases.length - 1 && (
            <div className="flex items-center px-2 shrink-0">
              <div className="h-px w-6 bg-border" />
              <div className="h-0 w-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-border" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
