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
import type { TriggerRuleInfo, TriggerRuleInput, CronScheduleInfo, CronScheduleInput } from '@/lib/api-client';

const CHANNELS = ['gerrit', 'jira', 'gitlab', 'feishu', 'wechat', 'dingtalk', 'slack', 'custom'] as const;

const emptyTriggerForm: TriggerRuleInput = {
  name: '',
  channel: 'gerrit',
  eventType: '',
  workflowId: '',
  cooldownMs: 0,
  maxConcurrent: 1,
};

const emptyScheduleForm: CronScheduleInput = {
  name: '',
  cron: '',
  workflowId: '',
  timezone: 'UTC',
  input: undefined,
};

export default function TriggersPage() {
  const queryClient = useQueryClient();
  const notify = useNotificationStore((s) => s.addNotification);

  const { data: triggers, error: triggersError } = useQuery({ queryKey: ['triggers'], queryFn: api.triggers.list });
  const { data: schedules, error: schedulesError } = useQuery({ queryKey: ['schedules'], queryFn: api.schedules.list });

  // ── Trigger modal state ───────────────────────────────────────
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<TriggerRuleInfo | null>(null);
  const [triggerForm, setTriggerForm] = useState<TriggerRuleInput>(emptyTriggerForm);
  const [deletingTriggerId, setDeletingTriggerId] = useState<string | null>(null);

  // ── Schedule modal state ──────────────────────────────────────
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<CronScheduleInfo | null>(null);
  const [scheduleForm, setScheduleForm] = useState<CronScheduleInput>(emptyScheduleForm);
  const [scheduleInputJson, setScheduleInputJson] = useState('');
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(null);

  // ── Trigger mutations ─────────────────────────────────────────
  const createTrigger = useMutation({
    mutationFn: (rule: TriggerRuleInput) => api.triggers.create(rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['triggers'] });
      notify('success', 'Trigger rule created');
      closeTriggerModal();
    },
    onError: (err: Error) => notify('error', 'Failed to create trigger', err.message),
  });

  const updateTrigger = useMutation({
    mutationFn: ({ id, rule }: { id: string; rule: Partial<TriggerRuleInput> }) =>
      api.triggers.update(id, rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['triggers'] });
      notify('success', 'Trigger rule updated');
      closeTriggerModal();
    },
    onError: (err: Error) => notify('error', 'Failed to update trigger', err.message),
  });

  const deleteTrigger = useMutation({
    mutationFn: (id: string) => api.triggers.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['triggers'] });
      notify('success', 'Trigger rule deleted');
      setDeletingTriggerId(null);
    },
    onError: (err: Error) => notify('error', 'Failed to delete trigger', err.message),
  });

  const toggleTrigger = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.triggers.toggle(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['triggers'] });
    },
    onError: (err: Error) => notify('error', 'Failed to toggle trigger', err.message),
  });

  // ── Schedule mutations ────────────────────────────────────────
  const createSchedule = useMutation({
    mutationFn: (schedule: CronScheduleInput) => api.schedules.create(schedule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      notify('success', 'Schedule created');
      closeScheduleModal();
    },
    onError: (err: Error) => notify('error', 'Failed to create schedule', err.message),
  });

  const updateSchedule = useMutation({
    mutationFn: ({ id, schedule }: { id: string; schedule: Partial<CronScheduleInput> }) =>
      api.schedules.update(id, schedule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      notify('success', 'Schedule updated');
      closeScheduleModal();
    },
    onError: (err: Error) => notify('error', 'Failed to update schedule', err.message),
  });

  const deleteSchedule = useMutation({
    mutationFn: (id: string) => api.schedules.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      notify('success', 'Schedule deleted');
      setDeletingScheduleId(null);
    },
    onError: (err: Error) => notify('error', 'Failed to delete schedule', err.message),
  });

  const toggleSchedule = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.schedules.toggle(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
    onError: (err: Error) => notify('error', 'Failed to toggle schedule', err.message),
  });

  // ── Trigger modal helpers ─────────────────────────────────────
  function openAddTrigger() {
    setEditingTrigger(null);
    setTriggerForm(emptyTriggerForm);
    setTriggerModalOpen(true);
  }

  function openEditTrigger(t: TriggerRuleInfo) {
    setEditingTrigger(t);
    setTriggerForm({
      name: t.name,
      channel: t.channel,
      eventType: t.eventType,
      workflowId: t.workflowId,
      cooldownMs: t.cooldownMs ?? 0,
      maxConcurrent: t.maxConcurrent ?? 1,
    });
    setTriggerModalOpen(true);
  }

  function closeTriggerModal() {
    setTriggerModalOpen(false);
    setEditingTrigger(null);
  }

  function handleTriggerSubmit() {
    if (editingTrigger) {
      updateTrigger.mutate({ id: editingTrigger.id, rule: triggerForm });
    } else {
      createTrigger.mutate(triggerForm);
    }
  }

  // ── Schedule modal helpers ────────────────────────────────────
  function openAddSchedule() {
    setEditingSchedule(null);
    setScheduleForm(emptyScheduleForm);
    setScheduleInputJson('');
    setScheduleModalOpen(true);
  }

  function openEditSchedule(s: CronScheduleInfo) {
    setEditingSchedule(s);
    setScheduleForm({
      name: s.name,
      cron: s.cron,
      workflowId: s.workflowId,
      timezone: s.timezone ?? 'UTC',
    });
    setScheduleInputJson('');
    setScheduleModalOpen(true);
  }

  function closeScheduleModal() {
    setScheduleModalOpen(false);
    setEditingSchedule(null);
  }

  function handleScheduleSubmit() {
    let parsedInput: Record<string, unknown> | undefined;
    if (scheduleInputJson.trim()) {
      try {
        parsedInput = JSON.parse(scheduleInputJson);
      } catch {
        notify('error', 'Invalid JSON in input field');
        return;
      }
    }
    const payload: CronScheduleInput = { ...scheduleForm, input: parsedInput };

    if (editingSchedule) {
      updateSchedule.mutate({ id: editingSchedule.id, schedule: payload });
    } else {
      createSchedule.mutate(payload);
    }
  }

  const triggerSaving = createTrigger.isPending || updateTrigger.isPending;
  const scheduleSaving = createSchedule.isPending || updateSchedule.isPending;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Triggers &amp; Schedules</h1>

      {/* ── Trigger Rules ──────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium">Webhook Trigger Rules</h2>
          <Button variant="primary" size="sm" onClick={openAddTrigger}>
            Add Trigger Rule
          </Button>
        </div>
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary text-left text-foreground-subtle">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Workflow</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {triggersError ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-error">
                    Failed to load triggers: {triggersError.message}
                  </td>
                </tr>
              ) : !triggers?.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-foreground-subtle">
                    No trigger rules configured.
                  </td>
                </tr>
              ) : null}
              {triggers?.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-foreground">{t.name}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-accent-muted px-2 py-0.5 text-xs text-accent">
                      {t.channel}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground-muted">
                    {t.eventType}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{t.workflowId}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.enabled ? 'online' : 'offline'} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          toggleTrigger.mutate({ id: t.id, enabled: !t.enabled })
                        }
                      >
                        {t.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditTrigger(t)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingTriggerId(t.id)}
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
      </section>

      {/* ── Cron Schedules ─────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium">Cron Schedules</h2>
          <Button variant="primary" size="sm" onClick={openAddSchedule}>
            Add Schedule
          </Button>
        </div>
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary text-left text-foreground-subtle">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Cron</th>
                <th className="px-4 py-3 font-medium">Workflow</th>
                <th className="px-4 py-3 font-medium">Next Run</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedulesError ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-error">
                    Failed to load schedules: {schedulesError.message}
                  </td>
                </tr>
              ) : !schedules?.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-foreground-subtle">
                    No cron schedules configured.
                  </td>
                </tr>
              ) : null}
              {schedules?.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-foreground">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground-muted">{s.cron}</td>
                  <td className="px-4 py-3 text-foreground-muted">{s.workflowId}</td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {s.nextRun ? new Date(s.nextRun).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.enabled ? 'online' : 'offline'} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          toggleSchedule.mutate({ id: s.id, enabled: !s.enabled })
                        }
                      >
                        {s.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditSchedule(s)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingScheduleId(s.id)}
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
      </section>

      {/* ── Add / Edit Trigger Modal ─────────────────────────── */}
      <Modal
        open={triggerModalOpen}
        onClose={closeTriggerModal}
        title={editingTrigger ? 'Edit Trigger Rule' : 'Add Trigger Rule'}
        footer={
          <>
            <Button variant="ghost" onClick={closeTriggerModal} disabled={triggerSaving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleTriggerSubmit}
              loading={triggerSaving}
              disabled={!triggerForm.name || !triggerForm.eventType || !triggerForm.workflowId}
            >
              {editingTrigger ? 'Save Changes' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Name" htmlFor="trigger-name" required>
            <input
              id="trigger-name"
              className={inputClassName}
              value={triggerForm.name}
              onChange={(e) => setTriggerForm({ ...triggerForm, name: e.target.value })}
              placeholder="e.g. deploy-on-merge"
            />
          </FormField>

          <FormField label="Channel" htmlFor="trigger-channel" required>
            <select
              id="trigger-channel"
              className={selectClassName}
              value={triggerForm.channel}
              onChange={(e) => setTriggerForm({ ...triggerForm, channel: e.target.value })}
            >
              {CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Event Type" htmlFor="trigger-event" required>
            <input
              id="trigger-event"
              className={inputClassName}
              value={triggerForm.eventType}
              onChange={(e) => setTriggerForm({ ...triggerForm, eventType: e.target.value })}
              placeholder="e.g. push, merge_request"
            />
          </FormField>

          <FormField label="Workflow ID" htmlFor="trigger-workflow" required>
            <input
              id="trigger-workflow"
              className={inputClassName}
              value={triggerForm.workflowId}
              onChange={(e) => setTriggerForm({ ...triggerForm, workflowId: e.target.value })}
              placeholder="e.g. ci-pipeline"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Cooldown (ms)" htmlFor="trigger-cooldown">
              <input
                id="trigger-cooldown"
                type="number"
                min={0}
                className={inputClassName}
                value={triggerForm.cooldownMs ?? 0}
                onChange={(e) =>
                  setTriggerForm({ ...triggerForm, cooldownMs: Number(e.target.value) })
                }
              />
            </FormField>

            <FormField label="Max Concurrent" htmlFor="trigger-concurrent">
              <input
                id="trigger-concurrent"
                type="number"
                min={1}
                className={inputClassName}
                value={triggerForm.maxConcurrent ?? 1}
                onChange={(e) =>
                  setTriggerForm({ ...triggerForm, maxConcurrent: Number(e.target.value) })
                }
              />
            </FormField>
          </div>
        </div>
      </Modal>

      {/* ── Add / Edit Schedule Modal ────────────────────────── */}
      <Modal
        open={scheduleModalOpen}
        onClose={closeScheduleModal}
        title={editingSchedule ? 'Edit Schedule' : 'Add Schedule'}
        footer={
          <>
            <Button variant="ghost" onClick={closeScheduleModal} disabled={scheduleSaving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleScheduleSubmit}
              loading={scheduleSaving}
              disabled={!scheduleForm.name || !scheduleForm.cron || !scheduleForm.workflowId}
            >
              {editingSchedule ? 'Save Changes' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Name" htmlFor="schedule-name" required>
            <input
              id="schedule-name"
              className={inputClassName}
              value={scheduleForm.name}
              onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })}
              placeholder="e.g. nightly-sync"
            />
          </FormField>

          <FormField label="Cron Expression" htmlFor="schedule-cron" required hint="e.g. 0 2 * * *">
            <input
              id="schedule-cron"
              className={inputClassName}
              value={scheduleForm.cron}
              onChange={(e) => setScheduleForm({ ...scheduleForm, cron: e.target.value })}
              placeholder="0 2 * * *"
            />
          </FormField>

          <FormField label="Workflow ID" htmlFor="schedule-workflow" required>
            <input
              id="schedule-workflow"
              className={inputClassName}
              value={scheduleForm.workflowId}
              onChange={(e) => setScheduleForm({ ...scheduleForm, workflowId: e.target.value })}
              placeholder="e.g. nightly-build"
            />
          </FormField>

          <FormField label="Timezone" htmlFor="schedule-timezone">
            <input
              id="schedule-timezone"
              className={inputClassName}
              value={scheduleForm.timezone ?? 'UTC'}
              onChange={(e) => setScheduleForm({ ...scheduleForm, timezone: e.target.value })}
              placeholder="UTC"
            />
          </FormField>

          <FormField label="Input JSON" htmlFor="schedule-input" hint="Optional JSON object passed to the workflow">
            <textarea
              id="schedule-input"
              className={inputClassName + ' min-h-[80px] font-mono text-xs'}
              value={scheduleInputJson}
              onChange={(e) => setScheduleInputJson(e.target.value)}
              placeholder='{"key": "value"}'
            />
          </FormField>
        </div>
      </Modal>

      {/* ── Delete Trigger Confirmation ──────────────────────── */}
      <ConfirmDialog
        open={deletingTriggerId !== null}
        onClose={() => setDeletingTriggerId(null)}
        onConfirm={() => {
          if (deletingTriggerId) deleteTrigger.mutate(deletingTriggerId);
        }}
        title="Delete Trigger Rule"
        message="Are you sure you want to delete this trigger rule? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteTrigger.isPending}
      />

      {/* ── Delete Schedule Confirmation ─────────────────────── */}
      <ConfirmDialog
        open={deletingScheduleId !== null}
        onClose={() => setDeletingScheduleId(null)}
        onConfirm={() => {
          if (deletingScheduleId) deleteSchedule.mutate(deletingScheduleId);
        }}
        title="Delete Schedule"
        message="Are you sure you want to delete this cron schedule? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteSchedule.isPending}
      />
    </div>
  );
}
