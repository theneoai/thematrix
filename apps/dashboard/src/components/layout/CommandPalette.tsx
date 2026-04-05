'use client';

import { useEffect } from 'react';
import { Command } from 'cmdk';
import { useUIStore } from '@/stores/ui';
import { useRouter } from 'next/navigation';

const actions = [
  { id: 'nav-overview', label: 'Go to Dashboard', section: 'Navigation', href: '/' },
  { id: 'nav-workflows', label: 'Go to Workflows', section: 'Navigation', href: '/workflows' },
  { id: 'nav-agents', label: 'Go to Agents', section: 'Navigation', href: '/agents' },
  { id: 'nav-providers', label: 'Go to Providers', section: 'Navigation', href: '/providers' },
  { id: 'nav-triggers', label: 'Go to Triggers', section: 'Navigation', href: '/triggers' },
  { id: 'nav-cluster', label: 'Go to Cluster', section: 'Navigation', href: '/cluster' },
  { id: 'nav-alerts', label: 'Go to Alerts', section: 'Navigation', href: '/alerts' },
  { id: 'nav-settings', label: 'Go to Settings', section: 'Navigation', href: '/settings' },
];

export function CommandPalette() {
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const closeCommandPalette = useUIStore((s) => s.closeCommandPalette);
  const router = useRouter();

  // Global Cmd+K shortcut — stable listener, reads state from store directly
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const store = useUIStore.getState();
        if (store.commandPaletteOpen) {
          store.closeCommandPalette();
        } else {
          store.openCommandPalette();
        }
      }
      if (e.key === 'Escape') {
        useUIStore.getState().closeCommandPalette();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!commandPaletteOpen) return null;

  const groupedActions = actions.reduce<Record<string, typeof actions>>((groups, action) => {
    (groups[action.section] ||= []).push(action);
    return groups;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={closeCommandPalette}
      />

      {/* Command dialog */}
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-background-secondary shadow-2xl">
        <Command className="flex flex-col" label="Command palette">
          <Command.Input
            className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground-subtle"
            placeholder="Search workflows, agents, actions..."
            autoFocus
          />

          <Command.List className="max-h-80 overflow-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-foreground-subtle">
              No results found.
            </Command.Empty>

            {Object.entries(groupedActions).map(([section, items]) => (
              <Command.Group
                key={section}
                heading={section}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-foreground-subtle"
              >
                {items.map((action) => (
                  <Command.Item
                    key={action.id}
                    value={action.label}
                    onSelect={() => {
                      if (action.href) router.push(action.href);
                      closeCommandPalette();
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground-muted aria-selected:bg-accent-muted aria-selected:text-accent"
                  >
                    {action.label}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
