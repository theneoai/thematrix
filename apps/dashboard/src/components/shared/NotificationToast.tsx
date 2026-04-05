'use client';

import { useNotificationStore, type NotificationType } from '@/stores/notifications';
import { clsx } from 'clsx';

const typeStyles: Record<NotificationType, { bg: string; icon: string }> = {
  success: { bg: 'border-success/40 bg-success/10', icon: '✓' },
  error: { bg: 'border-error/40 bg-error/10', icon: '✕' },
  warning: { bg: 'border-warning/40 bg-warning/10', icon: '▲' },
  info: { bg: 'border-accent/40 bg-accent/10', icon: 'ℹ' },
};

export function NotificationToast() {
  const { notifications, removeNotification } = useNotificationStore();

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {notifications.map((n) => {
        const style = typeStyles[n.type];
        return (
          <div
            key={n.id}
            className={clsx(
              'rounded-lg border px-4 py-3 shadow-lg animate-in slide-in-from-right',
              style.bg,
            )}
          >
            <div className="flex items-start gap-2">
              <span className="text-sm mt-0.5">{style.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{n.title}</p>
                {n.message && <p className="text-xs text-foreground-muted mt-0.5">{n.message}</p>}
              </div>
              <button
                onClick={() => removeNotification(n.id)}
                className="text-foreground-subtle hover:text-foreground text-sm"
              >
                &times;
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
