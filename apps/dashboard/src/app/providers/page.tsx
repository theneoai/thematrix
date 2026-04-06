'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Button } from '@/components/shared/Button';
import { Modal } from '@/components/shared/Modal';
import { FormField, inputClassName, selectClassName } from '@/components/shared/FormField';
import { EmptyState } from '@/components/shared/EmptyState';
import { useNotificationStore } from '@/stores/notifications';

export default function ProvidersPage() {
  const queryClient = useQueryClient();
  const notify = useNotificationStore((s) => s.addNotification);

  // ── State ──────────────────────────────────────────────────────────────────
  const [configureProvider, setConfigureProvider] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState({
    apiKey: '',
    baseUrl: '',
    rpm: '',
    tpm: '',
    maxConcurrent: '',
    timeout: '',
  });

  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [editingBudgetOwner, setEditingBudgetOwner] = useState<string | null>(null);
  const [budgetForm, setBudgetForm] = useState({
    ownerId: '',
    maxTokens: '',
    maxCostUsd: '',
    period: 'daily' as 'hourly' | 'daily' | 'per-run' | 'unlimited',
    alertThreshold: '',
  });

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: providers, isLoading: providersLoading, error: providersError } = useQuery({
    queryKey: ['providers'],
    queryFn: api.providers.list,
  });

  const { data: providerHealth } = useQuery({
    queryKey: ['providers', 'health'],
    queryFn: api.providers.health,
    refetchInterval: 30_000,
  });

  const { data: tokenUsage, isLoading: tokenLoading, error: tokenError } = useQuery({
    queryKey: ['token-usage'],
    queryFn: api.tokens.usage,
  });

  // Build a map of health info by provider name
  const healthMap = new Map(
    providerHealth?.map((h) => [h.name, h]) ?? [],
  );

  const totalTokens = tokenUsage?.reduce((sum, u) => sum + u.totalTokens, 0) ?? 0;
  const totalCost = tokenUsage?.reduce((sum, u) => sum + u.totalCostUsd, 0) ?? 0;
  const activeProviderCount = providers?.filter((p) => p.configured).length ?? 0;

  // Unique owner IDs from usage data for budget queries
  const ownerIds = [...new Set(tokenUsage?.map((u) => u.ownerId) ?? [])];

  const budgetQueries = useQuery({
    queryKey: ['token-budgets', ownerIds],
    queryFn: async () => {
      const results = await Promise.allSettled(
        ownerIds.map((id) => api.tokens.budget(id)),
      );
      return results
        .map((r, i) => (r.status === 'fulfilled' ? r.value : null))
        .filter((b): b is NonNullable<typeof b> => b !== null);
    },
    enabled: ownerIds.length > 0,
  });

  const budgets = budgetQueries.data ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────────
  const configureMutation = useMutation({
    mutationFn: ({ provider, config }: { provider: string; config: Parameters<typeof api.providers.configure>[1] }) =>
      api.providers.configure(provider, config),
    onSuccess: () => {
      notify('success', 'Provider configured', 'Provider settings saved successfully.');
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      setConfigureProvider(null);
    },
    onError: (err: Error) => {
      notify('error', 'Configuration failed', err.message);
    },
  });

  const allocateBudgetMutation = useMutation({
    mutationFn: ({ ownerId, budget }: { ownerId: string; budget: Parameters<typeof api.tokens.allocateBudget>[1] }) =>
      api.tokens.allocateBudget(ownerId, budget),
    onSuccess: () => {
      notify('success', 'Budget allocated', 'Token budget has been set.');
      queryClient.invalidateQueries({ queryKey: ['token-usage'] });
      queryClient.invalidateQueries({ queryKey: ['token-budgets'] });
      setBudgetModalOpen(false);
      setEditingBudgetOwner(null);
    },
    onError: (err: Error) => {
      notify('error', 'Budget allocation failed', err.message);
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────
  function openConfigureModal(providerName: string) {
    setConfigForm({ apiKey: '', baseUrl: '', rpm: '', tpm: '', maxConcurrent: '', timeout: '' });
    setConfigureProvider(providerName);
  }

  function handleConfigureSubmit() {
    if (!configureProvider) return;
    const config: Parameters<typeof api.providers.configure>[1] = {};
    if (configForm.apiKey) config.apiKey = configForm.apiKey;
    if (configForm.baseUrl) config.baseUrl = configForm.baseUrl;
    if (configForm.rpm || configForm.tpm || configForm.maxConcurrent) {
      config.rateLimit = {};
      if (configForm.rpm) config.rateLimit.rpm = Number(configForm.rpm);
      if (configForm.tpm) config.rateLimit.tpm = Number(configForm.tpm);
      if (configForm.maxConcurrent) config.rateLimit.maxConcurrent = Number(configForm.maxConcurrent);
    }
    if (configForm.timeout) config.timeout = Number(configForm.timeout);
    configureMutation.mutate({ provider: configureProvider, config });
  }

  function openBudgetModal(ownerId?: string) {
    if (ownerId) {
      const existing = budgets.find((b) => b.ownerId === ownerId);
      setBudgetForm({
        ownerId,
        maxTokens: existing ? String(existing.maxTokens) : '',
        maxCostUsd: existing?.maxCostUsd != null ? String(existing.maxCostUsd) : '',
        period: (existing?.period as typeof budgetForm.period) ?? 'daily',
        alertThreshold: '',
      });
      setEditingBudgetOwner(ownerId);
    } else {
      setBudgetForm({ ownerId: '', maxTokens: '', maxCostUsd: '', period: 'daily', alertThreshold: '' });
      setEditingBudgetOwner(null);
    }
    setBudgetModalOpen(true);
  }

  function handleBudgetSubmit() {
    const ownerId = editingBudgetOwner ?? budgetForm.ownerId;
    if (!ownerId || !budgetForm.maxTokens) return;
    const budget: Parameters<typeof api.tokens.allocateBudget>[1] = {
      maxTokens: Number(budgetForm.maxTokens),
      period: budgetForm.period,
    };
    if (budgetForm.maxCostUsd) budget.maxCostUsd = Number(budgetForm.maxCostUsd);
    if (budgetForm.alertThreshold) budget.alertThreshold = Number(budgetForm.alertThreshold);
    allocateBudgetMutation.mutate({ ownerId, budget });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-foreground">Model Providers & Token Pool</h1>

      {(providersLoading || tokenLoading) && (
        <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-foreground-subtle">
          Loading providers and token data...
        </div>
      )}

      {providersError && (
        <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-error">
          Failed to load providers: {providersError.message}
        </div>
      )}

      {tokenError && (
        <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-error">
          Failed to load token usage: {tokenError.message}
        </div>
      )}

      {/* ── Provider Registry ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-medium text-foreground mb-4">Provider Registry</h2>
        {providers && providers.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((provider) => {
              const health = healthMap.get(provider.name);
              return (
                <div
                  key={provider.name}
                  className="rounded-lg border border-border bg-background-secondary p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full ${
                          health?.healthy ? 'bg-green-500' : 'bg-red-500'
                        }`}
                        title={health?.healthy ? 'Healthy' : health?.message ?? 'Unhealthy'}
                      />
                      <h3 className="text-sm font-semibold text-foreground">{provider.displayName}</h3>
                    </div>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        provider.configured
                          ? 'bg-green-500/10 text-success'
                          : 'bg-background-tertiary text-foreground-subtle'
                      }`}
                    >
                      {provider.configured ? 'Configured' : 'Not configured'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-foreground-muted">
                    <span className="font-mono">{provider.name}</span>
                    {health && (
                      <span>
                        {health.latencyMs}ms latency
                      </span>
                    )}
                  </div>

                  {health?.message && !health.healthy && (
                    <p className="text-xs text-error">{health.message}</p>
                  )}

                  <div className="text-xs text-foreground-subtle">
                    {provider.models.length} model{provider.models.length !== 1 ? 's' : ''} available
                  </div>

                  {provider.models.length > 0 && (
                    <div className="max-h-24 overflow-y-auto space-y-0.5">
                      {provider.models.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between text-[10px] text-foreground-muted px-1.5 py-0.5 rounded bg-background-tertiary"
                        >
                          <span className="font-mono truncate" title={m.id}>{m.name}</span>
                          <span className="shrink-0 ml-2 text-foreground-subtle">{(m.contextWindow / 1000).toFixed(0)}K</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    onClick={() => openConfigureModal(provider.name)}
                  >
                    Configure
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No providers found"
            description="No model providers are registered in the system."
          />
        )}
      </section>

      {/* ── Token Pool Overview ───────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-medium text-foreground mb-4">Token Pool Overview</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-background-secondary p-4">
            <p className="text-xs text-foreground-subtle">Total Tokens Used</p>
            <p className="mt-1 text-2xl font-semibold text-accent">
              {totalTokens > 1_000_000 ? `${(totalTokens / 1_000_000).toFixed(2)}M` : totalTokens.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background-secondary p-4">
            <p className="text-xs text-foreground-subtle">Total Cost</p>
            <p className="mt-1 text-2xl font-semibold text-warning">${totalCost.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-border bg-background-secondary p-4">
            <p className="text-xs text-foreground-subtle">Active Providers</p>
            <p className="mt-1 text-2xl font-semibold text-success">{activeProviderCount}</p>
          </div>
        </div>
      </section>

      {/* ── Token Budget Management ───────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-foreground">Token Budget Management</h2>
          <Button variant="primary" size="sm" onClick={() => openBudgetModal()}>
            Allocate Budget
          </Button>
        </div>

        {budgets.length > 0 ? (
          <div className="rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background-secondary text-left text-foreground-subtle">
                  <th className="px-4 py-3 font-medium">Owner ID</th>
                  <th className="px-4 py-3 font-medium">Max Tokens</th>
                  <th className="px-4 py-3 font-medium">Remaining</th>
                  <th className="px-4 py-3 font-medium">Usage</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {budgets.map((budget) => (
                  <tr key={budget.ownerId} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{budget.ownerId}</td>
                    <td className="px-4 py-3 text-foreground">{budget.maxTokens.toLocaleString()}</td>
                    <td className="px-4 py-3 text-foreground">{budget.remaining.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 rounded-full bg-background-tertiary">
                          <div
                            className={`h-full rounded-full ${
                              budget.usagePercent >= 90
                                ? 'bg-red-500'
                                : budget.usagePercent >= 70
                                  ? 'bg-yellow-500'
                                  : 'bg-accent'
                            }`}
                            style={{ width: `${Math.min(100, budget.usagePercent)}%` }}
                          />
                        </div>
                        <span className="text-xs text-foreground-muted">
                          {budget.usagePercent > 100
                            ? `${budget.usagePercent.toFixed(0)}% (over budget)`
                            : `${budget.usagePercent.toFixed(0)}%`
                          }
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted capitalize">{budget.period ?? 'unlimited'}</td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="ghost" onClick={() => openBudgetModal(budget.ownerId)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No budgets configured"
            description="Allocate token budgets to control spending per owner."
            action={{ label: 'Allocate Budget', onClick: () => openBudgetModal() }}
          />
        )}
      </section>

      {/* ── Usage by Owner ────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-medium text-foreground mb-4">Token Usage by Owner</h2>
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary text-left text-foreground-subtle">
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Tokens</th>
                <th className="px-4 py-3 font-medium">Cost</th>
                <th className="px-4 py-3 font-medium">Usage</th>
              </tr>
            </thead>
            <tbody>
              {tokenUsage?.map((usage) => (
                <tr key={usage.ownerId} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{usage.ownerId}</td>
                  <td className="px-4 py-3 text-foreground-muted">{usage.ownerType}</td>
                  <td className="px-4 py-3 text-foreground">{usage.totalTokens.toLocaleString()}</td>
                  <td className="px-4 py-3 text-warning">${usage.totalCostUsd.toFixed(4)}</td>
                  <td className="px-4 py-3">
                    <div className="h-2 w-24 rounded-full bg-background-tertiary">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.min(100, (usage.totalTokens / (totalTokens || 1)) * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Configure Provider Modal ──────────────────────────────────────── */}
      <Modal
        open={configureProvider !== null}
        onClose={() => setConfigureProvider(null)}
        title={`Configure ${providers?.find((p) => p.name === configureProvider)?.displayName ?? configureProvider}`}
        description="Set credentials and rate limits for this provider."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfigureProvider(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={configureMutation.isPending}
              onClick={handleConfigureSubmit}
            >
              Save Configuration
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="API Key" htmlFor="cfg-apikey" hint="Leave blank to keep existing key.">
            <input
              id="cfg-apikey"
              type="password"
              className={inputClassName}
              placeholder="sk-..."
              value={configForm.apiKey}
              onChange={(e) => setConfigForm((f) => ({ ...f, apiKey: e.target.value }))}
            />
          </FormField>

          <FormField label="Base URL" htmlFor="cfg-baseurl" hint="Override the default API endpoint.">
            <input
              id="cfg-baseurl"
              type="text"
              className={inputClassName}
              placeholder="https://api.example.com/v1"
              value={configForm.baseUrl}
              onChange={(e) => setConfigForm((f) => ({ ...f, baseUrl: e.target.value }))}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="RPM" htmlFor="cfg-rpm" hint="Requests per minute">
              <input
                id="cfg-rpm"
                type="number"
                min="1"
                className={inputClassName}
                placeholder="60"
                value={configForm.rpm}
                onChange={(e) => setConfigForm((f) => ({ ...f, rpm: e.target.value }))}
              />
            </FormField>
            <FormField label="TPM" htmlFor="cfg-tpm" hint="Tokens per minute">
              <input
                id="cfg-tpm"
                type="number"
                min="1"
                className={inputClassName}
                placeholder="100000"
                value={configForm.tpm}
                onChange={(e) => setConfigForm((f) => ({ ...f, tpm: e.target.value }))}
              />
            </FormField>
            <FormField label="Max Concurrent" htmlFor="cfg-concurrent">
              <input
                id="cfg-concurrent"
                type="number"
                min="1"
                className={inputClassName}
                placeholder="10"
                value={configForm.maxConcurrent}
                onChange={(e) => setConfigForm((f) => ({ ...f, maxConcurrent: e.target.value }))}
              />
            </FormField>
          </div>

          <FormField label="Timeout (ms)" htmlFor="cfg-timeout" hint="Request timeout in milliseconds.">
            <input
              id="cfg-timeout"
              type="number"
              min="1000"
              className={inputClassName}
              placeholder="30000"
              value={configForm.timeout}
              onChange={(e) => setConfigForm((f) => ({ ...f, timeout: e.target.value }))}
            />
          </FormField>
        </div>
      </Modal>

      {/* ── Allocate Budget Modal ─────────────────────────────────────────── */}
      <Modal
        open={budgetModalOpen}
        onClose={() => { setBudgetModalOpen(false); setEditingBudgetOwner(null); }}
        title={editingBudgetOwner ? `Edit Budget: ${editingBudgetOwner}` : 'Allocate Token Budget'}
        description="Set token and cost limits for an owner."
        footer={
          <>
            <Button variant="secondary" onClick={() => { setBudgetModalOpen(false); setEditingBudgetOwner(null); }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={allocateBudgetMutation.isPending}
              onClick={handleBudgetSubmit}
              disabled={!(editingBudgetOwner || budgetForm.ownerId) || !budgetForm.maxTokens}
            >
              {editingBudgetOwner ? 'Update Budget' : 'Allocate Budget'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {!editingBudgetOwner && (
            <FormField label="Owner ID" htmlFor="budget-owner" required>
              <input
                id="budget-owner"
                type="text"
                className={inputClassName}
                placeholder="agent-id or workflow-id"
                value={budgetForm.ownerId}
                onChange={(e) => setBudgetForm((f) => ({ ...f, ownerId: e.target.value }))}
              />
            </FormField>
          )}

          <FormField label="Max Tokens" htmlFor="budget-max-tokens" required>
            <input
              id="budget-max-tokens"
              type="number"
              min="1"
              className={inputClassName}
              placeholder="1000000"
              value={budgetForm.maxTokens}
              onChange={(e) => setBudgetForm((f) => ({ ...f, maxTokens: e.target.value }))}
            />
          </FormField>

          <FormField label="Max Cost (USD)" htmlFor="budget-max-cost" hint="Optional spending cap in USD.">
            <input
              id="budget-max-cost"
              type="number"
              min="0.01"
              step="0.01"
              className={inputClassName}
              placeholder="50.00"
              value={budgetForm.maxCostUsd}
              onChange={(e) => setBudgetForm((f) => ({ ...f, maxCostUsd: e.target.value }))}
            />
          </FormField>

          <FormField label="Period" htmlFor="budget-period" required>
            <select
              id="budget-period"
              className={selectClassName}
              value={budgetForm.period}
              onChange={(e) => setBudgetForm((f) => ({ ...f, period: e.target.value as typeof budgetForm.period }))}
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="per-run">Per Run</option>
              <option value="unlimited">Unlimited</option>
            </select>
          </FormField>

          <FormField label="Alert Threshold (%)" htmlFor="budget-alert" hint="Send alert when usage exceeds this percentage.">
            <input
              id="budget-alert"
              type="number"
              min="0"
              max="100"
              className={inputClassName}
              placeholder="80"
              value={budgetForm.alertThreshold}
              onChange={(e) => setBudgetForm((f) => ({ ...f, alertThreshold: e.target.value }))}
            />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}
