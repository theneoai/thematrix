'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { StatusBadge } from '@/components/shared/StatusBadge';

const severityColors: Record<string, string> = {
  critical: 'text-error',
  warning: 'text-warning',
  info: 'text-info',
};

export default function AlertsPage() {
  const { data: alerts } = useQuery({ queryKey: ['alerts'], queryFn: api.alerts.active });
  const { data: rules } = useQuery({ queryKey: ['alert-rules'], queryFn: api.alerts.rules });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Alerts & Notifications</h1>

      {/* Active Alerts */}
      <section>
        <h2 className="text-lg font-medium mb-4">
          Active Alerts
          {alerts?.length ? (
            <span className="ml-2 rounded-full bg-error/20 px-2 py-0.5 text-xs text-error">
              {alerts.length}
            </span>
          ) : null}
        </h2>

        {!alerts?.length ? (
          <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-foreground-subtle">
            No active alerts. All systems healthy.
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div key={alert.id} className="rounded-lg border border-border bg-background-secondary p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`text-lg ${severityColors[alert.severity] ?? 'text-info'}`}>
                      {alert.severity === 'critical' ? '●' : alert.severity === 'warning' ? '▲' : 'ℹ'}
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
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Alert Rules */}
      <section>
        <h2 className="text-lg font-medium mb-4">Alert Rules</h2>
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary text-left text-foreground-subtle">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Metric</th>
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rules?.map((rule) => (
                <tr key={rule.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-foreground">{rule.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground-muted">{rule.metric}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${severityColors[rule.severity]}`}>
                      {rule.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={rule.enabled ? 'online' : 'offline'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
