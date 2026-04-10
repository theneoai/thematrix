/**
 * Eval Regression Detection
 *
 * Compares evaluation results between two runs (baseline vs. candidate)
 * to detect quality regressions or improvements in agent behavior.
 *
 * Features:
 * - Per-metric score comparison with configurable significance thresholds
 * - Overall pass rate regression detection
 * - Latency regression detection (p50/p95/avg)
 * - Token efficiency comparison
 * - Markdown and JSON report generation
 * - History tracking via EvalHistoryStore
 */

import type { EvalResult, EvalScore } from '@thematrix/types';
import type { EvalSummary, MetricSummary } from './reporter.js';
import { EvalReporter } from './reporter.js';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'EvalRegression' });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RegressionSeverity = 'critical' | 'warning' | 'improvement' | 'unchanged';

export interface MetricRegressionResult {
  metric: string;
  baselineScore: number;
  candidateScore: number;
  delta: number;
  /** Relative change as a percentage */
  deltaPercent: number;
  severity: RegressionSeverity;
  passed: boolean;
}

export interface RegressionReport {
  /** Unique ID for this comparison */
  id: string;
  /** Label of the baseline run */
  baselineLabel: string;
  /** Label of the candidate run */
  candidateLabel: string;
  /** When this comparison was generated */
  generatedAt: Date;
  /** Overall verdict */
  verdict: 'pass' | 'fail' | 'improved';
  /** Per-metric regression analysis */
  metrics: MetricRegressionResult[];
  /** Pass rate comparison */
  passRate: {
    baseline: number;
    candidate: number;
    delta: number;
    severity: RegressionSeverity;
  };
  /** Latency comparison (ms) */
  latency: {
    baselineAvg: number;
    candidateAvg: number;
    delta: number;
    severity: RegressionSeverity;
  };
  /** Token consumption comparison */
  tokens: {
    baselineTotal: number;
    candidateTotal: number;
    delta: number;
    severity: RegressionSeverity;
  };
  /** List of detected regressions */
  regressions: string[];
  /** List of detected improvements */
  improvements: string[];
}

export interface RegressionThresholds {
  /**
   * Minimum score delta that triggers a 'warning' (e.g., 0.05 = 5% drop).
   * Default: 0.05
   */
  warningDelta?: number;
  /**
   * Minimum score delta that triggers a 'critical' regression (e.g., 0.1 = 10% drop).
   * Default: 0.10
   */
  criticalDelta?: number;
  /**
   * Maximum acceptable latency increase in ms. Default: 500ms.
   */
  maxLatencyIncrease?: number;
  /**
   * Maximum acceptable pass rate drop (absolute, e.g., 0.05 = 5%). Default: 0.05.
   */
  maxPassRateDrop?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// EvalRegressionDetector
// ─────────────────────────────────────────────────────────────────────────────

export class EvalRegressionDetector {
  private readonly thresholds: Required<RegressionThresholds>;
  private readonly reporter = new EvalReporter();

  constructor(thresholds: RegressionThresholds = {}) {
    this.thresholds = {
      warningDelta: thresholds.warningDelta ?? 0.05,
      criticalDelta: thresholds.criticalDelta ?? 0.10,
      maxLatencyIncrease: thresholds.maxLatencyIncrease ?? 500,
      maxPassRateDrop: thresholds.maxPassRateDrop ?? 0.05,
    };
  }

