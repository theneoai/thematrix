'use client';

import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useUIStore } from '@/stores/ui';
import { api } from '@/lib/api-client';

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/workflows': 'Workflows',
  '/agents': 'Agent Catalog',
  '/providers': 'Model Providers & Token Pool',
  '/triggers': 'Triggers & Schedules',
  '/cluster': 'Cluster Management',
  '/alerts': 'Alerts & Notifications',
  '/approvals': 'Approval Requests',
  '/settings': 'Settings',
};

export function Header() {
  const pathname = usePathname();
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);

  const { data: health, error } = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 30_000,
    retry: 1,
  });

  const isConnected = !error && health?.status === 'ok';
  const title = titles[pathname] ?? 'TheMatrix';

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background-secondary px-6">
      <h2 className="text-sm font-medium text-foreground-muted">{title}</h2>

      <div className="flex items-center gap-4">
        {/* Search trigger */}
        <button
          onClick={openCommandPalette}
          className="flex items-center gap-2 rounded-md border border-border bg-background-tertiary px-3 py-1.5 text-sm text-foreground-subtle transition-colors hover:border-border-hover hover:text-foreground-muted"
        >
          <span>Search...</span>
          <kbd className="text-[10px] border border-border rounded px-1 py-0.5">
            Cmd+K
          </kbd>
        </button>

        {/* Connection indicator */}
        <div className="flex items-center gap-1.5 text-xs text-foreground-subtle">
          <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-success' : 'bg-error'}`} />
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </div>
    </header>
  );
}
