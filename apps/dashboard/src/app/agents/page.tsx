'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/shared/Button';
import { Modal } from '@/components/shared/Modal';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormField, inputClassName, selectClassName } from '@/components/shared/FormField';
import { EmptyState } from '@/components/shared/EmptyState';
import { useNotificationStore } from '@/stores/notifications';
import Link from 'next/link';

// ─── Register Agent Form ───────────────────────────────────────────────────

interface RegisterFormState {
  name: string;
  role: string;
  personality: string;
  systemPrompt: string;
  provider: string;
  model: string;
  maxTokens: string;
  loopMode: string;
  tools: string;
  guardrails: string;
}

const initialForm: RegisterFormState = {
  name: '',
  role: '',
  personality: '',
  systemPrompt: '',
  provider: 'openai',
  model: '',
  maxTokens: '',
  loopMode: 'single-turn',
  tools: '',
  guardrails: '',
};

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const queryClient = useQueryClient();
  const notify = useNotificationStore((s) => s.addNotification);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<RegisterFormState>(initialForm);
  const [confirmAction, setConfirmAction] = useState<{ type: 'pause' | 'resume' | 'stop'; agentId: string; agentName: string } | null>(null);

  const { data: agents, isLoading, error } = useQuery({
    queryKey: ['agents'],
    queryFn: api.agents.list,
  });

  // ── Mutations ──────────────────────────────────────────────

  const registerMutation = useMutation({
    mutationFn: (definition: Parameters<typeof api.agents.register>[0]) =>
      api.agents.register(definition),
    onSuccess: (data) => {
      notify('success', 'Agent registered', `ID: ${data.id}`);
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      setModalOpen(false);
      setForm(initialForm);
    },
    onError: (err: Error) => notify('error', 'Failed to register agent', err.message),
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => api.agents.pause(id),
    onSuccess: () => {
      notify('success', 'Agent paused');
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (err: Error) => {
      notify('error', 'Failed to pause agent', err.message);
      setConfirmAction(null);
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => api.agents.resume(id),
    onSuccess: () => {
      notify('success', 'Agent resumed');
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (err: Error) => {
      notify('error', 'Failed to resume agent', err.message);
      setConfirmAction(null);
    },
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => api.agents.stop(id),
    onSuccess: () => {
      notify('success', 'Agent stopped');
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (err: Error) => {
      notify('error', 'Failed to stop agent', err.message);
      setConfirmAction(null);
    },
  });

  // ── Form helpers ───────────────────────────────────────────

  function updateField(field: keyof RegisterFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleRegister() {
    if (!form.name.trim() || !form.role.trim() || !form.model.trim()) {
      notify('error', 'Missing required fields', 'Name, role, and model are required.');
      return;
    }

    const tools = form.tools.trim()
      ? form.tools.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;
    const guardrails = form.guardrails.trim()
      ? form.guardrails.split(',').map((g) => g.trim()).filter(Boolean)
      : undefined;

    registerMutation.mutate({
      name: form.name.trim(),
      persona: {
        role: form.role.trim(),
        personality: form.personality.trim(),
        ...(form.systemPrompt.trim() ? { systemPrompt: form.systemPrompt.trim() } : {}),
      },
      model: {
        provider: form.provider,
        model: form.model.trim(),
        ...(form.maxTokens ? { maxTokens: Number(form.maxTokens) } : {}),
      },
      loopConfig: { mode: form.loopMode },
      ...(tools ? { tools } : {}),
      ...(guardrails ? { guardrails } : {}),
    });
  }

  const canSubmit = form.name.trim() && form.role.trim() && form.model.trim();

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Agent Catalog</h1>
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          Register Agent
        </Button>
      </div>

      {/* Agent Grid */}
      {error ? (
        <div className="rounded-lg border border-error/30 bg-error/5 px-6 py-10 text-center">
          <p className="text-sm text-error">Failed to load agents: {(error as Error).message}</p>
        </div>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-lg border border-border bg-background-secondary" />
          ))}
        </div>
      ) : !agents?.length ? (
        <EmptyState
          title="No agents registered"
          description="Register your first agent to get started with the orchestration platform."
          action={{ label: 'Register Agent', onClick: () => setModalOpen(true) }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="rounded-lg border border-border bg-background-secondary p-4 hover:border-border-hover transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-foreground">{agent.name}</h3>
                  <p className="text-xs text-foreground-subtle mt-0.5">
                    {agent.id} v{agent.version}
                  </p>
                </div>
                <StatusBadge status={agent.status} />
              </div>

              <div className="mt-4 space-y-2 text-xs text-foreground-muted">
                <div className="flex justify-between">
                  <span>Provider</span>
                  <span className="text-foreground">{agent.provider}</span>
                </div>
                <div className="flex justify-between">
                  <span>Model</span>
                  <span className="text-foreground font-mono">{agent.model}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
                <Link
                  href={`/agents/${agent.id}`}
                  className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium text-accent hover:bg-background-tertiary transition-colors"
                >
                  View Details
                </Link>
                <div className="flex-1" />
                {agent.status === 'running' && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setConfirmAction({ type: 'pause', agentId: agent.id, agentName: agent.name })}
                    >
                      Pause
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setConfirmAction({ type: 'stop', agentId: agent.id, agentName: agent.name })}
                    >
                      Stop
                    </Button>
                  </>
                )}
                {agent.status === 'paused' && (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setConfirmAction({ type: 'resume', agentId: agent.id, agentName: agent.name })}
                    >
                      Resume
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setConfirmAction({ type: 'stop', agentId: agent.id, agentName: agent.name })}
                    >
                      Stop
                    </Button>
                  </>
                )}
                {agent.status === 'stopped' && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setConfirmAction({ type: 'resume', agentId: agent.id, agentName: agent.name })}
                  >
                    Resume
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Register Agent Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setForm(initialForm); }}
        title="Register Agent"
        description="Define a new agent to add to the orchestration catalog."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setModalOpen(false); setForm(initialForm); }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleRegister}
              loading={registerMutation.isPending}
              disabled={!canSubmit}
            >
              Register
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Name" htmlFor="agent-name" required>
            <input
              id="agent-name"
              className={inputClassName}
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="my-agent"
            />
          </FormField>

          <FormField label="Role" htmlFor="agent-role" required>
            <input
              id="agent-role"
              className={inputClassName}
              value={form.role}
              onChange={(e) => updateField('role', e.target.value)}
              placeholder="e.g. Code Reviewer, Data Analyst"
            />
          </FormField>

          <FormField label="Personality" htmlFor="agent-personality" hint="Describe the agent's communication style.">
            <textarea
              id="agent-personality"
              className={inputClassName}
              rows={2}
              value={form.personality}
              onChange={(e) => updateField('personality', e.target.value)}
              placeholder="e.g. Concise and technical, prefers bullet points"
            />
          </FormField>

          <FormField label="System Prompt" htmlFor="agent-systemprompt" hint="Custom system instructions for the agent.">
            <textarea
              id="agent-systemprompt"
              className={inputClassName + ' min-h-[80px] font-mono text-xs'}
              rows={3}
              value={form.systemPrompt}
              onChange={(e) => updateField('systemPrompt', e.target.value)}
              placeholder="You are a helpful assistant that..."
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Provider" htmlFor="agent-provider" required>
              <select
                id="agent-provider"
                className={selectClassName}
                value={form.provider}
                onChange={(e) => updateField('provider', e.target.value)}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="deepseek">DeepSeek</option>
                <option value="ollama">Ollama</option>
                <option value="vllm">vLLM</option>
                <option value="openrouter">OpenRouter</option>
                <option value="moonshot">Moonshot</option>
                <option value="minimax">MiniMax</option>
                <option value="qwen">Qwen</option>
                <option value="huggingface">HuggingFace</option>
                <option value="azure">Azure OpenAI</option>
                <option value="opencode">OpenCode</option>
                <option value="kimi">Kimi</option>
              </select>
            </FormField>

            <FormField label="Model" htmlFor="agent-model" required>
              <input
                id="agent-model"
                className={inputClassName}
                value={form.model}
                onChange={(e) => updateField('model', e.target.value)}
                placeholder="e.g. gpt-4o, claude-sonnet-4-20250514"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Max Tokens" htmlFor="agent-tokens" hint="Leave blank for default.">
              <input
                id="agent-tokens"
                type="number"
                className={inputClassName}
                value={form.maxTokens}
                onChange={(e) => updateField('maxTokens', e.target.value)}
                placeholder="4096"
              />
            </FormField>

            <FormField label="Loop Mode" htmlFor="agent-loop">
              <select
                id="agent-loop"
                className={selectClassName}
                value={form.loopMode}
                onChange={(e) => updateField('loopMode', e.target.value)}
              >
                <option value="single-turn">Single Turn</option>
                <option value="loop">Loop</option>
                <option value="plan-and-execute">Plan and Execute</option>
              </select>
            </FormField>
          </div>

          <FormField label="Tools" htmlFor="agent-tools" hint="Comma-separated list of tool names.">
            <input
              id="agent-tools"
              className={inputClassName}
              value={form.tools}
              onChange={(e) => updateField('tools', e.target.value)}
              placeholder="e.g. file-read, shell-exec, web-search"
            />
          </FormField>

          <FormField label="Guardrails" htmlFor="agent-guardrails" hint="Comma-separated list of guardrail names.">
            <input
              id="agent-guardrails"
              className={inputClassName}
              value={form.guardrails}
              onChange={(e) => updateField('guardrails', e.target.value)}
              placeholder="e.g. pii-filter, content-safety"
            />
          </FormField>
        </div>
      </Modal>

      {/* Agent Action Confirmation Dialog */}
      {confirmAction && (
        <ConfirmDialog
          open={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={() => {
            const { type, agentId } = confirmAction;
            if (type === 'pause') pauseMutation.mutate(agentId);
            else if (type === 'resume') resumeMutation.mutate(agentId);
            else if (type === 'stop') stopMutation.mutate(agentId);
          }}
          title={
            confirmAction.type === 'pause' ? 'Pause Agent'
            : confirmAction.type === 'resume' ? 'Resume Agent'
            : 'Stop Agent'
          }
          message={
            confirmAction.type === 'pause'
              ? `Are you sure you want to pause "${confirmAction.agentName}"? The agent will stop processing new turns until resumed.`
            : confirmAction.type === 'resume'
              ? `Resume agent "${confirmAction.agentName}"? The agent will begin processing turns again.`
              : `Are you sure you want to stop "${confirmAction.agentName}"? Any in-progress work will be terminated.`
          }
          confirmLabel={confirmAction.type === 'stop' ? 'Stop Agent' : confirmAction.type === 'pause' ? 'Pause' : 'Resume'}
          variant={confirmAction.type === 'stop' ? 'danger' : confirmAction.type === 'pause' ? 'warning' : 'default'}
          loading={pauseMutation.isPending || resumeMutation.isPending || stopMutation.isPending}
        />
      )}
    </div>
  );
}
