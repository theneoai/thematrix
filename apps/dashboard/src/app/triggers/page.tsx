'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StatusBadge } from '@/components/shared/StatusBadge';

export default function TriggersPage() {
  const { data: triggers } = useQuery({ queryKey: ['triggers'], queryFn: api.triggers.list });
  const { data: schedules } = useQuery({ queryKey: ['schedules'], queryFn: api.schedules.list });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Triggers & Schedules</h1>

      {/* Trigger Rules */}
      <section>
        <h2 className="text-lg font-medium mb-4">Webhook Trigger Rules</h2>
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary text-left text-foreground-subtle">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Workflow</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {triggers?.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-foreground">{t.name}</td>
                  <td className="px-4 py-3"><span className="rounded bg-accent-muted px-2 py-0.5 text-xs text-accent">{t.channel}</span></td>
                  <td className="px-4 py-3 text-foreground-muted font-mono text-xs">{t.eventType}</td>
                  <td className="px-4 py-3 text-foreground-muted">{t.workflowId}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.enabled ? 'online' : 'offline'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cron Schedules */}
      <section>
        <h2 className="text-lg font-medium mb-4">Cron Schedules</h2>
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary text-left text-foreground-subtle">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Cron</th>
                <th className="px-4 py-3 font-medium">Workflow</th>
                <th className="px-4 py-3 font-medium">Next Run</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {schedules?.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-foreground">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground-muted">{s.cron}</td>
                  <td className="px-4 py-3 text-foreground-muted">{s.workflowId}</td>
                  <td className="px-4 py-3 text-foreground-muted">{s.nextRun ? new Date(s.nextRun).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={s.enabled ? 'online' : 'offline'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
