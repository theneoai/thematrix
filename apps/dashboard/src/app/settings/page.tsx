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

// ─── Types for local form state ─────────────────────────────────────────────

interface PolicyFormState {
  name: string;
  scope: 'global' | 'workflow' | 'agent' | 'environment';
  enforcement: 'enforce' | 'audit' | 'warn';
  rules: string;
}

const EMPTY_POLICY_FORM: PolicyFormState = {
  name: '',
  scope: 'global',
  enforcement: 'enforce',
  rules: '[]',
};

// ─── Section wrapper ────────────────────────────────────────────────────────

function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-background-secondary">
      <div className="flex items-start justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-lg font-medium text-foreground">{title}</h2>
          {description && (
            <p className="mt-0.5 text-sm text-foreground-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="px-6 py-4">{children}</div>
    </section>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const notify = useNotificationStore((s) => s.addNotification);

  // ── Modal / dialog state ────────────────────────────────────
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<string | null>(null);
  const [policyForm, setPolicyForm] = useState<PolicyFormState>(EMPTY_POLICY_FORM);
  const [deletingPolicyId, setDeletingPolicyId] = useState<string | null>(null);
  const [expandedEnv, setExpandedEnv] = useState<string | null>(null);
  const [expandedSuiteRunId, setExpandedSuiteRunId] = useState<string | null>(null);
  const [guardrailModalOpen, setGuardrailModalOpen] = useState(false);
  const [editingGuardrailId, setEditingGuardrailId] = useState<string | null>(null);
  const [guardrailForm, setGuardrailForm] = useState({ name: '', type: 'both' as const, action: 'block' as const, pattern: '', description: '' });
  const [deletingGuardrailId, setDeletingGuardrailId] = useState<string | null>(null);

  // ── Queries ─────────────────────────────────────────────────
  const environments = useQuery({ queryKey: ['environments'], queryFn: api.environments.list });
  const policies = useQuery({ queryKey: ['policies'], queryFn: api.policies.list });
  const guardrails = useQuery({ queryKey: ['guardrails'], queryFn: api.guardrails.list });
  const violations = useQuery({ queryKey: ['guardrail-violations'], queryFn: api.guardrails.violations });
  const evalSuites = useQuery({ queryKey: ['eval-suites'], queryFn: api.eval.suites });
  const evalResults = useQuery({
    queryKey: ['eval-results', expandedSuiteRunId],
    queryFn: () => api.eval.results(expandedSuiteRunId!),
    enabled: !!expandedSuiteRunId,
  });

  // ── Mutations ───────────────────────────────────────────────

  const setActiveEnv = useMutation({
    mutationFn: (name: string) => api.environments.setActive(name),
    onSuccess: (_data, name) => {
      queryClient.invalidateQueries({ queryKey: ['environments'] });
      notify('success', 'Environment activated', `"${name}" is now the active environment.`);
    },
    onError: () => notify('error', 'Failed to set active environment'),
  });

  const createPolicy = useMutation({
    mutationFn: (form: PolicyFormState) =>
      api.policies.create({
        name: form.name,
        scope: form.scope,
        enforcement: form.enforcement,
        rules: JSON.parse(form.rules),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      notify('success', 'Policy created');
      closePolicyModal();
    },
    onError: () => notify('error', 'Failed to create policy'),
  });

  const updatePolicy = useMutation({
    mutationFn: ({ id, form }: { id: string; form: PolicyFormState }) =>
      api.policies.update(id, {
        name: form.name,
        scope: form.scope,
        enforcement: form.enforcement,
        rules: JSON.parse(form.rules),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      notify('success', 'Policy updated');
      closePolicyModal();
    },
    onError: () => notify('error', 'Failed to update policy'),
  });

  const deletePolicy = useMutation({
    mutationFn: (id: string) => api.policies.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      notify('success', 'Policy deleted');
      setDeletingPolicyId(null);
    },
    onError: () => notify('error', 'Failed to delete policy'),
  });

  const runEval = useMutation({
    mutationFn: (suiteId: string) => api.eval.run(suiteId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['eval-suites'] });
      setExpandedSuiteRunId(data.runId);
      notify('success', 'Evaluation started');
    },
    onError: () => notify('error', 'Failed to start evaluation'),
  });

  const createGuardrail = useMutation({
    mutationFn: (form: typeof guardrailForm) => api.guardrails.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guardrails'] });
      notify('success', 'Guardrail created');
      setGuardrailModalOpen(false);
    },
    onError: () => notify('error', 'Failed to create guardrail'),
  });

  const updateGuardrail = useMutation({
    mutationFn: ({ id, form }: { id: string; form: typeof guardrailForm }) =>
      api.guardrails.update(id, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guardrails'] });
      notify('success', 'Guardrail updated');
      setGuardrailModalOpen(false);
    },
    onError: () => notify('error', 'Failed to update guardrail'),
  });

  const deleteGuardrail = useMutation({
    mutationFn: (id: string) => api.guardrails.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guardrails'] });
      notify('success', 'Guardrail deleted');
      setDeletingGuardrailId(null);
    },
    onError: () => notify('error', 'Failed to delete guardrail'),
  });

  // ── Helpers ─────────────────────────────────────────────────

  function closePolicyModal() {
    setPolicyModalOpen(false);
    setEditingPolicy(null);
    setPolicyForm(EMPTY_POLICY_FORM);
  }

  function openEditPolicy(p: { id: string; name: string; scope: string; enforcement: string; rules: unknown[] }) {
    setEditingPolicy(p.id);
    setPolicyForm({
      name: p.name,
      scope: p.scope as PolicyFormState['scope'],
      enforcement: p.enforcement as PolicyFormState['enforcement'],
      rules: JSON.stringify(p.rules, null, 2),
    });
    setPolicyModalOpen(true);
  }

  function handlePolicySubmit() {
    try {
      JSON.parse(policyForm.rules);
    } catch {
      notify('error', 'Invalid JSON in rules field');
      return;
    }
    if (editingPolicy) {
      updatePolicy.mutate({ id: editingPolicy, form: policyForm });
    } else {
      createPolicy.mutate(policyForm);
    }
  }

  const policySubmitting = createPolicy.isPending || updatePolicy.isPending;

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">Settings</h1>

      {/* ────────────────── Environment Management ────────────────── */}
      <Section
        title="Environment Management"
        description="Switch between configured environments and inspect their variables."
      >
        {environments.isLoading && (
          <p className="text-sm text-foreground-muted">Loading environments...</p>
        )}
        {environments.isError && (
          <p className="text-sm text-error">Failed to load environments.</p>
        )}
        {environments.data && environments.data.length === 0 && (
          <EmptyState
            icon="🌐"
            title="No environments configured"
            description="Define environments in your matrix.config.yaml to get started."
          />
        )}
        {environments.data && environments.data.length > 0 && (
          <div className="space-y-3">
            {environments.data.map((env) => (
              <div
                key={env.name}
                className="rounded-md border border-border bg-background-tertiary"
              >
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button
                      className="text-xs text-foreground-subtle hover:text-foreground"
                      onClick={() =>
                        setExpandedEnv(expandedEnv === env.name ? null : env.name)
                      }
                    >
                      {expandedEnv === env.name ? '▼' : '▶'}
                    </button>
                    <span className="text-sm font-medium text-foreground">{env.name}</span>
                    {env.active && <StatusBadge status="online" />}
                  </div>
                  {!env.active && (
                    <Button
                      size="sm"
                      variant="primary"
                      loading={setActiveEnv.isPending && setActiveEnv.variables === env.name}
                      onClick={() => setActiveEnv.mutate(env.name)}
                    >
                      Set Active
                    </Button>
                  )}
                </div>

                {expandedEnv === env.name && (
                  <div className="border-t border-border px-4 py-3">
                    {Object.keys(env.variables).length === 0 ? (
                      <p className="text-xs text-foreground-subtle">No variables defined.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-foreground-subtle">
                            <th className="pb-1 pr-4 font-medium">Key</th>
                            <th className="pb-1 font-medium">Value</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono text-foreground-muted">
                          {Object.entries(env.variables).map(([key, value]) => (
                            <tr key={key}>
                              <td className="py-0.5 pr-4">{key}</td>
                              <td className="py-0.5">{value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ────────────────── Policy Management ─────────────────────── */}
      <Section
        title="Policy Management"
        description="Define access and behaviour policies for agents, workflows, and environments."
        actions={
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setPolicyForm(EMPTY_POLICY_FORM);
              setEditingPolicy(null);
              setPolicyModalOpen(true);
            }}
          >
            Add Policy
          </Button>
        }
      >
        {policies.isLoading && (
          <p className="text-sm text-foreground-muted">Loading policies...</p>
        )}
        {policies.isError && (
          <p className="text-sm text-error">Failed to load policies.</p>
        )}
        {policies.data && policies.data.length === 0 && (
          <EmptyState
            icon="📋"
            title="No policies defined"
            description="Create a policy to control agent and workflow behaviour."
            action={{
              label: 'Add Policy',
              onClick: () => {
                setPolicyForm(EMPTY_POLICY_FORM);
                setEditingPolicy(null);
                setPolicyModalOpen(true);
              },
            }}
          />
        )}
        {policies.data && policies.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-foreground-subtle">
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Scope</th>
                  <th className="pb-2 pr-4 font-medium">Enforcement</th>
                  <th className="pb-2 pr-4 font-medium">Rules</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {policies.data.map((policy) => (
                  <tr key={policy.id} className="border-b border-border last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-foreground">{policy.name}</td>
                    <td className="py-2.5 pr-4">
                      <span className="inline-block rounded bg-background-tertiary px-2 py-0.5 text-xs text-foreground-muted">
                        {policy.scope}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <StatusBadge
                        status={
                          policy.enforcement === 'enforce'
                            ? 'firing'
                            : policy.enforcement === 'audit'
                              ? 'pending'
                              : 'paused'
                        }
                      />
                    </td>
                    <td className="py-2.5 pr-4 text-foreground-muted">
                      {policy.rules.length} rule{policy.rules.length !== 1 ? 's' : ''}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEditPolicy(policy)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeletingPolicyId(policy.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ────────────────── Guardrail Overview ────────────────────── */}
      <Section
        title="Guardrail Overview"
        description="Configured guardrails and recent violations."
        actions={
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setGuardrailForm({ name: '', type: 'both', action: 'block', pattern: '', description: '' });
              setEditingGuardrailId(null);
              setGuardrailModalOpen(true);
            }}
          >
            Add Guardrail
          </Button>
        }
      >
        {guardrails.isLoading && (
          <p className="text-sm text-foreground-muted">Loading guardrails...</p>
        )}
        {guardrails.isError && (
          <p className="text-sm text-error">Failed to load guardrails.</p>
        )}
        {guardrails.data && guardrails.data.length === 0 && (
          <EmptyState
            icon="🛡️"
            title="No guardrails configured"
            description="Guardrails protect your agents from producing harmful or off-topic output."
            action={{
              label: 'Add Guardrail',
              onClick: () => {
                setGuardrailForm({ name: '', type: 'both', action: 'block', pattern: '', description: '' });
                setEditingGuardrailId(null);
                setGuardrailModalOpen(true);
              },
            }}
          />
        )}
        {guardrails.data && guardrails.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-foreground-subtle">
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Source</th>
                  <th className="pb-2 pr-4 font-medium">Action</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {guardrails.data.map((g) => (
                  <tr key={g.id} className="border-b border-border last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-foreground">{g.name}</td>
                    <td className="py-2.5 pr-4">
                      <span className="inline-block rounded bg-background-tertiary px-2 py-0.5 text-xs text-foreground-muted">
                        {g.type}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-foreground-muted">
                      {g.builtin ? 'Built-in' : 'Custom'}
                    </td>
                    <td className="py-2.5">
                      <StatusBadge
                        status={
                          g.action === 'block'
                            ? 'failed'
                            : g.action === 'warn'
                              ? 'paused'
                              : 'running'
                        }
                      />
                    </td>
                    <td className="py-2.5 text-right">
                      {!g.builtin && (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingGuardrailId(g.id);
                              setGuardrailForm({ name: g.name, type: g.type, action: g.action, pattern: '', description: '' });
                              setGuardrailModalOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeletingGuardrailId(g.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Recent violations */}
        {violations.data && violations.data.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-3 text-sm font-medium text-foreground">Recent Violations</h3>
            <div className="space-y-2">
              {violations.data.slice(0, 10).map((v, i) => (
                <div
                  key={`${v.guardrailId}-${v.timestamp}-${i}`}
                  className="flex items-start justify-between rounded-md border border-border bg-background-tertiary px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {v.guardrailName}
                      </span>
                      <StatusBadge
                        status={
                          v.severity === 'critical'
                            ? 'failed'
                            : v.severity === 'warning'
                              ? 'paused'
                              : 'pending'
                        }
                      />
                    </div>
                    <p className="mt-0.5 text-xs text-foreground-muted truncate">{v.message}</p>
                    <p className="mt-0.5 text-xs text-foreground-subtle">
                      Agent: {v.agentId} &middot; Action: {v.action} &middot;{' '}
                      {new Date(v.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ────────────────── MCP Servers ────────────────────────────── */}
      <Section
        title="MCP Servers"
        description="Model Context Protocol integration status."
      >
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-background-tertiary px-4 py-3">
            <p className="text-sm text-foreground-muted">
              MCP servers provide tool integration for agents via the Model Context Protocol.
              Servers are configured in your <code className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-xs">matrix.config.yaml</code> and
              automatically discovered at startup.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border bg-background-tertiary px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="h-2 w-2 rounded-full bg-success" />
                <span className="text-sm font-medium text-foreground">stdio</span>
              </div>
              <p className="text-xs text-foreground-muted">Local process via stdin/stdout</p>
              <p className="text-xs text-foreground-subtle mt-1">Supports: tools, resources, prompts</p>
            </div>
            <div className="rounded-md border border-border bg-background-tertiary px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="h-2 w-2 rounded-full bg-success" />
                <span className="text-sm font-medium text-foreground">HTTP/SSE</span>
              </div>
              <p className="text-xs text-foreground-muted">Remote server via HTTP transport</p>
              <p className="text-xs text-foreground-subtle mt-1">Supports: tools, resources, prompts</p>
            </div>
          </div>
          <p className="text-xs text-foreground-subtle">
            A2A (Agent-to-Agent) protocol is also available for inter-agent communication.
          </p>
        </div>
      </Section>

      {/* ────────────────── Evaluation Suites ─────────────────────── */}
      <Section
        title="Evaluation Suites"
        description="Run and review evaluation suites to measure agent quality."
      >
        {evalSuites.isLoading && (
          <p className="text-sm text-foreground-muted">Loading evaluation suites...</p>
        )}
        {evalSuites.isError && (
          <p className="text-sm text-error">Failed to load evaluation suites.</p>
        )}
        {evalSuites.data && evalSuites.data.length === 0 && (
          <EmptyState
            icon="📊"
            title="No evaluation suites"
            description="Define eval suites in your configuration to benchmark agent quality."
          />
        )}
        {evalSuites.data && evalSuites.data.length > 0 && (
          <div className="space-y-3">
            {evalSuites.data.map((suite) => (
              <div
                key={suite.id}
                className="rounded-md border border-border bg-background-tertiary"
              >
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <span className="text-sm font-medium text-foreground">{suite.name}</span>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-foreground-muted">
                      <span>{suite.caseCount} cases</span>
                      {suite.lastRunAt && (
                        <span>Last run: {new Date(suite.lastRunAt).toLocaleDateString()}</span>
                      )}
                      {suite.lastScore != null && (
                        <span
                          className={
                            suite.lastScore >= 0.8
                              ? 'text-success'
                              : suite.lastScore >= 0.5
                                ? 'text-warning'
                                : 'text-error'
                          }
                        >
                          Score: {(suite.lastScore * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={runEval.isPending && runEval.variables === suite.id}
                    onClick={() => runEval.mutate(suite.id)}
                  >
                    Run
                  </Button>
                </div>

                {/* Expanded results */}
                {expandedSuiteRunId && (
                  <EvalResultsPanel
                    runId={expandedSuiteRunId}
                    suiteId={suite.id}
                    results={evalResults.data}
                    isLoading={evalResults.isLoading}
                    onClose={() => setExpandedSuiteRunId(null)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ────────────────── Policy Modal ──────────────────────────── */}
      <Modal
        open={policyModalOpen}
        onClose={closePolicyModal}
        title={editingPolicy ? 'Edit Policy' : 'Add Policy'}
        description="Configure a policy to control agent and workflow behaviour."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={closePolicyModal} disabled={policySubmitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handlePolicySubmit}
              loading={policySubmitting}
              disabled={!policyForm.name.trim()}
            >
              {editingPolicy ? 'Save Changes' : 'Create Policy'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Name" htmlFor="policy-name" required>
            <input
              id="policy-name"
              className={inputClassName}
              value={policyForm.name}
              onChange={(e) => setPolicyForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. production-safety"
            />
          </FormField>

          <FormField label="Scope" htmlFor="policy-scope" required>
            <select
              id="policy-scope"
              className={selectClassName}
              value={policyForm.scope}
              onChange={(e) =>
                setPolicyForm((f) => ({
                  ...f,
                  scope: e.target.value as PolicyFormState['scope'],
                }))
              }
            >
              <option value="global">Global</option>
              <option value="workflow">Workflow</option>
              <option value="agent">Agent</option>
              <option value="environment">Environment</option>
            </select>
          </FormField>

          <FormField label="Enforcement" htmlFor="policy-enforcement" required>
            <select
              id="policy-enforcement"
              className={selectClassName}
              value={policyForm.enforcement}
              onChange={(e) =>
                setPolicyForm((f) => ({
                  ...f,
                  enforcement: e.target.value as PolicyFormState['enforcement'],
                }))
              }
            >
              <option value="enforce">Enforce</option>
              <option value="audit">Audit</option>
              <option value="warn">Warn</option>
            </select>
          </FormField>

          <FormField
            label="Rules (JSON)"
            htmlFor="policy-rules"
            hint='Array of rule objects with "description", "effect" (allow/deny), and "condition".'
          >
            <textarea
              id="policy-rules"
              className={`${inputClassName} min-h-[120px] font-mono text-xs`}
              value={policyForm.rules}
              onChange={(e) => setPolicyForm((f) => ({ ...f, rules: e.target.value }))}
            />
          </FormField>
        </div>
      </Modal>

      {/* ────────────────── Delete Policy Confirm ─────────────────── */}
      <ConfirmDialog
        open={!!deletingPolicyId}
        onClose={() => setDeletingPolicyId(null)}
        onConfirm={() => deletingPolicyId && deletePolicy.mutate(deletingPolicyId)}
        title="Delete Policy"
        message="Are you sure you want to delete this policy? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deletePolicy.isPending}
      />

      {/* ────────────────── Guardrail Modal ──────────────────────── */}
      <Modal
        open={guardrailModalOpen}
        onClose={() => setGuardrailModalOpen(false)}
        title={editingGuardrailId ? 'Edit Guardrail' : 'Add Guardrail'}
        description="Configure a guardrail to protect agent inputs or outputs."
        footer={
          <>
            <Button variant="ghost" onClick={() => setGuardrailModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (editingGuardrailId) {
                  updateGuardrail.mutate({ id: editingGuardrailId, form: guardrailForm });
                } else {
                  createGuardrail.mutate(guardrailForm);
                }
              }}
              loading={createGuardrail.isPending || updateGuardrail.isPending}
              disabled={!guardrailForm.name.trim()}
            >
              {editingGuardrailId ? 'Save Changes' : 'Create Guardrail'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Name" htmlFor="guardrail-name" required>
            <input
              id="guardrail-name"
              className={inputClassName}
              value={guardrailForm.name}
              onChange={(e) => setGuardrailForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. pii-filter"
            />
          </FormField>
          <FormField label="Type" htmlFor="guardrail-type" required>
            <select
              id="guardrail-type"
              className={selectClassName}
              value={guardrailForm.type}
              onChange={(e) => setGuardrailForm((f) => ({ ...f, type: e.target.value as 'input' | 'output' | 'both' }))}
            >
              <option value="input">Input</option>
              <option value="output">Output</option>
              <option value="both">Both</option>
            </select>
          </FormField>
          <FormField label="Action" htmlFor="guardrail-action" required>
            <select
              id="guardrail-action"
              className={selectClassName}
              value={guardrailForm.action}
              onChange={(e) => setGuardrailForm((f) => ({ ...f, action: e.target.value as 'block' | 'warn' | 'rewrite' }))}
            >
              <option value="block">Block</option>
              <option value="warn">Warn</option>
              <option value="rewrite">Rewrite</option>
            </select>
          </FormField>
          <FormField label="Pattern" htmlFor="guardrail-pattern" hint="Regex pattern to match against.">
            <input
              id="guardrail-pattern"
              className={inputClassName + ' font-mono text-xs'}
              value={guardrailForm.pattern}
              onChange={(e) => setGuardrailForm((f) => ({ ...f, pattern: e.target.value }))}
              placeholder="e.g. \\b\\d{3}-\\d{2}-\\d{4}\\b"
            />
          </FormField>
          <FormField label="Description" htmlFor="guardrail-desc" hint="What this guardrail protects against.">
            <textarea
              id="guardrail-desc"
              className={inputClassName}
              rows={2}
              value={guardrailForm.description}
              onChange={(e) => setGuardrailForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Blocks output containing PII such as SSN"
            />
          </FormField>
        </div>
      </Modal>

      {/* ────────────────── Delete Guardrail Confirm ──────────────── */}
      <ConfirmDialog
        open={!!deletingGuardrailId}
        onClose={() => setDeletingGuardrailId(null)}
        onConfirm={() => deletingGuardrailId && deleteGuardrail.mutate(deletingGuardrailId)}
        title="Delete Guardrail"
        message="Are you sure you want to delete this guardrail? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteGuardrail.isPending}
      />
    </div>
  );
}

// ─── Eval Results sub-component ─────────────────────────────────────────────

function EvalResultsPanel({
  runId,
  suiteId,
  results,
  isLoading,
  onClose,
}: {
  runId: string;
  suiteId: string;
  results?: Array<{
    caseId: string;
    input: string;
    expectedOutput: string;
    actualOutput: string;
    scores: { metric: string; score: number; reason?: string }[];
    passed: boolean;
    latencyMs: number;
    tokenCount: number;
  }>;
  isLoading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-medium text-foreground-muted">
          Results &mdash; Run {runId.slice(0, 8)}
        </h4>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Collapse
        </Button>
      </div>
      {isLoading && <p className="text-xs text-foreground-subtle">Loading results...</p>}
      {results && results.length === 0 && (
        <p className="text-xs text-foreground-subtle">No results available yet.</p>
      )}
      {results && results.length > 0 && (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-foreground-subtle">
                <th className="pb-1 pr-3 font-medium">Case</th>
                <th className="pb-1 pr-3 font-medium">Passed</th>
                <th className="pb-1 pr-3 font-medium">Scores</th>
                <th className="pb-1 pr-3 font-medium">Latency</th>
                <th className="pb-1 font-medium">Tokens</th>
              </tr>
            </thead>
            <tbody className="text-foreground-muted">
              {results.map((r) => (
                <tr key={r.caseId} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-3 font-mono">{r.caseId.slice(0, 12)}</td>
                  <td className="py-1.5 pr-3">
                    <StatusBadge status={r.passed ? 'completed' : 'failed'} />
                  </td>
                  <td className="py-1.5 pr-3">
                    {r.scores.map((s) => (
                      <span key={s.metric} className="mr-2">
                        {s.metric}: {(s.score * 100).toFixed(0)}%
                      </span>
                    ))}
                  </td>
                  <td className="py-1.5 pr-3">{r.latencyMs}ms</td>
                  <td className="py-1.5">{r.tokenCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
