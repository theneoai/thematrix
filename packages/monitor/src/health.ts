/**
 * HealthAggregator - Aggregates health checks from multiple sources
 */

import { Logger } from '@thematrix/utils';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  status: HealthStatus;
  message?: string;
  details?: Record<string, unknown>;
}

export interface AggregatedHealth {
  status: HealthStatus;
  timestamp: string;
  checks: Record<string, HealthCheckResult>;
}

export class HealthAggregator {
  private readonly logger = new Logger({ prefix: 'HealthAggregator' });
  private readonly checks = new Map<string, () => Promise<HealthCheckResult>>();

  /** Register a named health check */
  registerCheck(name: string, checker: () => Promise<HealthCheckResult>): void {
    this.checks.set(name, checker);
    this.logger.debug(`Health check registered: ${name}`);
  }

  /** Remove a named health check */
  removeCheck(name: string): void {
    this.checks.delete(name);
  }

  /** Run all health checks in parallel and return aggregated result */
  async checkAll(): Promise<AggregatedHealth> {
    const results: Record<string, HealthCheckResult> = {};
    const entries = Array.from(this.checks.entries());

    const settled = await Promise.allSettled(
      entries.map(async ([name, checker]) => {
        const result = await checker();
        return { name, result };
      }),
    );

    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      if (outcome.status === 'fulfilled') {
        results[outcome.value.name] = outcome.value.result;
      } else {
        const name = entries[i][0];
        results[name] = {
          status: 'unhealthy',
          message: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        };
      }
    }

    // Determine overall status
    const statuses = Object.values(results).map((r) => r.status);
    let overall: HealthStatus = 'healthy';
    if (statuses.includes('unhealthy')) {
      overall = 'unhealthy';
    } else if (statuses.includes('degraded')) {
      overall = 'degraded';
    }

    return {
      status: overall,
      timestamp: new Date().toISOString(),
      checks: results,
    };
  }
}
