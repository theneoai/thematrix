'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/shared/Button';
import { Modal } from '@/components/shared/Modal';
import { FormField, inputClassName } from '@/components/shared/FormField';
import { EmptyState } from '@/components/shared/EmptyState';
import { useNotificationStore } from '@/stores/notifications';
import Link from 'next/link';

interface ApprovalInfo {
  id: string;
  workflowRunId: string;
  nodeId: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected' | 'timed_out';
  requestedAt: string;
  respondedAt?: string;
  respondedBy?: string;
}

type FilterTab = 'all' | 'pending' | 'approved' | 'rejected';

const filterTabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const statusMap: Record<string, string> = {
  approved: 'completed',
  rejected: 'failed',
  timed_out: 'cancelled',
  pending: 'pending',
};

export default function ApprovalsPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [approveModal, setApproveModal] = useState<ApprovalInfo | null>(null);
  const [rejectModal, setRejectModal] = useState<ApprovalInfo | null>(null);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');

  const notify = useNotificationStore((s) => s.addNotification);
  const queryClient = useQueryClient();

  const { data: approvals, isLoading, error } = useQuery<ApprovalInfo[]>({
    queryKey: ['approvals'],
    queryFn: api.approvals.list,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) =>
      api.approvals.approve(id, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      notify('success', 'Approval submitted', 'The request has been approved.');
      setApproveModal(null);
      setComment('');
    },
    onError: (err: Error) => {
      notify('error', 'Approval failed', err.message);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.approvals.reject(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      notify('success', 'Rejection submitted', 'The request has been rejected.');
      setRejectModal(null);
      setReason('');
    },
    onError: (err: Error) => {
      notify('error', 'Rejection failed', err.message);
    },
  });

  const pendingCount = approvals?.filter((a) => a.status === 'pending').length ?? 0;

  const filtered = approvals?.filter((a) => {
    if (activeTab === 'all') return true;
    return a.status === activeTab;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">Approval Requests</h1>
        {pendingCount > 0 && (
          <span className="rounded-full bg-warning/20 px-2.5 py-0.5 text-xs font-medium text-warning">
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-background-tertiary p-1">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-background-secondary text-foreground shadow-sm'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {error ? (
        <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-error">
          Failed to load approvals: {error.message}
        </div>
      ) : isLoading ? (
        <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-foreground-subtle">
          Loading approvals...
        </div>
      ) : !filtered?.length ? (
        <EmptyState
          icon="✓"
          title="No approval requests"
          description={activeTab === 'all' ? 'No approval requests found.' : `No ${activeTab} approval requests.`}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((approval) => (
            <div
              key={approval.id}
              className="rounded-lg border border-border bg-background-secondary p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Link
                      href={`/workflows/${approval.workflowRunId}`}
                      className="text-sm font-medium text-accent hover:underline"
                    >
                      Run {approval.workflowRunId}
                    </Link>
                    <span className="text-xs text-foreground-subtle">
                      Node: <span className="font-mono">{approval.nodeId}</span>
                    </span>
                    <StatusBadge status={statusMap[approval.status] ?? approval.status} />
                  </div>

                  <p className="text-sm text-foreground-muted">{approval.message}</p>

                  <div className="flex items-center gap-4 text-xs text-foreground-subtle">
                    <span>
                      Requested: {new Date(approval.requestedAt).toLocaleString()}
                    </span>
                    {approval.respondedAt && (
                      <span>
                        Responded: {new Date(approval.respondedAt).toLocaleString()}
                      </span>
                    )}
                    {approval.respondedBy && (
                      <span>By: {approval.respondedBy}</span>
                    )}
                  </div>
                </div>

                {approval.status === 'pending' && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      className="bg-success border-success hover:bg-success/80"
                      onClick={() => {
                        setComment('');
                        setApproveModal(approval);
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        setReason('');
                        setRejectModal(approval);
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Approve Modal */}
      <Modal
        open={!!approveModal}
        onClose={() => setApproveModal(null)}
        title="Approve Request"
        description={approveModal ? `Approve request for run ${approveModal.workflowRunId}` : ''}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setApproveModal(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              className="bg-success border-success hover:bg-success/80"
              loading={approveMutation.isPending}
              onClick={() => {
                if (approveModal) {
                  approveMutation.mutate({
                    id: approveModal.id,
                    comment: comment || undefined,
                  });
                }
              }}
            >
              Approve
            </Button>
          </>
        }
      >
        <FormField label="Comment" htmlFor="approve-comment" hint="Optional comment for this approval.">
          <textarea
            id="approve-comment"
            className={inputClassName}
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add an optional comment..."
          />
        </FormField>
      </Modal>

      {/* Reject Modal */}
      <Modal
        open={!!rejectModal}
        onClose={() => setRejectModal(null)}
        title="Reject Request"
        description={rejectModal ? `Reject request for run ${rejectModal.workflowRunId}` : ''}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRejectModal(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={rejectMutation.isPending}
              onClick={() => {
                if (rejectModal) {
                  rejectMutation.mutate({
                    id: rejectModal.id,
                    reason: reason || undefined,
                  });
                }
              }}
            >
              Reject
            </Button>
          </>
        }
      >
        <FormField label="Reason" htmlFor="reject-reason" hint="Optional reason for this rejection.">
          <textarea
            id="reject-reason"
            className={inputClassName}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Add an optional reason..."
          />
        </FormField>
      </Modal>
    </div>
  );
}
