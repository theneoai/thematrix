'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/shared/Button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useNotificationStore } from '@/stores/notifications';
import Link from 'next/link';

// ─── Info Row ──────────────────────────────────────────────────────────────

function InfoRow({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (value === undefined || value === null) return null;
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-foreground-muted">{label}</span>
      <span className={`text-foreground ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

// ─── Section Card ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-foreground">{title}</h2>
      <div className="rounded-lg border border-border bg-background-secondary p-4">
        {children}
      </div>
    </section>
  );
}

// ─── Tag List ──────────────────────────────────────────────────────────────

function TagList({ items }: { items?: string[] }) {
  if (!items?.length) {
    return <p className="text-sm text-foreground-subtle">None configured</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-md bg-background-tertiary px-2 py-0.5 text-xs font-mono text-foreground-muted"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id;
  const queryClient = useQueryClient();
  const notify = useNotificationStore((s) => s.addNotification);

  const [confirmAction, setConfirmAction] = useState<'pause' | 'resume' | 'stop' | 'unregister' | null>(null);

  const {
    data: agent,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => api.agents.get(agentId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
    queryClient.invalidateQueries({ queryKey: ['agents'] });
  };

  // ── Mutations ──────────────────────────────────────────────

  const pauseMutation = useMutation({
    mutationFn: () => api.agents.pause(agentId),
    onSuccess: () => {
      notify('success', 'Agent paused');
      setConfirmAction(null);
      invalidate();
    },
    onError: (err: Error) => {
      notify('error', 'Failed to pause agent', err.message);
      setConfirmAction(null);
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () => api.agents.resume(agentId),
    onSuccess: () => {
      notify('success', 'Agent resumed');
      setConfirmAction(null);
      invalidate();
    },
    onError: (err: Error) => {
      notify('error', 'Failed to resume agent', err.message);
      setConfirmAction(null);
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => api.agents.stop(agentId),
    onSuccess: () => {
      notify('success', 'Agent stopped');
      setConfirmAction(null);
      invalidate();
    },
    onError: (err: Error) => {
      notify('error', 'Failed to stop agent', err.message);
      setConfirmAction(null);
    },
  });

  const unregisterMutation = useMutation({
    mutationFn: () => api.agents.unregister(agentId),
    onSuccess: () => {
      notify('success', 'Agent unregistered', `${agentId} has been removed.`);
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      // Navigate back via window since we removed the agent
      window.location.href = '/agents';
    },
    onError: (err: Error) => {
      notify('error', 'Failed to unregister agent', err.message);
      setConfirmAction(null);
    },
  });

  // ── Confirm dialog config ─────────────────────────────────

  const confirmConfig: Record<string, { title: string; message: string; label: string; variant: 'danger' | 'warning' | 'default'; onConfirm: () => void; loading: boolean }> = {
    pause: {
      title: 'Pause Agent',
      message: `Are you sure you want to pause agent "${agent?.name ?? agentId}"? The agent will stop processing new turns until resumed.`,
      label: 'Pause',
      variant: 'warning',
      onConfirm: () => pauseMutation.mutate(),
      loading: pauseMutation.isPending,
    },
    resume: {
      title: 'Resume Agent',
      message: `Resume agent "${agent?.name ?? agentId}"? The agent will begin processing turns again.`,
      label: 'Resume',
      variant: 'default',
      onConfirm: () => resumeMutation.mutate(),
      loading: resumeMutation.isPending,
    },
    stop: {
      title: 'Stop Agent',
      message: `Are you sure you want to stop agent "${agent?.name ?? agentId}"? Any in-progress work will be terminated.`,
      label: 'Stop Agent',
      variant: 'danger',
      onConfirm: () => stopMutation.mutate(),
      loading: stopMutation.isPending,
    },
    unregister: {
      title: 'Unregister Agent',
      message: `Are you sure you want to unregister agent "${agent?.name ?? agentId}"? This will permanently remove the agent from the catalog. This action cannot be undone.`,
      label: 'Unregister',
      variant: 'danger',
      onConfirm: () => unregisterMutation.mutate(),
      loading: unregisterMutation.isPending,
    },
  };

  const activeConfirm = confirmAction ? confirmConfig[confirmAction] : null;

  // ── Loading / Error ────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <span className="ml-3 text-sm text-foreground-subtle">Loading agent details...</span>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="space-y-4 py-10 text-center">
        <p className="text-error text-sm">
          {error ? `Failed to load agent: ${(error as Error).message}` : 'Agent not found'}
        </p>
        <Link href="/agents" className="text-accent text-sm hover:underline">
          Back to Agents
        </Link>
      </div>
    );
  }

  const isActive = agent.status === 'running' || agent.status === 'paused';

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link
              href="/agents"
              className="text-foreground-subtle hover:text-foreground text-sm transition-colors"
            >
              Agents
            </Link>
            <span className="text-foreground-subtle">/</span>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">{agent.name}</h1>
          <p className="font-mono text-xs text-foreground-subtle">{agent.id}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={agent.status} />
          {agent.status === 'running' && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmAction('pause')}>
              Pause
            </Button>
          )}
          {agent.status === 'paused' && (
            <Button variant="primary" size="sm" onClick={() => setConfirmAction('resume')}>
              Resume
            </Button>
          )}
          {isActive && (
            <Button variant="danger" size="sm" onClick={() => setConfirmAction('stop')}>
              Stop
            </Button>
          )}
          {agent.status === 'stopped' && (
            <Button variant="primary" size="sm" onClick={() => setConfirmAction('resume')}>
              Resume
            </Button>
          )}
          <Button variant="danger" size="sm" onClick={() => setConfirmAction('unregister')}>
            Unregister
          </Button>
        </div>
      </div>

      {/* Agent Info */}
      <Section title="Agent Info">
        <div className="divide-y divide-border">
          <InfoRow label="Name" value={agent.name} />
          <InfoRow label="ID" value={agent.id} mono />
          <InfoRow label="Version" value={agent.version} />
          <InfoRow label="Status" value={agent.status} />
          <InfoRow label="Provider" value={agent.provider} />
          <InfoRow label="Model" value={agent.model} mono />
        </div>
      </Section>

      {/* Persona */}
      <Section title="Persona">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-foreground-subtle mb-1">Role</p>
            <p className="text-sm text-foreground">{agent.persona.role}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-foreground-subtle mb-1">Personality</p>
            <p className="text-sm text-foreground">
              {agent.persona.personality || <span className="text-foreground-subtle">Not specified</span>}
            </p>
          </div>
          {agent.persona.systemPrompt && (
            <div>
              <p className="text-xs font-medium text-foreground-subtle mb-1">System Prompt</p>
              <pre className="overflow-auto rounded-md bg-background-tertiary p-3 text-xs text-foreground-muted leading-relaxed max-h-48">
                {agent.persona.systemPrompt}
              </pre>
            </div>
          )}
        </div>
      </Section>

      {/* Metrics */}
      <Section title="Metrics">
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-border bg-background-tertiary px-4 py-3 text-center">
            <p className="text-xs text-foreground-subtle">Total Turns</p>
            <p className="mt-1 text-xl font-semibold text-foreground">
              {agent.metrics.totalTurns.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background-tertiary px-4 py-3 text-center">
            <p className="text-xs text-foreground-subtle">Total Tokens</p>
            <p className="mt-1 text-xl font-semibold text-foreground">
              {agent.metrics.totalTokens.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background-tertiary px-4 py-3 text-center">
            <p className="text-xs text-foreground-subtle">Errors</p>
            <p className={`mt-1 text-xl font-semibold ${agent.metrics.errors > 0 ? 'text-error' : 'text-foreground'}`}>
              {agent.metrics.errors.toLocaleString()}
            </p>
          </div>
        </div>
      </Section>

      {/* Configuration */}
      <Section title="Configuration">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-foreground-subtle mb-2">Tools</p>
            <TagList items={agent.tools} />
          </div>

          <div>
            <p className="text-xs font-medium text-foreground-subtle mb-2">Guardrails</p>
            <TagList items={agent.guardrails} />
          </div>

          {agent.loopConfig && (
            <div>
              <p className="text-xs font-medium text-foreground-subtle mb-1">Loop Config</p>
              <div className="divide-y divide-border">
                <InfoRow label="Mode" value={agent.loopConfig.mode} />
                <InfoRow label="Max Iterations" value={agent.loopConfig.maxIterations} />
              </div>
            </div>
          )}

          {agent.memoryConfig && (
            <div>
              <p className="text-xs font-medium text-foreground-subtle mb-1">Memory Config</p>
              <div className="divide-y divide-border">
                <InfoRow label="Persist History" value={agent.memoryConfig.persistHistory ? 'Yes' : 'No'} />
                <InfoRow label="Max History Turns" value={agent.memoryConfig.maxHistoryTurns} />
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Confirmation Dialog */}
      {activeConfirm && (
        <ConfirmDialog
          open={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={activeConfirm.onConfirm}
          title={activeConfirm.title}
          message={activeConfirm.message}
          confirmLabel={activeConfirm.label}
          variant={activeConfirm.variant}
          loading={activeConfirm.loading}
        />
      )}
    </div>
  );
}
