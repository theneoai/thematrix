/**
 * TokenPool - Budget and rate limiting tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenPool } from './pool.js';

describe('TokenPool', () => {
  let pool: TokenPool;

  beforeEach(() => {
    pool = new TokenPool();
  });

  describe('allocation', () => {
    it('should allocate a budget', () => {
      pool.allocate('agent-1', 'agent', {
        maxTokens: 10000,
        period: 'daily',
      });
      const usage = pool.getUsage('agent-1');
      expect(usage).toBeDefined();
      expect(usage!.totalTokens).toBe(0);
    });

    it('should return remaining budget correctly', () => {
      pool.allocate('agent-1', 'agent', { maxTokens: 10000, period: 'daily' });
      expect(pool.getRemainingBudget('agent-1')).toBe(10000);
    });

    it('should return 0 for unallocated owner', () => {
      expect(pool.getRemainingBudget('nonexistent')).toBe(0);
    });

    it('should initialize usage with correct owner info', () => {
      pool.allocate('agent-1', 'agent', { maxTokens: 5000, period: 'daily' });
      const usage = pool.getUsage('agent-1');
      expect(usage!.ownerId).toBe('agent-1');
      expect(usage!.ownerType).toBe('agent');
      expect(usage!.totalCostUsd).toBe(0);
      expect(usage!.breakdown).toHaveLength(0);
    });

    it('should set periodStart on allocation', () => {
      pool.allocate('agent-1', 'agent', { maxTokens: 5000, period: 'daily' });
      const usage = pool.getUsage('agent-1');
      expect(usage!.periodStart).toBeInstanceOf(Date);
    });

    it('should overwrite existing budget on re-allocate', () => {
      pool.allocate('agent-1', 'agent', { maxTokens: 5000, period: 'daily' });
      pool.allocate('agent-1', 'agent', { maxTokens: 10000, period: 'hourly' });
      expect(pool.getRemainingBudget('agent-1')).toBe(10000);
    });

    it('should support different owner types', () => {
      pool.allocate('agent-1', 'agent', { maxTokens: 5000, period: 'daily' });
      pool.allocate('wf-1', 'workflow', { maxTokens: 50000, period: 'daily' });
      pool.allocate('global-1', 'global', { maxTokens: 500000, period: 'daily' });

      expect(pool.getUsage('agent-1')!.ownerType).toBe('agent');
      expect(pool.getUsage('wf-1')!.ownerType).toBe('workflow');
      expect(pool.getUsage('global-1')!.ownerType).toBe('global');
    });
  });

  describe('consumption', () => {
    beforeEach(() => {
      pool.allocate('agent-1', 'agent', {
        maxTokens: 1000,
        period: 'daily',
        alertThreshold: 0.8,
      });
    });

    it('should track token consumption', async () => {
      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
      });

      const usage = pool.getUsage('agent-1');
      expect(usage!.totalTokens).toBe(150);
      expect(usage!.totalCostUsd).toBe(0.01);
      expect(pool.getRemainingBudget('agent-1')).toBe(850);
    });

    it('should reject consumption exceeding budget', async () => {
      await expect(
        pool.consume('agent-1', {
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 600,
          outputTokens: 500,
          costUsd: 0.05,
        }),
      ).rejects.toThrow('Token budget exceeded');
    });

    it('should allow consumption up to the exact budget limit', async () => {
      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 500,
        outputTokens: 500,
      });

      const usage = pool.getUsage('agent-1');
      expect(usage!.totalTokens).toBe(1000);
      expect(pool.getRemainingBudget('agent-1')).toBe(0);
    });

    it('should reject consumption after budget is exhausted', async () => {
      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 500,
        outputTokens: 500,
      });

      await expect(
        pool.consume('agent-1', {
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 1,
          outputTokens: 0,
        }),
      ).rejects.toThrow('Token budget exceeded');
    });

    it('should track breakdown by provider and model', async () => {
      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
      });
      await pool.consume('agent-1', {
        provider: 'anthropic',
        model: 'claude-3',
        inputTokens: 50,
        outputTokens: 25,
      });

      const usage = pool.getUsage('agent-1');
      expect(usage!.breakdown).toHaveLength(2);
      expect(usage!.breakdown.find(b => b.provider === 'openai')!.totalTokens).toBe(150);
      expect(usage!.breakdown.find(b => b.provider === 'anthropic')!.totalTokens).toBe(75);
    });

    it('should accumulate breakdown for same provider/model', async () => {
      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
      });
      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 50,
        outputTokens: 25,
      });

      const usage = pool.getUsage('agent-1');
      expect(usage!.breakdown).toHaveLength(1);
      const bd = usage!.breakdown[0];
      expect(bd.inputTokens).toBe(150);
      expect(bd.outputTokens).toBe(75);
      expect(bd.totalTokens).toBe(225);
      expect(bd.requestCount).toBe(2);
    });

    it('should fire warning callback at threshold', async () => {
      const onWarning = vi.fn();
      pool = new TokenPool({ onBudgetWarning: onWarning });
      pool.allocate('agent-1', 'agent', {
        maxTokens: 1000,
        period: 'daily',
        alertThreshold: 0.8,
      });

      // Consume 800/1000 = 80% (at threshold)
      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 500,
        outputTokens: 300,
      });

      expect(onWarning).toHaveBeenCalledOnce();
    });

    it('should fire exceeded callback when budget is exceeded', async () => {
      const onExceeded = vi.fn();
      pool = new TokenPool({ onBudgetExceeded: onExceeded });
      pool.allocate('agent-1', 'agent', {
        maxTokens: 100,
        period: 'daily',
      });

      await expect(
        pool.consume('agent-1', {
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 60,
          outputTokens: 60,
        }),
      ).rejects.toThrow('Token budget exceeded');

      expect(onExceeded).toHaveBeenCalledOnce();
    });

    it('should not track consumption for unknown owner', async () => {
      await pool.consume('unknown', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
      });
      // Should not throw, just warn
      expect(pool.getUsage('unknown')).toBeUndefined();
    });

    it('should handle zero-cost consumption', async () => {
      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
      });

      const usage = pool.getUsage('agent-1');
      expect(usage!.totalCostUsd).toBe(0);
    });

    it('should accumulate cost across multiple consumptions', async () => {
      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
      });
      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.02,
      });

      const usage = pool.getUsage('agent-1');
      expect(usage!.totalCostUsd).toBeCloseTo(0.03);
    });
  });

  describe('unlimited budget', () => {
    it('should allow unlimited consumption', async () => {
      pool.allocate('agent-1', 'agent', { maxTokens: 999999, period: 'unlimited' });

      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 500000,
        outputTokens: 500000,
      });

      expect(pool.getRemainingBudget('agent-1')).toBe(Infinity);
    });

    it('should still track tokens for unlimited budget', async () => {
      pool.allocate('agent-1', 'agent', { maxTokens: 999999, period: 'unlimited' });

      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
      });

      const usage = pool.getUsage('agent-1');
      expect(usage!.totalTokens).toBe(150);
    });

    it('should never reject for unlimited budget', async () => {
      pool.allocate('agent-1', 'agent', { maxTokens: 1, period: 'unlimited' });

      // Even though maxTokens is 1, unlimited period should allow any consumption
      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 10000,
        outputTokens: 10000,
      });

      expect(pool.getUsage('agent-1')!.totalTokens).toBe(20000);
    });
  });

  describe('rate limiting', () => {
    it('should allow requests within rate limit', () => {
      pool.setRateLimit('openai', { rpm: 10, tpm: 1000 });
      expect(pool.canRequest('openai')).toBe(true);
    });

    it('should allow requests for unknown provider (no rate limit set)', () => {
      expect(pool.canRequest('openai')).toBe(true);
    });

    it('should block requests exceeding concurrent limit', () => {
      pool.setRateLimit('openai', { maxConcurrent: 2 });
      pool.acquireConcurrent('openai');
      pool.acquireConcurrent('openai');
      expect(pool.canRequest('openai')).toBe(false);
      pool.releaseConcurrent('openai');
      expect(pool.canRequest('openai')).toBe(true);
    });

    it('should not decrement concurrent below zero', () => {
      pool.setRateLimit('openai', { maxConcurrent: 2 });
      pool.releaseConcurrent('openai'); // release without acquire
      pool.acquireConcurrent('openai');
      pool.acquireConcurrent('openai');
      // Should still hit the limit at 2
      expect(pool.canRequest('openai')).toBe(false);
    });

    it('should track RPM via consume()', async () => {
      pool.setRateLimit('openai', { rpm: 2, tpm: 100000 });
      pool.allocate('test', 'global', { maxTokens: 100000, period: 'unlimited' });

      await pool.consume('test', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 10,
        outputTokens: 5,
      });
      await pool.consume('test', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 10,
        outputTokens: 5,
      });

      // 2 requests made, rpm=2, should now be blocked
      expect(pool.canRequest('openai')).toBe(false);
    });

    it('should track TPM via consume()', async () => {
      pool.setRateLimit('openai', { tpm: 100 });
      pool.allocate('test', 'global', { maxTokens: 100000, period: 'unlimited' });

      await pool.consume('test', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 50,
        outputTokens: 50,
      });

      // 100 tokens used, tpm=100, should now be blocked
      expect(pool.canRequest('openai')).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset usage', async () => {
      pool.allocate('agent-1', 'agent', { maxTokens: 1000, period: 'daily' });
      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 500,
        outputTokens: 200,
      });

      pool.resetUsage('agent-1');
      const usage = pool.getUsage('agent-1');
      expect(usage!.totalTokens).toBe(0);
      expect(usage!.totalCostUsd).toBe(0);
      expect(usage!.breakdown).toHaveLength(0);
    });

    it('should restore full budget after reset', async () => {
      pool.allocate('agent-1', 'agent', { maxTokens: 1000, period: 'daily' });
      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 500,
        outputTokens: 200,
      });

      pool.resetUsage('agent-1');
      expect(pool.getRemainingBudget('agent-1')).toBe(1000);
    });

    it('should not throw when resetting nonexistent owner', () => {
      // Should not throw
      pool.resetUsage('nonexistent');
    });

    it('should update periodStart on reset', async () => {
      pool.allocate('agent-1', 'agent', { maxTokens: 1000, period: 'daily' });
      const originalStart = pool.getUsage('agent-1')!.periodStart;

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));
      pool.resetUsage('agent-1');

      const newStart = pool.getUsage('agent-1')!.periodStart;
      expect(newStart.getTime()).toBeGreaterThanOrEqual(originalStart.getTime());
    });
  });

  describe('provider restrictions', () => {
    it('should reject consumption from disallowed provider', async () => {
      pool.allocate('agent-1', 'agent', {
        maxTokens: 10000,
        period: 'daily',
        providers: ['openai'],
      });

      await expect(
        pool.consume('agent-1', {
          provider: 'anthropic',
          model: 'claude-3',
          inputTokens: 100,
          outputTokens: 50,
        }),
      ).rejects.toThrow('not allowed');
    });

    it('should allow consumption from allowed provider', async () => {
      pool.allocate('agent-1', 'agent', {
        maxTokens: 10000,
        period: 'daily',
        providers: ['openai', 'anthropic'],
      });

      await pool.consume('agent-1', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
      });

      await pool.consume('agent-1', {
        provider: 'anthropic',
        model: 'claude-3',
        inputTokens: 100,
        outputTokens: 50,
      });

      expect(pool.getUsage('agent-1')!.totalTokens).toBe(300);
    });

    it('should allow any provider when providers list is not set', async () => {
      pool.allocate('agent-1', 'agent', {
        maxTokens: 10000,
        period: 'daily',
      });

      await pool.consume('agent-1', {
        provider: 'anthropic',
        model: 'claude-3',
        inputTokens: 100,
        outputTokens: 50,
      });

      expect(pool.getUsage('agent-1')!.totalTokens).toBe(150);
    });
  });

  describe('getGlobalUsage', () => {
    it('should return all budgets', () => {
      pool.allocate('agent-1', 'agent', { maxTokens: 1000, period: 'daily' });
      pool.allocate('agent-2', 'agent', { maxTokens: 2000, period: 'daily' });

      const globalUsage = pool.getGlobalUsage();
      expect(globalUsage).toHaveLength(2);
    });

    it('should return empty array when no budgets', () => {
      expect(pool.getGlobalUsage()).toHaveLength(0);
    });
  });

  describe('getBudget', () => {
    it('should return budget for existing owner', () => {
      pool.allocate('agent-1', 'agent', { maxTokens: 5000, period: 'daily' });
      const budget = pool.getBudget('agent-1');
      expect(budget).toBeDefined();
      expect(budget!.maxTokens).toBe(5000);
      expect(budget!.period).toBe('daily');
    });

    it('should return undefined for nonexistent owner', () => {
      expect(pool.getBudget('nonexistent')).toBeUndefined();
    });
  });
});
