/**
 * Evaluation Reporter - aggregates and formats eval results
 */
import type { EvalResult, EvalScore } from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'EvalReporter' });

export interface MetricSummary {
  name: string;
  averageScore: number;
  passCount: number;
  failCount: number;
  passRate: number;
  threshold: number;
}

export interface EvalSummary {
  totalCases: number;
  overallPassRate: number;
  metrics: MetricSummary[];
  latency: {
    min: number;
    max: number;
    median: number;
    average: number;
  };
  totalTokens: number;
}

export class EvalReporter {
  /**
   * Aggregate eval results into a summary.
   */
  summary(results: EvalResult[], thresholds?: Record<string, number>): EvalSummary {
    if (results.length === 0) {
      logger.warn('No results to summarize');
      return {
        totalCases: 0,
        overallPassRate: 0,
        metrics: [],
        latency: { min: 0, max: 0, median: 0, average: 0 },
        totalTokens: 0,
      };
    }

    // Collect all metric names
    const metricNames = new Set<string>();
    for (const result of results) {
      for (const score of result.scores) {
        metricNames.add(score.metric);
      }
    }

    // Compute per-metric summary
    const metricSummaries: MetricSummary[] = [];
    for (const name of metricNames) {
      const scores: EvalScore[] = [];
      for (const result of results) {
        const s = result.scores.find((sc) => sc.metric === name);
        if (s) scores.push(s);
      }

      const threshold = thresholds?.[name] ?? 0.5;
      const avg = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
      const passCount = scores.filter((s) => s.score >= threshold).length;
      const failCount = scores.length - passCount;

      metricSummaries.push({
        name,
        averageScore: avg,
        passCount,
        failCount,
        passRate: passCount / scores.length,
        threshold,
      });
    }

    // Overall pass rate: a case passes if all its metrics pass
    let overallPassCount = 0;
    for (const result of results) {
      const allPass = result.scores.every((s) => {
        const threshold = thresholds?.[s.metric] ?? 0.5;
        return s.score >= threshold;
      });
      if (allPass) overallPassCount++;
    }
    const overallPassRate = overallPassCount / results.length;

    // Latency stats
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const min = latencies[0];
    const max = latencies[latencies.length - 1];
    const median =
      latencies.length % 2 === 0
        ? (latencies[latencies.length / 2 - 1] + latencies[latencies.length / 2]) / 2
        : latencies[Math.floor(latencies.length / 2)];
    const average = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;

    // Total tokens
    const totalTokens = results.reduce((sum, r) => sum + r.tokenCount, 0);

    return {
      totalCases: results.length,
      overallPassRate,
      metrics: metricSummaries,
      latency: { min, max, median, average },
      totalTokens,
    };
  }

  /**
   * Format summary as a markdown table.
   */
  toMarkdown(summary: EvalSummary): string {
    const lines: string[] = [];

    lines.push('# Evaluation Summary');
    lines.push('');
    lines.push(`- **Total Cases:** ${summary.totalCases}`);
    lines.push(`- **Overall Pass Rate:** ${(summary.overallPassRate * 100).toFixed(1)}%`);
    lines.push(`- **Total Tokens:** ${summary.totalTokens}`);
    lines.push('');

    // Metrics table
    lines.push('## Metrics');
    lines.push('');
    lines.push('| Metric | Avg Score | Pass Rate | Pass | Fail | Threshold |');
    lines.push('|--------|-----------|-----------|------|------|-----------|');
    for (const m of summary.metrics) {
      lines.push(
        `| ${m.name} | ${m.averageScore.toFixed(3)} | ${(m.passRate * 100).toFixed(1)}% | ${m.passCount} | ${m.failCount} | ${m.threshold} |`,
      );
    }
    lines.push('');

    // Latency table
    lines.push('## Latency');
    lines.push('');
    lines.push('| Stat | Value (ms) |');
    lines.push('|------|------------|');
    lines.push(`| Min | ${summary.latency.min.toFixed(0)} |`);
    lines.push(`| Max | ${summary.latency.max.toFixed(0)} |`);
    lines.push(`| Median | ${summary.latency.median.toFixed(0)} |`);
    lines.push(`| Average | ${summary.latency.average.toFixed(0)} |`);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Format summary as JSON string.
   */
  toJson(summary: EvalSummary): string {
    return JSON.stringify(summary, null, 2);
  }
}
