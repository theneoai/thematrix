'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/shared/Button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useNotificationStore } from '@/stores/notifications';
import type { WorkflowRunDetail, WorkflowNodeInfo, DomainEventDTO } from '@/lib/api-client';
import { DAGVisualization } from '@/components/workflow/DAGVisualization';
import Link from 'next/link';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(startedAt: string, completedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ${secs}s`;
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString();
}

// ─── Collapsible JSON Viewer ────────────────────────────────────────────────

function JsonViewer({ label, data }: { label: string; data: unknown }) {
  const [open, setOpen] = useState(false);

  if (data === undefined || data === null) return null;

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-background-secondary/50 transition-colors"
      >
        <span>{label}</span>
        <span className="text-foreground-subtle text-xs">
          {open ? 'Collapse' : 'Expand'}
        </span>
      </button>
      {open && (
        <div className="border-t border-border bg-background-secondary px-4 py-3">
          <pre className="overflow-auto text-xs text-foreground-muted leading-relaxed max-h-80">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Node Row ───────────────────────────────────────────────────────────────

function NodeRow({ node }: { node: WorkflowNodeInfo }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-4 px-4 py-3 text-left text-sm hover:bg-background-secondary/50 transition-colors"
      >
        <span className="font-mono text-xs text-foreground-muted w-32 shrink-0 truncate" title={node.id}>
          {node.id}
        </span>
        <span className="text-foreground w-28 shrink-0 truncate">{node.type}</span>
        <span className="text-foreground-muted w-28 shrink-0 truncate">{node.agentId}</span>
        <span className="w-24 shrink-0">
          <StatusBadge status={node.status} />
        </span>
        <span className="text-foreground-subtle text-xs flex-1 text-right">
          {node.startedAt
            ? node.completedAt
              ? formatDuration(node.startedAt, node.completedAt)
              : 'Running...'
            : 'Pending'}
        </span>
        <span className="text-foreground-subtle text-xs w-6 text-right">
          {expanded ? '\u25B2' : '\u25BC'}
        </span>
      </button>
      {expanded && (
        <div className="bg-background-secondary px-4 py-3 space-y-2 text-xs">
          {node.startedAt && (
            <div className="flex gap-4">
              <span className="text-foreground-subtle w-20">Started</span>
              <span className="text-foreground-muted">{formatTimestamp(node.startedAt)}</span>
            </div>
          )}
          {node.completedAt && (
            <div className="flex gap-4">
              <span className="text-foreground-subtle w-20">Completed</span>
              <span className="text-foreground-muted">{formatTimestamp(node.completedAt)}</span>
            </div>
          )}
          {node.error && (
            <div className="flex gap-4">
              <span className="text-error w-20">Error</span>
              <span className="text-error">{node.error}</span>
            </div>
          )}
          {node.output !== undefined && node.output !== null && (
            <div>
              <span className="text-foreground-subtle block mb-1">Output</span>
              <pre className="overflow-auto text-foreground-muted bg-background-tertiary rounded p-2 max-h-48">
                {typeof node.output === 'string' ? node.output : JSON.stringify(node.output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Event Timeline ─────────────────────────────────────────────────────────

function EventTimeline({ events }: { events: DomainEventDTO[] }) {
  if (!events.length) {
    return (
      <p className="px-4 py-8 text-center text-sm text-foreground-subtle">
        No events recorded for this run
      </p>
    );
  }

  return (
    <div className="relative pl-6">
      <div className="absolute left-2.5 top-0 bottom-0 w-px bg-border" />
      {events.map((event) => (
        <div key={event.eventId} className="relative pb-4 last:pb-0">
          <div className="absolute left-[-16px] top-1.5 h-2 w-2 rounded-full bg-accent" />
          <div className="ml-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground">{event.type}</span>
              <span className="text-xs text-foreground-subtle">
                {formatTimestamp(event.timestamp)}
              </span>
            </div>
            {event.payload != null && (
              <pre className="mt-1 overflow-auto text-xs text-foreground-muted max-h-24 leading-relaxed">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function WorkflowDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const {
    data: workflow,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['workflow', runId],
    queryFn: () => api.workflows.get(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'running' || status === 'paused' ? 3000 : false;
    },
  });

  const { data: events = [] } = useQuery({
    queryKey: ['workflow-events', runId],
    queryFn: () => api.workflows.events(runId),
    refetchInterval: (query) => {
      return workflow?.status === 'running' || workflow?.status === 'paused' ? 5000 : false;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['workflow', runId] });
    queryClient.invalidateQueries({ queryKey: ['workflow-events', runId] });
  };

  const pauseMutation = useMutation({
    mutationFn: () => api.workflows.pause(runId),
    onSuccess: () => {
      addNotification('success', 'Workflow paused');
      invalidate();
    },
    onError: (err: Error) => addNotification('error', 'Failed to pause workflow', err.message),
  });

  const resumeMutation = useMutation({
    mutationFn: () => api.workflows.resume(runId),
    onSuccess: () => {
      addNotification('success', 'Workflow resumed');
      invalidate();
    },
    onError: (err: Error) => addNotification('error', 'Failed to resume workflow', err.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.workflows.cancel(runId),
    onSuccess: () => {
      addNotification('success', 'Workflow cancelled');
      setCancelDialogOpen(false);
      invalidate();
    },
    onError: (err: Error) => {
      addNotification('error', 'Failed to cancel workflow', err.message);
      setCancelDialogOpen(false);
    },
  });

  // ── Loading / Error states ──────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <span className="ml-3 text-sm text-foreground-subtle">Loading workflow run...</span>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="space-y-4 py-10 text-center">
        <p className="text-error text-sm">
          {error ? `Failed to load workflow: ${(error as Error).message}` : 'Workflow not found'}
        </p>
        <Link href="/workflows" className="text-accent text-sm hover:underline">
          Back to Workflows
        </Link>
      </div>
    );
  }

  const isActive = workflow.status === 'running' || workflow.status === 'paused';

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link
              href="/workflows"
              className="text-foreground-subtle hover:text-foreground text-sm transition-colors"
            >
              Workflows
            </Link>
            <span className="text-foreground-subtle">/</span>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">{workflow.workflowId}</h1>
          <p className="font-mono text-xs text-foreground-subtle">Run {workflow.runId}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={workflow.status} />
          {workflow.status === 'running' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => pauseMutation.mutate()}
              loading={pauseMutation.isPending}
            >
              Pause
            </Button>
          )}
          {workflow.status === 'paused' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => resumeMutation.mutate()}
              loading={resumeMutation.isPending}
            >
              Resume
            </Button>
          )}
          {isActive && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setCancelDialogOpen(true)}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {workflow.error && (
        <div className="rounded-lg border border-error/30 bg-error/5 px-4 py-3">
          <h3 className="text-sm font-medium text-error">Workflow Error</h3>
          <p className="mt-1 text-sm text-error/80">{workflow.error}</p>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-background-secondary px-4 py-3">
          <p className="text-xs text-foreground-subtle">Duration</p>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {formatDuration(workflow.startedAt, workflow.completedAt)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background-secondary px-4 py-3">
          <p className="text-xs text-foreground-subtle">Nodes</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{workflow.nodeCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-background-secondary px-4 py-3">
          <p className="text-xs text-foreground-subtle">Started</p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {formatTimestamp(workflow.startedAt)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background-secondary px-4 py-3">
          <p className="text-xs text-foreground-subtle">Completed</p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {workflow.completedAt ? formatTimestamp(workflow.completedAt) : '\u2014'}
          </p>
        </div>
      </div>

      {/* Input / Output */}
      <div className="space-y-3">
        <JsonViewer label="Input" data={workflow.input} />
        <JsonViewer label="Output" data={workflow.output} />
      </div>

      {/* DAG Visualization */}
      {workflow.nodes && workflow.nodes.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Execution Graph</h2>
          <div className="rounded-lg border border-border bg-background-secondary overflow-x-auto">
            <DAGVisualization nodes={workflow.nodes} />
          </div>
        </section>
      )}

      {/* Node List */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Nodes</h2>
        <div className="rounded-lg border border-border">
          {/* Column headers */}
          <div className="flex items-center gap-4 border-b border-border bg-background-secondary px-4 py-2 text-xs font-medium text-foreground-subtle">
            <span className="w-32 shrink-0">ID</span>
            <span className="w-28 shrink-0">Type</span>
            <span className="w-28 shrink-0">Agent</span>
            <span className="w-24 shrink-0">Status</span>
            <span className="flex-1 text-right">Duration</span>
            <span className="w-6" />
          </div>
          {workflow.nodes?.length ? (
            workflow.nodes.map((node) => <NodeRow key={node.id} node={node} />)
          ) : (
            <p className="px-4 py-8 text-center text-sm text-foreground-subtle">
              No node information available
            </p>
          )}
        </div>
      </section>

      {/* Event Timeline */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Event Timeline</h2>
        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <EventTimeline events={events} />
        </div>
      </section>

      {/* Cancel Confirmation Dialog */}
      <ConfirmDialog
        open={cancelDialogOpen}
        onClose={() => setCancelDialogOpen(false)}
        onConfirm={() => cancelMutation.mutate()}
        title="Cancel Workflow"
        message="Are you sure you want to cancel this workflow run? This action cannot be undone and any in-progress nodes will be terminated."
        confirmLabel="Cancel Workflow"
        variant="danger"
        loading={cancelMutation.isPending}
      />
    </div>
  );
}