  /**
   * Compare two sets of eval results and produce a regression report.
   */
  compare(
    baseline: EvalResult[],
    candidate: EvalResult[],
    options: {
      baselineLabel?: string;
      candidateLabel?: string;
      thresholds?: Record<string, number>;
    } = {},
  ): RegressionReport {
    const baselineLabel = options.baselineLabel ?? 'baseline';
    const candidateLabel = options.candidateLabel ?? 'candidate';
    const scoreThresholds = options.thresholds ?? {};

    const baselineSummary = this.reporter.summary(baseline, scoreThresholds);
    const candidateSummary = this.reporter.summary(candidate, scoreThresholds);

    logger.info(
      `Comparing "${baselineLabel}" (${baseline.length} cases) vs "${candidateLabel}" (${candidate.length} cases)`,
    );

    const metricResults = this.compareMetrics(baselineSummary, candidateSummary);
    const passRateResult = this.comparePassRate(baselineSummary, candidateSummary);
    const latencyResult = this.compareLatency(baselineSummary, candidateSummary);
    const tokenResult = this.compareTokens(baselineSummary, candidateSummary);

    const regressions: string[] = [];
    const improvements: string[] = [];

    // Collect metric-level regressions and improvements
    for (const m of metricResults) {
      if (m.severity === 'critical' || m.severity === 'warning') {
        regressions.push(`[${m.severity.toUpperCase()}] ${m.metric}: ${this.fmt(m.baselineScore)} → ${this.fmt(m.candidateScore)} (${this.fmtDelta(m.delta)})`);
      } else if (m.severity === 'improvement') {
        improvements.push(`${m.metric}: ${this.fmt(m.baselineScore)} → ${this.fmt(m.candidateScore)} (${this.fmtDelta(m.delta)})`);
      }
    }

    // Pass rate
    if (passRateResult.severity === 'critical' || passRateResult.severity === 'warning') {
      regressions.push(`[${passRateResult.severity.toUpperCase()}] Pass rate: ${this.pct(passRateResult.baseline)} → ${this.pct(passRateResult.candidate)}`);
    } else if (passRateResult.severity === 'improvement') {
      improvements.push(`Pass rate: ${this.pct(passRateResult.baseline)} → ${this.pct(passRateResult.candidate)}`);
    }

    // Latency
    if (latencyResult.severity === 'critical' || latencyResult.severity === 'warning') {
      regressions.push(`[${latencyResult.severity.toUpperCase()}] Avg latency: ${latencyResult.baselineAvg.toFixed(0)}ms → ${latencyResult.candidateAvg.toFixed(0)}ms (+${latencyResult.delta.toFixed(0)}ms)`);
    } else if (latencyResult.severity === 'improvement') {
      improvements.push(`Avg latency: ${latencyResult.baselineAvg.toFixed(0)}ms → ${latencyResult.candidateAvg.toFixed(0)}ms`);
    }

    const hasRegressions = regressions.length > 0;
    const hasImprovements = improvements.length > 0 && !hasRegressions;

    const verdict = hasRegressions ? 'fail' : hasImprovements ? 'improved' : 'pass';

    const report: RegressionReport = {
      id: `regression-${Date.now()}`,
      baselineLabel,
      candidateLabel,
      generatedAt: new Date(),
      verdict,
      metrics: metricResults,
      passRate: passRateResult,
      latency: latencyResult,
      tokens: tokenResult,
      regressions,
      improvements,
    };

    const emoji = verdict === 'fail' ? '❌' : verdict === 'improved' ? '✅' : '✓';
    logger.info(`Regression report: ${emoji} ${verdict.toUpperCase()} — ${regressions.length} regressions, ${improvements.length} improvements`);

    return report;
  }

