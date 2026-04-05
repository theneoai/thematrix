'use client';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Provider Configuration */}
        <section className="rounded-lg border border-border bg-background-secondary p-6">
          <h2 className="text-lg font-medium mb-4">Provider Configuration</h2>
          <p className="text-sm text-foreground-muted mb-4">
            Configure LLM providers, API keys, and rate limits.
          </p>
          <p className="text-xs text-foreground-subtle">
            Edit <code className="rounded bg-background-tertiary px-1.5 py-0.5 font-mono">matrix.config.yaml</code> to configure providers.
          </p>
        </section>

        {/* MCP Servers */}
        <section className="rounded-lg border border-border bg-background-secondary p-6">
          <h2 className="text-lg font-medium mb-4">MCP Servers</h2>
          <p className="text-sm text-foreground-muted mb-4">
            Manage Model Context Protocol server connections for tool integration.
          </p>
          <p className="text-xs text-foreground-subtle">Coming soon</p>
        </section>

        {/* Plugins */}
        <section className="rounded-lg border border-border bg-background-secondary p-6">
          <h2 className="text-lg font-medium mb-4">Plugins</h2>
          <p className="text-sm text-foreground-muted mb-4">
            Install and manage plugins for extended functionality.
          </p>
          <p className="text-xs text-foreground-subtle">Coming soon</p>
        </section>

        {/* Skills */}
        <section className="rounded-lg border border-border bg-background-secondary p-6">
          <h2 className="text-lg font-medium mb-4">Skills</h2>
          <p className="text-sm text-foreground-muted mb-4">
            Manage agent skills and tool packages.
          </p>
          <p className="text-xs text-foreground-subtle">Coming soon</p>
        </section>
      </div>
    </div>
  );
}
