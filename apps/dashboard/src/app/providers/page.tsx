'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export default function ProvidersPage() {
  const { data: tokenUsage, error } = useQuery({
    queryKey: ['token-usage'],
    queryFn: api.tokens.usage,
  });

  const totalTokens = tokenUsage?.reduce((sum, u) => sum + u.totalTokens, 0) ?? 0;
  const totalCost = tokenUsage?.reduce((sum, u) => sum + u.totalCostUsd, 0) ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Model Providers & Token Pool</h1>

      {error && (
        <div className="rounded-lg border border-border bg-background-secondary p-8 text-center text-error">
          Failed to load token usage: {error.message}
        </div>
      )}

      {/* Token Pool Overview */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle">Total Tokens Used</p>
          <p className="mt-1 text-2xl font-semibold text-accent">
            {totalTokens > 1_000_000 ? `${(totalTokens / 1_000_000).toFixed(2)}M` : totalTokens.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle">Total Cost</p>
          <p className="mt-1 text-2xl font-semibold text-warning">${totalCost.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-border bg-background-secondary p-4">
          <p className="text-xs text-foreground-subtle">Active Providers</p>
          <p className="mt-1 text-2xl font-semibold text-success">
            {new Set(tokenUsage?.map(u => u.ownerId)).size}
          </p>
        </div>
      </div>

      {/* Usage by Owner */}
      <div>
        <h2 className="text-lg font-medium mb-4">Token Usage by Owner</h2>
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary text-left text-foreground-subtle">
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Tokens</th>
                <th className="px-4 py-3 font-medium">Cost</th>
                <th className="px-4 py-3 font-medium">Usage</th>
              </tr>
            </thead>
            <tbody>
              {tokenUsage?.map((usage) => (
                <tr key={usage.ownerId} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{usage.ownerId}</td>
                  <td className="px-4 py-3 text-foreground-muted">{usage.ownerType}</td>
                  <td className="px-4 py-3 text-foreground">{usage.totalTokens.toLocaleString()}</td>
                  <td className="px-4 py-3 text-warning">${usage.totalCostUsd.toFixed(4)}</td>
                  <td className="px-4 py-3">
                    <div className="h-2 w-24 rounded-full bg-background-tertiary">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.min(100, (usage.totalTokens / (totalTokens || 1)) * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
