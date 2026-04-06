/**
 * Token Resource Pool - Token 预算分配、限流、用量追踪
 */

import type {
  ITokenPool,
  TokenBudget,
  TokenUsage,
  TokenUsageBreakdown,
  TokenConsumption,
  ProviderName,
  RateLimitConfig,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'TokenPool' });

interface BudgetEntry {
  ownerId: string;
  ownerType: 'agent' | 'workflow' | 'global';
  budget: TokenBudget;
  usage: TokenUsage;
}

interface RateLimitState {
  config: RateLimitConfig;
  requestsInWindow: number;
  tokensInWindow: number;
  windowStart: number;
  concurrentRequests: number;
}

/** Milliseconds per budget period */
function periodToMs(period: string): number | null {
  switch (period) {
    case 'hourly': return 60 * 60 * 1000;
    case 'daily': return 24 * 60 * 60 * 1000;
    case 'monthly': return 30 * 24 * 60 * 60 * 1000;
    default: return null; // 'unlimited' or unknown
  }
}

export class TokenPool implements ITokenPool {
  private budgets = new Map<string, BudgetEntry>();
  private rateLimits = new Map<ProviderName, RateLimitState>();
  private onBudgetWarning?: (ownerId: string, usage: TokenUsage, budget: TokenBudget) => void;
  private onBudgetExceeded?: (ownerId: string, usage: TokenUsage, budget: TokenBudget) => void;

  constructor(options?: {
    onBudgetWarning?: (ownerId: string, usage: TokenUsage, budget: TokenBudget) => void;
    onBudgetExceeded?: (ownerId: string, usage: TokenUsage, budget: TokenBudget) => void;
  }) {
    this.onBudgetWarning = options?.onBudgetWarning;
    this.onBudgetExceeded = options?.onBudgetExceeded;
  }

  allocate(ownerId: string, ownerType: 'agent' | 'workflow' | 'global', budget: TokenBudget): void {
    const entry: BudgetEntry = {
      ownerId,
      ownerType,
      budget,
      usage: {
        ownerId,
        ownerType,
        totalTokens: 0,
        totalCostUsd: 0,
        periodStart: new Date(),
        breakdown: [],
      },
    };
    this.budgets.set(ownerId, entry);
    logger.info(`Budget allocated for ${ownerType}:${ownerId} — ${budget.maxTokens} tokens, period: ${budget.period}`);
  }

  /**
   * Reset usage for a budget entry if its period has elapsed.
   * Returns true if reset was performed.
   */
  private resetIfPeriodElapsed(entry: BudgetEntry): boolean {
    const ms = periodToMs(entry.budget.period);
    if (ms === null) return false;

    const elapsed = Date.now() - entry.usage.periodStart.getTime();
    if (elapsed >= ms) {
      entry.usage.totalTokens = 0;
      entry.usage.totalCostUsd = 0;
      entry.usage.periodStart = new Date();
      entry.usage.breakdown = [];
      logger.info(`Budget period reset for ${entry.ownerId} (period: ${entry.budget.period})`);
      return true;
    }
    return false;
  }

  async consume(ownerId: string, consumption: TokenConsumption): Promise<void> {
    const entry = this.budgets.get(ownerId);
    if (!entry) {
      logger.warn(`No budget allocated for ${ownerId}, consumption not tracked`);
      return;
    }

    // 检查 provider 是否允许
    if (entry.budget.providers && !entry.budget.providers.includes(consumption.provider)) {
      throw new Error(`Provider ${consumption.provider} is not allowed for budget owner ${ownerId}`);
    }

    // Reset usage if the budget period has elapsed
    this.resetIfPeriodElapsed(entry);

    const totalTokens = consumption.inputTokens + consumption.outputTokens;

    // Atomic decrement-and-check: optimistically add tokens first, then verify.
    // This prevents concurrent callers from all passing a "remaining" check
    // before any of them have decremented.
    if (entry.budget.period !== 'unlimited') {
      const newTotal = entry.usage.totalTokens + totalTokens;
      if (newTotal > entry.budget.maxTokens) {
        this.onBudgetExceeded?.(ownerId, entry.usage, entry.budget);
        throw new Error(
          `Token budget exceeded for ${ownerId}: remaining=${entry.budget.maxTokens - entry.usage.totalTokens}, requested=${totalTokens}`
        );
      }
      // Commit the increment atomically (single-threaded JS ensures no interleaving
      // between the check above and this assignment, but we must NOT await between them)
      entry.usage.totalTokens = newTotal;
    } else {
      entry.usage.totalTokens += totalTokens;
    }

    // 更新用量 (cost is always additive)
    entry.usage.totalCostUsd += consumption.costUsd ?? 0;

    // 更新 breakdown
    let breakdown = entry.usage.breakdown.find(
      b => b.provider === consumption.provider && b.model === consumption.model
    );
    if (!breakdown) {
      breakdown = {
        provider: consumption.provider,
        model: consumption.model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        requestCount: 0,
      };
      entry.usage.breakdown.push(breakdown);
    }
    breakdown.inputTokens += consumption.inputTokens;
    breakdown.outputTokens += consumption.outputTokens;
    breakdown.totalTokens += totalTokens;
    breakdown.costUsd += consumption.costUsd ?? 0;
    breakdown.requestCount += 1;

    // 检查告警阈值
    const usagePercent = entry.usage.totalTokens / entry.budget.maxTokens;
    if (
      entry.budget.alertThreshold &&
      usagePercent >= entry.budget.alertThreshold &&
      usagePercent - (totalTokens / entry.budget.maxTokens) < entry.budget.alertThreshold
    ) {
      logger.warn(`Budget warning for ${ownerId}: ${(usagePercent * 100).toFixed(1)}% used`);
      this.onBudgetWarning?.(ownerId, entry.usage, entry.budget);
    }

    // 更新 provider 限流状态
    this.updateRateLimitState(consumption.provider, totalTokens);
  }

