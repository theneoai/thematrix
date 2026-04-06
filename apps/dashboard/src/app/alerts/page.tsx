'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/shared/Button';
import { Modal } from '@/components/shared/Modal';
import { FormField, inputClassName, selectClassName } from '@/components/shared/FormField';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useNotificationStore } from '@/stores/notifications';

const severityColors: Record<string, string> = {
  critical: 'text-error',
  warning: 'text-warning',
  info: 'text-accent',
};

const severityIcon = (severity: string) => {
  switch (severity) {
    case 'critical': return '●';
    case 'warning': return '▲';
    default: return 'ℹ';
  }
};

interface RuleFormData {
  name: string;
  metric: string;
  severity: 'info' | 'warning' | 'critical';
  condition: string;
  threshold: string;
  enabled: boolean;
}

const emptyForm: RuleFormData = {
  name: '',
  metric: '',
  severity: 'warning',
  condition: '',
  threshold: '',
  enabled: true,
};

type AlertTab = 'active' | 'history' | 'rules';

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const notify = useNotificationStore((s) => s.addNotification);
  const [activeTab, setActiveTab] = useState<AlertTab>('active');

  const { data: alerts, isLoading: alertsLoading, error: alertsError } = useQuery({
    queryKey: ['alerts'],
    queryFn: api.alerts.active,
  });
  const { data: alertHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['alert-history'],
    queryFn: api.alerts.history,
    enabled: activeTab === 'history',
  });
  const { data: rules, isLoading: rulesLoading, error: rulesError } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: api.alerts.rules,
  });

  // --- Modal / dialog state ---
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleFormData>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // --- Mutations ---
  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => api.alerts.acknowledge(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      notify('success', 'Alert acknowledged');
    },
    onError: () => notify('error', 'Failed to acknowledge alert'),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.alerts.resolve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      notify('success', 'Alert resolved');
    },
    onError: () => notify('error', 'Failed to resolve alert'),
  });

  const createRuleMutation = useMutation({
    mutationFn: (rule: typeof ruleForm) =>
      api.alerts.createRule({
        name: rule.name,
        metric: rule.metric,
        severity: rule.severity,
        enabled: rule.enabled,
        condition: rule.condition || undefined,
        threshold: rule.threshold ? Number(rule.threshold) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      notify('success', 'Rule created');
      closeRuleModal();
    },
    onError: () => notify('error', 'Failed to create rule'),
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, rule }: { id: string; rule: typeof ruleForm }) =>
      api.alerts.updateRule(id, {
        name: rule.name,
        metric: rule.metric,
        severity: rule.severity,
        enabled: rule.enabled,
        condition: rule.condition || undefined,
        threshold: rule.threshold ? Number(rule.threshold) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      notify('success', 'Rule updated');
      closeRuleModal();
    },
    onError: () => notify('error', 'Failed to update rule'),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id: string) => api.alerts.deleteRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      notify('success', 'Rule deleted');
      setDeleteTarget(null);
    },
    onError: () => notify('error', 'Failed to delete rule'),
  });

  const toggleRuleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.alerts.toggleRule(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
    },
    onError: () => notify('error', 'Failed to toggle rule'),
  });

  // --- Helpers ---
  function openCreateModal() {
    setEditingRuleId(null);
    setRuleForm(emptyForm);
    setRuleModalOpen(true);
  }

  function openEditModal(rule: { id: string; name: string; metric: string; severity: string; enabled: boolean; condition?: string; threshold?: number }) {
    setEditingRuleId(rule.id);
    setRuleForm({
      name: rule.name,
      metric: rule.metric,
      severity: rule.severity as RuleFormData['severity'],
      condition: rule.condition ?? '',
      threshold: rule.threshold != null ? String(rule.threshold) : '',
      enabled: rule.enabled,
    });
    setRuleModalOpen(true);
  }

  function closeRuleModal() {
    setRuleModalOpen(false);
    setEditingRuleId(null);
    setRuleForm(emptyForm);
  }

  function handleRuleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingRuleId) {
      updateRuleMutation.mutate({ id: editingRuleId, rule: ruleForm });
    } else {
      createRuleMutation.mutate(ruleForm);
    }
  }

  const isSaving = createRuleMutation.isPending || updateRuleMutation.isPending;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-foreground">Alerts & Notifications</h1>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg bg-background-tertiary p-1">
        {([
          { key: 'active' as const, label: 'Active Alerts', count: alerts?.length },
          { key: 'history' as const, label: 'History' },
          { key: 'rules' as const, label: 'Alert Rules', count: rules?.length },
        ]).map((tab) => (
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
            {tab.count ? (
              <span className="ml-1.5 rounded-full bg-error/20 px-1.5 py-0.5 text-[10px] text-error">
                {tab.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ========== Active Alerts ========== */}
      {activeTab === 'active' && <section>
        <h2 className="text-lg font-medium mb-4 text-foreground">
          Active Alerts
          {alerts?.length ? (
            <span className="ml-2 rounded-full bg-error/20 px-2 py-0.5 text-xs text-error">
              {alerts.length}
            </span>
          ) : null}
        </h2>

        {alertsLoading ? (
          <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-foreground-subtle">
            Loading alerts...
          </div>
        ) : alertsError ? (
          <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-error">
            Failed to load alerts: {alertsError.message}
          </div>
        ) : !alerts?.length ? (
          <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-foreground-subtle">
            No active alerts. All systems healthy.
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div key={alert.id} className="rounded-lg border border-border bg-background-secondary p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`text-lg ${severityColors[alert.severity] ?? 'text-accent'}`}>
                      {severityIcon(alert.severity)}
                    </span>
                    <div>
                      <h3 className="font-medium text-foreground">{alert.title}</h3>
                      <p className="text-xs text-foreground-muted mt-0.5">{alert.message}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={alert.status} />
                    <span className="text-xs text-foreground-subtle">
                      {new Date(alert.firedAt).toLocaleTimeString()}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => acknowledgeMutation.mutate(alert.id)}
                      loading={acknowledgeMutation.isPending && acknowledgeMutation.variables === alert.id}
                      disabled={alert.status === 'acknowledged'}
                    >
                      Acknowledge
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => resolveMutation.mutate(alert.id)}
                      loading={resolveMutation.isPending && resolveMutation.variables === alert.id}
                      disabled={alert.status === 'resolved'}
                    >
                      Resolve
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>}

      {/* ========== Alert History ========== */}
      {activeTab === 'history' && (
        <section>
          <h2 className="text-lg font-medium mb-4 text-foreground">Alert History</h2>
          {historyLoading ? (
            <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-foreground-subtle">
              Loading history...
            </div>
          ) : !alertHistory?.length ? (
            <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-foreground-subtle">
              No alert history found.
            </div>
          ) : (
            <div className="space-y-2">
              {alertHistory.map((alert) => (
                <div key={alert.id} className="rounded-lg border border-border bg-background-secondary p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`text-lg ${severityColors[alert.severity] ?? 'text-accent'}`}>
                        {severityIcon(alert.severity)}
                      </span>
                      <div>
                        <h3 className="font-medium text-foreground">{alert.title}</h3>
                        <p className="text-xs text-foreground-muted mt-0.5">{alert.message}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={alert.status} />
                      <span className="text-xs text-foreground-subtle">
                        {new Date(alert.firedAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ========== Alert Rules ========== */}
      {activeTab === 'rules' && <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-foreground">Alert Rules</h2>
          <Button variant="primary" onClick={openCreateModal}>
            Create Rule
          </Button>
        </div>

        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary text-left text-foreground-subtle">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Metric</th>
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rulesLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-foreground-subtle">
                    Loading rules...
                  </td>
                </tr>
              ) : rulesError ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-error">
                    Failed to load rules: {rulesError.message}
                  </td>
                </tr>
              ) : !rules?.length ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-foreground-subtle">
                    No alert rules configured.
                  </td>
                </tr>
              ) : (
                rules.map((rule) => (
                  <tr key={rule.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-foreground">{rule.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground-muted">{rule.metric}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${severityColors[rule.severity]}`}>
                        {rule.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={rule.enabled ? 'online' : 'offline'} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {/* Enable / Disable toggle */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={rule.enabled}
                          onClick={() => toggleRuleMutation.mutate({ id: rule.id, enabled: !rule.enabled })}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                            rule.enabled ? 'bg-accent' : 'bg-background-tertiary'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                              rule.enabled ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                        <Button size="sm" variant="ghost" onClick={() => openEditModal(rule)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setDeleteTarget({ id: rule.id, name: rule.name })}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>}

      {/* ========== Create / Edit Rule Modal ========== */}
      <Modal
        open={ruleModalOpen}
        onClose={closeRuleModal}
        title={editingRuleId ? 'Edit Rule' : 'Create Rule'}
        description={editingRuleId ? 'Update the alert rule configuration.' : 'Define a new alert rule.'}
        footer={
          <>
            <Button variant="ghost" onClick={closeRuleModal} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleRuleSubmit} loading={isSaving}>
              {editingRuleId ? 'Save Changes' : 'Create Rule'}
            </Button>
          </>
        }
      >
        <form id="rule-form" onSubmit={handleRuleSubmit} className="space-y-4">
          <FormField label="Name" htmlFor="rule-name" required>
            <input
              id="rule-name"
              className={inputClassName}
              value={ruleForm.name}
              onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. High CPU Usage"
              required
            />
          </FormField>

          <FormField label="Metric" htmlFor="rule-metric" required>
            <input
              id="rule-metric"
              className={inputClassName}
              value={ruleForm.metric}
              onChange={(e) => setRuleForm((f) => ({ ...f, metric: e.target.value }))}
              placeholder="e.g. cpu_usage_percent"
              required
            />
          </FormField>

          <FormField label="Severity" htmlFor="rule-severity" required>
            <select
              id="rule-severity"
              className={selectClassName}
              value={ruleForm.severity}
              onChange={(e) => setRuleForm((f) => ({ ...f, severity: e.target.value as RuleFormData['severity'] }))}
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </FormField>

          <FormField label="Condition" htmlFor="rule-condition" hint="e.g. greater_than, less_than, equals">
            <input
              id="rule-condition"
              className={inputClassName}
              value={ruleForm.condition}
              onChange={(e) => setRuleForm((f) => ({ ...f, condition: e.target.value }))}
              placeholder="e.g. greater_than"
            />
          </FormField>

          <FormField label="Threshold" htmlFor="rule-threshold">
            <input
              id="rule-threshold"
              type="number"
              className={inputClassName}
              value={ruleForm.threshold}
              onChange={(e) => setRuleForm((f) => ({ ...f, threshold: e.target.value }))}
              placeholder="e.g. 90"
            />
          </FormField>

          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={ruleForm.enabled}
              onClick={() => setRuleForm((f) => ({ ...f, enabled: !f.enabled }))}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                ruleForm.enabled ? 'bg-accent' : 'bg-background-tertiary'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  ruleForm.enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-sm text-foreground">Enabled</span>
          </div>
        </form>
      </Modal>

      {/* ========== Delete Confirmation ========== */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteRuleMutation.mutate(deleteTarget.id)}
        title="Delete Rule"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteRuleMutation.isPending}
      />
    </div>
  );
}
