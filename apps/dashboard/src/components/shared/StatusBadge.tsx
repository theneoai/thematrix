'use client';

import { clsx } from 'clsx';

const statusStyles: Record<string, { bg: string; text: string; dot: string }> = {
  running: { bg: 'bg-info/10', text: 'text-info', dot: 'bg-info' },
  completed: { bg: 'bg-success/10', text: 'text-success', dot: 'bg-success' },
  failed: { bg: 'bg-error/10', text: 'text-error', dot: 'bg-error' },
  paused: { bg: 'bg-warning/10', text: 'text-warning', dot: 'bg-warning' },
  cancelled: { bg: 'bg-foreground-subtle/10', text: 'text-foreground-subtle', dot: 'bg-foreground-subtle' },
  pending: { bg: 'bg-foreground-subtle/10', text: 'text-foreground-muted', dot: 'bg-foreground-muted' },
  online: { bg: 'bg-success/10', text: 'text-success', dot: 'bg-success' },
  offline: { bg: 'bg-error/10', text: 'text-error', dot: 'bg-error' },
  draining: { bg: 'bg-warning/10', text: 'text-warning', dot: 'bg-warning' },
  firing: { bg: 'bg-error/10', text: 'text-error', dot: 'bg-error animate-pulse' },
  resolved: { bg: 'bg-success/10', text: 'text-success', dot: 'bg-success' },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = statusStyles[status] ?? statusStyles.pending;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        style.bg,
        style.text,
        className,
      )}
    >
      <span className={clsx('h-1.5 w-1.5 rounded-full', style.dot)} />
      {status}
    </span>
  );
}
