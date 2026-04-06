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
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  const { data: health, error } = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 30_000,
    retry: 1,
  });

  const isConnected = !error && health?.status === 'ok';
  const title = titles[pathname] ?? 'TheMatrix';

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  }

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
            {typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+'}K
          </kbd>
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center h-8 w-8 rounded-md border border-border bg-background-tertiary text-foreground-subtle transition-colors hover:border-border-hover hover:text-foreground-muted"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
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