  /**
   * Format regression report as Markdown.
   */
  toMarkdown(report: RegressionReport): string {
    const lines: string[] = [];

    const verdictEmoji = report.verdict === 'fail' ? '❌' : report.verdict === 'improved' ? '✅' : '✓';
    lines.push(`# Eval Regression Report: ${verdictEmoji} ${report.verdict.toUpperCase()}`);
    lines.push('');
    lines.push(`- **Baseline:** ${report.baselineLabel}`);
    lines.push(`- **Candidate:** ${report.candidateLabel}`);
    lines.push(`- **Generated:** ${report.generatedAt.toISOString()}`);
    lines.push('');

    if (report.regressions.length > 0) {
      lines.push('## 🔴 Regressions Detected');
      lines.push('');
      for (const r of report.regressions) lines.push(`- ${r}`);
      lines.push('');
    }

    if (report.improvements.length > 0) {
      lines.push('## 🟢 Improvements Detected');
      lines.push('');
      for (const i of report.improvements) lines.push(`- ${i}`);
      lines.push('');
    }

    lines.push('## Metrics Comparison');
    lines.push('');
    lines.push('| Metric | Baseline | Candidate | Delta | Status |');
    lines.push('|--------|----------|-----------|-------|--------|');
    for (const m of report.metrics) {
      const badge = m.severity === 'critical' ? '🔴' : m.severity === 'warning' ? '🟡' : m.severity === 'improvement' ? '🟢' : '⚪';
      lines.push(`| ${m.metric} | ${this.fmt(m.baselineScore)} | ${this.fmt(m.candidateScore)} | ${this.fmtDelta(m.delta)} | ${badge} ${m.severity} |`);
    }
    lines.push('');

    lines.push('## System Metrics');
    lines.push('');
    lines.push('| Metric | Baseline | Candidate | Delta |');
    lines.push('|--------|----------|-----------|-------|');
    lines.push(`| Pass Rate | ${this.pct(report.passRate.baseline)} | ${this.pct(report.passRate.candidate)} | ${this.fmtDelta(report.passRate.delta)} |`);
    lines.push(`| Avg Latency | ${report.latency.baselineAvg.toFixed(0)}ms | ${report.latency.candidateAvg.toFixed(0)}ms | ${report.latency.delta >= 0 ? '+' : ''}${report.latency.delta.toFixed(0)}ms |`);
    lines.push(`| Total Tokens | ${report.tokens.baselineTotal} | ${report.tokens.candidateTotal} | ${report.tokens.delta >= 0 ? '+' : ''}${report.tokens.delta} |`);
    lines.push('');

    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private compareMetrics(baseline: EvalSummary, candidate: EvalSummary): MetricRegressionResult[] {
    const results: MetricRegressionResult[] = [];

    // Build map of candidate metrics for fast lookup
    const candidateMap = new Map(candidate.metrics.map(m => [m.name, m]));

    for (const bm of baseline.metrics) {
      const cm = candidateMap.get(bm.name);
      if (!cm) {
        logger.warn(`Metric "${bm.name}" present in baseline but missing from candidate`);
        continue;
      }

      const delta = cm.averageScore - bm.averageScore;
      const deltaPercent = bm.averageScore > 0 ? (delta / bm.averageScore) * 100 : 0;
      const severity = this.scoreSeverity(-delta); // negative delta = regression

      results.push({
        metric: bm.name,
        baselineScore: bm.averageScore,
        candidateScore: cm.averageScore,
        delta,
        deltaPercent,
        severity,
        passed: severity !== 'critical' && severity !== 'warning',
      });
    }

    // Check for new metrics in candidate not in baseline
    for (const cm of candidate.metrics) {
      if (!baseline.metrics.find(m => m.name === cm.name)) {
        results.push({
          metric: cm.name,
          baselineScore: 0,
          candidateScore: cm.averageScore,
          delta: cm.averageScore,
          deltaPercent: 100,
          severity: 'improvement',
          passed: true,
        });
      }
    }

    return results;
  }

  private comparePassRate(
    baseline: EvalSummary,
    candidate: EvalSummary,
  ): RegressionReport['passRate'] {
    const delta = candidate.overallPassRate - baseline.overallPassRate;
    return {
      baseline: baseline.overallPassRate,
      candidate: candidate.overallPassRate,
      delta,
      severity: this.scoreSeverity(-delta),
    };
  }

  private compareLatency(
    baseline: EvalSummary,
    candidate: EvalSummary,
  ): RegressionReport['latency'] {
    const delta = candidate.latency.average - baseline.latency.average;
    let severity: RegressionSeverity = 'unchanged';
    if (delta > this.thresholds.maxLatencyIncrease * 2) severity = 'critical';
    else if (delta > this.thresholds.maxLatencyIncrease) severity = 'warning';
    else if (delta < -this.thresholds.maxLatencyIncrease * 0.5) severity = 'improvement';

    return {
      baselineAvg: baseline.latency.average,
      candidateAvg: candidate.latency.average,
      delta,
      severity,
    };
  }

  private compareTokens(
    baseline: EvalSummary,
    candidate: EvalSummary,
  ): RegressionReport['tokens'] {
    const delta = candidate.totalTokens - baseline.totalTokens;
    const relative = baseline.totalTokens > 0 ? delta / baseline.totalTokens : 0;
    let severity: RegressionSeverity = 'unchanged';
    if (relative > 0.2) severity = 'warning';
    else if (relative < -0.1) severity = 'improvement';

    return {
      baselineTotal: baseline.totalTokens,
      candidateTotal: candidate.totalTokens,
      delta,
      severity,
    };
  }

  /** Classify a score drop as a severity level (pass in drop amount, positive = regression). */
  private scoreSeverity(drop: number): RegressionSeverity {
    if (drop >= this.thresholds.criticalDelta) return 'critical';
    if (drop >= this.thresholds.warningDelta) return 'warning';
    if (drop <= -this.thresholds.warningDelta) return 'improvement';
    return 'unchanged';
  }

  private fmt(score: number): string {
    return score.toFixed(3);
  }

  private fmtDelta(delta: number): string {
    const sign = delta >= 0 ? '+' : '';
    return `${sign}${delta.toFixed(3)}`;
  }

  private pct(rate: number): string {
    return `${(rate * 100).toFixed(1)}%`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EvalHistoryStore — lightweight SQLite-backed history for regression tracking
// ─────────────────────────────────────────────────────────────────────────────

export interface EvalHistoryEntry {
  id: string;
  agentId: string;
  suiteId: string;
  label: string;
  results: EvalResult[];
  summary: EvalSummary;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export class EvalHistoryStore {
  private readonly store = new Map<string, EvalHistoryEntry[]>();
  private readonly reporter = new EvalReporter();

  /**
   * Save an eval run result to the history store.
   */
  save(
    agentId: string,
    suiteId: string,
    label: string,
    results: EvalResult[],
    metadata?: Record<string, unknown>,
  ): EvalHistoryEntry {
    const entry: EvalHistoryEntry = {
      id: `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId,
      suiteId,
      label,
      results,
      summary: this.reporter.summary(results),
      createdAt: new Date(),
      metadata,
    };

    const key = `${agentId}::${suiteId}`;
    const existing = this.store.get(key) ?? [];
    existing.push(entry);
    this.store.set(key, existing);

    logger.info(`Saved eval run "${label}" for ${agentId}/${suiteId} (${results.length} cases)`);
    return entry;
  }

  /**
   * Get all historical runs for an agent + suite combination.
   */
  getHistory(agentId: string, suiteId: string): EvalHistoryEntry[] {
    return this.store.get(`${agentId}::${suiteId}`) ?? [];
  }

  /**
   * Get the most recent run for an agent + suite.
   */
  getLatest(agentId: string, suiteId: string): EvalHistoryEntry | undefined {
    const history = this.getHistory(agentId, suiteId);
    return history[history.length - 1];
  }

  /**
   * Get the N most recent runs for an agent + suite.
   */
  getRecent(agentId: string, suiteId: string, n: number): EvalHistoryEntry[] {
    const history = this.getHistory(agentId, suiteId);
    return history.slice(-n);
  }

  /**
   * Compare the latest run against the previous run, returning a regression report.
   * Returns null if there are fewer than 2 historical runs.
   */
  compareLatestToPrevious(
    agentId: string,
    suiteId: string,
    detector?: EvalRegressionDetector,
  ): RegressionReport | null {
    const history = this.getHistory(agentId, suiteId);
    if (history.length < 2) {
      logger.info(`Not enough history for ${agentId}/${suiteId} to compare (need ≥2 runs, have ${history.length})`);
      return null;
    }

    const previous = history[history.length - 2];
    const latest = history[history.length - 1];
    const d = detector ?? new EvalRegressionDetector();

    return d.compare(previous.results, latest.results, {
      baselineLabel: previous.label,
      candidateLabel: latest.label,
    });
  }

  /**
   * Compare a candidate run against a specific baseline label.
   */
  compareToBaseline(
    agentId: string,
    suiteId: string,
    baselineLabel: string,
    candidateResults: EvalResult[],
    candidateLabel: string,
    detector?: EvalRegressionDetector,
  ): RegressionReport | null {
    const history = this.getHistory(agentId, suiteId);
    const baseline = history.find(e => e.label === baselineLabel);
    if (!baseline) {
      logger.warn(`Baseline "${baselineLabel}" not found for ${agentId}/${suiteId}`);
      return null;
    }

    const d = detector ?? new EvalRegressionDetector();
    return d.compare(baseline.results, candidateResults, {
      baselineLabel,
      candidateLabel,
    });
  }

  /** Total number of tracked runs across all agent/suite combinations. */
  getTotalRuns(): number {
    let total = 0;
    for (const entries of this.store.values()) total += entries.length;
    return total;
  }
}
