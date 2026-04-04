'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';

const navigation = [
  { name: 'Overview', href: '/', icon: '◎' },
  { name: 'Workflows', href: '/workflows', icon: '⬡' },
  { name: 'Agents', href: '/agents', icon: '◆' },
  { name: 'Providers', href: '/providers', icon: '⊡' },
  { name: 'Triggers', href: '/triggers', icon: '⚡' },
  { name: 'Cluster', href: '/cluster', icon: '⬢' },
  { name: 'Alerts', href: '/alerts', icon: '▲' },
  { name: 'Settings', href: '/settings', icon: '⚙' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 flex-col border-r border-border bg-background-secondary">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <span className="text-accent text-xl font-bold">◈</span>
        <span className="font-semibold text-foreground">TheMatrix</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-3">
        {navigation.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-accent-muted text-accent'
                  : 'text-foreground-muted hover:bg-background-tertiary hover:text-foreground'
              )}
            >
              <span className="text-base">{item.icon}</span>
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-4">
        <div className="text-xs text-foreground-subtle">
          <kbd className="rounded border border-border bg-background-tertiary px-1.5 py-0.5 text-[10px]">
            Cmd+K
          </kbd>
          <span className="ml-2">Quick search</span>
        </div>
      </div>
    </aside>
  );
}
