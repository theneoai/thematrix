'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/shared/Button';
import { Modal } from '@/components/shared/Modal';
import { FormField, inputClassName, selectClassName } from '@/components/shared/FormField';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { useNotificationStore } from '@/stores/notifications';
import Link from 'next/link';

export default function WorkflowsPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [cancelRunId, setCancelRunId] = useState<string | null>(null);
  const [startForm, setStartForm] = useState({ workflowId: '', input: '' });
  const [startFormError, setStartFormError] = useState('');

  const notify = useNotificationStore((s) => s.addNotification);
  const queryClient = useQueryClient();

  const { data: workflows, isLoading, error } = useQuery({
    queryKey: ['workflows'],
    queryFn: api.workflows.list,
  });

  const startMutation = useMutation({
    mutationFn: ({ workflowId, input }: { workflowId: string; input?: Record<string, unknown> }) =>
      api.workflows.start(workflowId, input),
    onSuccess: (data) => {
      notify('success', 'Workflow started', `Run ID: ${data.runId}`);
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setStartModalOpen(false);
      setStartForm({ workflowId: '', input: '' });
      setStartFormError('');
    },
    onError: (err: Error) => {
      notify('error', 'Failed to start workflow', err.message);
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (runId: string) => api.workflows.pause(runId),
    onSuccess: (_data, runId) => {
      notify('success', 'Workflow paused', `Run ID: ${runId}`);
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (err: Error) => {
      notify('error', 'Failed to pause workflow', err.message);
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (runId: string) => api.workflows.resume(runId),
    onSuccess: (_data, runId) => {
      notify('success', 'Workflow resumed', `Run ID: ${runId}`);
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (err: Error) => {
      notify('error', 'Failed to resume workflow', err.message);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (runId: string) => api.workflows.cancel(runId),
    onSuccess: (_data, runId) => {
      notify('success', 'Workflow cancelled', `Run ID: ${runId}`);
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setCancelRunId(null);
    },
    onError: (err: Error) => {
      notify('error', 'Failed to cancel workflow', err.message);
      setCancelRunId(null);
    },
  });

  const filteredWorkflows = workflows?.filter((w) => {
    const matchesStatus = statusFilter === 'all' || w.status === statusFilter;
    const matchesSearch =
      !searchQuery || w.workflowId.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  function handleStartSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStartFormError('');

    if (!startForm.workflowId.trim()) {
      setStartFormError('Workflow ID is required');
      return;
    }

    let parsedInput: Record<string, unknown> | undefined = undefined;
    if (startForm.input.trim()) {
      try {
        parsedInput = JSON.parse(startForm.input);
      } catch {
        setStartFormError('Input must be valid JSON');
        return;
      }
    }

    startMutation.mutate({ workflowId: startForm.workflowId.trim(), input: parsedInput });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Workflows</h1>
        <Button variant="primary" onClick={() => setStartModalOpen(true)}>
          Start Workflow
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search by workflow ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="rounded-md border border-border bg-background-secondary px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-subtle outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-border bg-background-secondary px-3 py-1.5 text-sm text-foreground-muted"
        >
          <option value="all">All Status</option>
          <option value="running">Running</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* Table */}
      {error ? (
        <EmptyState
          title="Failed to load workflows"
          description={error.message}
        />
      ) : isLoading ? (
        <div className="rounded-lg border border-border bg-background-secondary px-4 py-12 text-center text-foreground-subtle">
          Loading workflows...
        </div>
      ) : !filteredWorkflows?.length ? (
        <EmptyState
          title="No workflow runs found"
          description={
            searchQuery || statusFilter !== 'all'
              ? 'Try adjusting your filters.'
              : 'Start a workflow to see it here.'
          }
          action={
            !searchQuery && statusFilter === 'all'
              ? { label: 'Start Workflow', onClick: () => setStartModalOpen(true) }
              : undefined
          }
        />
      ) : (
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
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredWorkflows.map((run) => (
                <tr
                  key={run.runId}
                  className="border-b border-border last:border-0 hover:bg-background-secondary/50"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/workflows/${run.runId}`}
                      className="text-accent hover:underline font-mono text-xs"
                    >
                      {run.runId.slice(0, 12)}...
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-foreground">{run.workflowId}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{run.nodeCount}</td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {new Date(run.startedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {run.completedAt
                      ? `${Math.round(
                          (new Date(run.completedAt).getTime() -
                            new Date(run.startedAt).getTime()) /
                            1000,
                        )}s`
                      : '\u2014'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {run.status === 'running' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => pauseMutation.mutate(run.runId)}
                            loading={
                              pauseMutation.isPending &&
                              pauseMutation.variables === run.runId
                            }
                          >
                            Pause
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setCancelRunId(run.runId)}
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                      {run.status === 'paused' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => resumeMutation.mutate(run.runId)}
                            loading={
                              resumeMutation.isPending &&
                              resumeMutation.variables === run.runId
                            }
                          >
                            Resume
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setCancelRunId(run.runId)}
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Start Workflow Modal */}
      <Modal
        open={startModalOpen}
        onClose={() => {
          setStartModalOpen(false);
          setStartForm({ workflowId: '', input: '' });
          setStartFormError('');
        }}
        title="Start Workflow"
        description="Provide a workflow ID and optional JSON input to start a new run."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setStartModalOpen(false);
                setStartForm({ workflowId: '', input: '' });
                setStartFormError('');
              }}
              disabled={startMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleStartSubmit}
              loading={startMutation.isPending}
            >
              Start
            </Button>
          </>
        }
      >
        <form onSubmit={handleStartSubmit} className="space-y-4">
          <FormField label="Workflow ID" htmlFor="workflowId" required>
            <input
              id="workflowId"
              type="text"
              className={inputClassName}
              placeholder="e.g. order-processing"
              value={startForm.workflowId}
              onChange={(e) =>
                setStartForm((f) => ({ ...f, workflowId: e.target.value }))
              }
            />
          </FormField>
          <FormField
            label="Input (JSON)"
            htmlFor="workflowInput"
            hint="Optional JSON payload to pass to the workflow."
            error={startFormError}
          >
            <textarea
              id="workflowInput"
              className={inputClassName + ' min-h-[100px] font-mono'}
              placeholder='{ "key": "value" }'
              value={startForm.input}
              onChange={(e) =>
                setStartForm((f) => ({ ...f, input: e.target.value }))
              }
            />
          </FormField>
        </form>
      </Modal>

      {/* Cancel Confirmation Dialog */}
      <ConfirmDialog
        open={cancelRunId !== null}
        onClose={() => setCancelRunId(null)}
        onConfirm={() => {
          if (cancelRunId) cancelMutation.mutate(cancelRunId);
        }}
        title="Cancel Workflow"
        message={`Are you sure you want to cancel run ${cancelRunId?.slice(0, 12)}...? This action cannot be undone.`}
        confirmLabel="Cancel Workflow"
        variant="danger"
        loading={cancelMutation.isPending}
      />
    </div>
  );
}
