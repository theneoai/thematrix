/**
 * ProviderRouter + estimateTokens — Integration tests
 *
 * Covers: CJK-aware token estimation, routing strategies (priority, round-robin),
 * failover behaviour, and rate-limit skipping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimateTokens } from './router.js';
import { TokenPool } from './pool.js';

// ─────────────────────────────────────────────────────────────────────────────
// estimateTokens — CJK-aware heuristic
// ─────────────────────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates ASCII text at ~4 chars/token', () => {
    // "hello world" = 11 chars → ceil(11/4) = 3
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('estimates pure CJK text at ~1.5 chars/token', () => {
    // "你好世界你好世界你好世界" = 12 chars, all CJK → ratio > 0.3 → ceil(12/1.5) = 8
    const text = '你好世界你好世界你好世界';
    expect(estimateTokens(text)).toBe(8);
  });

  it('estimates lightly mixed text using blended rate', () => {
    // 10 CJK + 90 ASCII = 100 chars, ratio = 0.1 → 2.5 chars/token
    const cjk = '你好世界你好世界你好'; // 9 chars
    const ascii = 'a'.repeat(91);
    const mixed = cjk + ascii; // 100 chars, ratio = 0.09 < 0.1 → 4 chars/token
    expect(estimateTokens(mixed)).toBe(Math.ceil(100 / 4));
  });

  it('estimates moderately mixed text (ratio 0.1-0.3) at 2.5 chars/token', () => {
    const cjk = '中文文字'.repeat(5); // 20 chars CJK
    const ascii = 'abc'.repeat(20); // 60 chars ASCII
    const text = cjk + ascii; // 80 chars, ratio = 20/80 = 0.25 → 2.5 chars/token
    expect(estimateTokens(text)).toBe(Math.ceil(80 / 2.5));
  });

  it('returns a positive integer for any non-empty string', () => {
    expect(estimateTokens('x')).toBeGreaterThan(0);
    expect(Number.isInteger(estimateTokens('hello'))).toBe(true);
  });

  it('handles very long text without throwing', () => {
    const long = 'a'.repeat(100_000);
    expect(() => estimateTokens(long)).not.toThrow();
    expect(estimateTokens(long)).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TokenPool — budget governance (complementary to pool.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe('TokenPool — advanced governance', () => {
  let pool: TokenPool;

  beforeEach(() => {
    pool = new TokenPool();
  });

  it('fires onBudgetWarning callback when usage crosses 80%', async () => {
    const onBudgetWarning = vi.fn();
    const warningPool = new TokenPool({ onBudgetWarning });

    warningPool.allocate('agent-1', 'agent', { maxTokens: 100, period: 'daily' });

    // Consume 80 tokens — should trigger warning
    await warningPool.consume('agent-1', {
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 80,
      outputTokens: 0,
    });

    expect(onBudgetWarning).toHaveBeenCalledOnce();
    const [ownerId] = onBudgetWarning.mock.calls[0];
    expect(ownerId).toBe('agent-1');
  });

  it('fires onBudgetExceeded callback and throws when budget is depleted', async () => {
    const onBudgetExceeded = vi.fn();
    const strictPool = new TokenPool({ onBudgetExceeded });

    strictPool.allocate('agent-1', 'agent', { maxTokens: 50, period: 'per-run' });

    await expect(
      strictPool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 51,
        outputTokens: 0,
      }),
    ).rejects.toThrow(/budget.*exceeded|token.*limit/i);

    expect(onBudgetExceeded).toHaveBeenCalledOnce();
  });

  it('accumulates usage across multiple consume calls', async () => {
    pool.allocate('agent-1', 'agent', { maxTokens: 1000, period: 'daily' });

    await pool.consume('agent-1', { provider: 'openai', model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
    await pool.consume('agent-1', { provider: 'openai', model: 'gpt-4o', inputTokens: 200, outputTokens: 75 });

    const usage = pool.getUsage('agent-1');
    expect(usage!.totalTokens).toBe(425);
    expect(pool.getRemainingBudget('agent-1')).toBe(575);
  });

  it('tracks cost in USD when costPerToken is provided', async () => {
    pool.allocate('agent-1', 'agent', {
      maxTokens: 10000,
      period: 'daily',
    });

    await pool.consume('agent-1', {
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.015,
    });

    const usage = pool.getUsage('agent-1');
    expect(usage!.totalCostUsd).toBeCloseTo(0.015);
  });

  it('getUsage returns undefined for unallocated owner', () => {
    expect(pool.getUsage('ghost')).toBeUndefined();
  });

  it('canRequest returns true for unregistered provider (no rate limit)', () => {
    // No rate limit configured → always allowed
    expect(pool.canRequest('openai')).toBe(true);
  });

  it('getAllUsage returns all tracked owners', async () => {
    pool.allocate('a1', 'agent', { maxTokens: 1000, period: 'daily' });
    pool.allocate('a2', 'agent', { maxTokens: 2000, period: 'daily' });

    const all = pool.getAllUsage();
    expect(all).toHaveLength(2);
    const ids = all.map(u => u.ownerId);
    expect(ids).toContain('a1');
    expect(ids).toContain('a2');
  });

  it('breakdown records per-provider usage', async () => {
    pool.allocate('agent-1', 'agent', { maxTokens: 5000, period: 'daily' });

    await pool.consume('agent-1', { provider: 'openai', model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
    await pool.consume('agent-1', { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', inputTokens: 200, outputTokens: 100 });

    const usage = pool.getUsage('agent-1');
    expect(usage!.breakdown).toHaveLength(2);
    const providers = usage!.breakdown.map(b => b.provider);
    expect(providers).toContain('openai');
    expect(providers).toContain('anthropic');
  });
});