  getUsage(ownerId: string): TokenUsage | undefined {
    return this.budgets.get(ownerId)?.usage;
  }

  getRemainingBudget(ownerId: string): number {
    const entry = this.budgets.get(ownerId);
    if (!entry) return 0;
    if (entry.budget.period === 'unlimited') return Infinity;
    // Reset usage if the budget period has elapsed before computing remaining
    this.resetIfPeriodElapsed(entry);
    return Math.max(0, entry.budget.maxTokens - entry.usage.totalTokens);
  }

  canRequest(provider: ProviderName): boolean {
    const state = this.rateLimits.get(provider);
    if (!state) return true;

    const now = Date.now();
    const windowMs = 60_000; // 1 minute window

    // 重置过期窗口
    if (now - state.windowStart > windowMs) {
      state.requestsInWindow = 0;
      state.tokensInWindow = 0;
      state.windowStart = now;
    }

    if (state.config.rpm && state.requestsInWindow >= state.config.rpm) {
      return false;
    }
    if (state.config.tpm && state.tokensInWindow >= state.config.tpm) {
      return false;
    }
    if (state.config.maxConcurrent && state.concurrentRequests >= state.config.maxConcurrent) {
      return false;
    }

    return true;
  }

  setRateLimit(provider: ProviderName, config: RateLimitConfig): void {
    this.rateLimits.set(provider, {
      config,
      requestsInWindow: 0,
      tokensInWindow: 0,
      windowStart: Date.now(),
      concurrentRequests: 0,
    });
    logger.info(`Rate limit set for ${provider}: rpm=${config.rpm}, tpm=${config.tpm}`);
  }

  resetUsage(ownerId: string): void {
    const entry = this.budgets.get(ownerId);
    if (entry) {
      entry.usage.totalTokens = 0;
      entry.usage.totalCostUsd = 0;
      entry.usage.periodStart = new Date();
      entry.usage.breakdown = [];
      logger.info(`Usage reset for ${ownerId}`);
    }
  }

  getGlobalUsage(): TokenUsage[] {
    return Array.from(this.budgets.values()).map(e => e.usage);
  }

  /** 获取预算信息 */
  getBudget(ownerId: string): TokenBudget | undefined {
    return this.budgets.get(ownerId)?.budget;
  }

  private updateRateLimitState(provider: ProviderName, tokens: number): void {
    const state = this.rateLimits.get(provider);
    if (!state) return;

    const now = Date.now();
    if (now - state.windowStart > 60_000) {
      state.requestsInWindow = 0;
      state.tokensInWindow = 0;
      state.windowStart = now;
    }

    state.requestsInWindow += 1;
    state.tokensInWindow += tokens;
  }

  /** Increment concurrent request counter for a provider (call before request) */
  acquireConcurrent(provider: ProviderName): void {
    const state = this.rateLimits.get(provider);
    if (state) state.concurrentRequests += 1;
  }

  /** Decrement concurrent request counter for a provider (call after request) */
  releaseConcurrent(provider: ProviderName): void {
    const state = this.rateLimits.get(provider);
    if (state && state.concurrentRequests > 0) state.concurrentRequests -= 1;
  }
}
