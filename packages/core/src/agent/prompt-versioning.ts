/**
 * Prompt Version Management
 *
 * Tracks system prompt versions across agents, enabling:
 * - Semantic versioning of prompt changes
 * - Diff/changelog between versions
 * - Correlation with eval quality metrics
 * - A/B experiments between prompt variants
 * - Rollback to previous prompt versions
 */

import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'PromptVersioning' });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptVersion {
  /** Unique version identifier (semver or arbitrary label) */
  version: string;
  /** Agent this prompt belongs to */
  agentId: string;
  /** The actual system prompt content */
  content: string;
  /** Human-readable description of what changed */
  changelog: string;
  /** Who authored this version */
  author?: string;
  /** Tags for filtering/grouping (e.g. 'experiment', 'baseline', 'production') */
  tags: string[];
  /** When this version was created */
  createdAt: Date;
  /** Optional quality score from associated eval run */
  evalScore?: number;
  /** Optional eval run ID that validated this version */
  evalRunId?: string;
  /** Metadata for experiment tracking */
  metadata?: Record<string, unknown>;
}

export interface PromptDiff {
  fromVersion: string;
  toVersion: string;
  agentId: string;
  additions: number;
  deletions: number;
  /** Line-level diff as unified diff format */
  unifiedDiff: string;
  /** Summary of changes generated from changelog */
  summary: string;
}

export interface PromptExperiment {
  id: string;
  agentId: string;
  name: string;
  description: string;
  /** Version A (typically current/baseline) */
  controlVersion: string;
  /** Version B (candidate being tested) */
  treatmentVersion: string;
  status: 'draft' | 'running' | 'completed' | 'cancelled';
  /** Traffic split: 0-1 proportion going to treatment (default 0.5) */
  treatmentRatio: number;
  createdAt: Date;
  completedAt?: Date;
  /** Eval scores associated with each variant */
  results?: {
    controlScore?: number;
    treatmentScore?: number;
    winner?: 'control' | 'treatment' | 'inconclusive';
    confidence?: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PromptVersionManager
// ─────────────────────────────────────────────────────────────────────────────

export class PromptVersionManager {
  /** versions[agentId] = list of PromptVersion, ordered by creation time */
  private readonly versions = new Map<string, PromptVersion[]>();
  private readonly experiments = new Map<string, PromptExperiment>();

  /**
   * Register a new prompt version for an agent.
   *
   * @param agentId - The agent this prompt belongs to
   * @param version - Semver string or a label (e.g. 'v1.0.0', 'baseline-2026-04')
   * @param content - Full system prompt text
   * @param options - Changelog, author, tags, metadata
   */
  register(
    agentId: string,
    version: string,
    content: string,
    options: {
      changelog?: string;
      author?: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
    } = {},
  ): PromptVersion {
    const existing = this.getVersion(agentId, version);
    if (existing) {
      throw new Error(
        `Prompt version "${version}" for agent "${agentId}" already exists. Use a different version label.`,
      );
    }

    const pv: PromptVersion = {
      version,
      agentId,
      content,
      changelog: options.changelog ?? 'No changelog provided',
      author: options.author,
      tags: options.tags ?? [],
      createdAt: new Date(),
      metadata: options.metadata,
    };

    const agentVersions = this.versions.get(agentId) ?? [];
    agentVersions.push(pv);
    this.versions.set(agentId, agentVersions);

    logger.info(`Registered prompt version "${version}" for agent "${agentId}"`);
    return pv;
  }

  /**
   * Get a specific version by agentId + version label.
   */
  getVersion(agentId: string, version: string): PromptVersion | undefined {
    const agentVersions = this.versions.get(agentId) ?? [];
    return agentVersions.find(v => v.version === version);
  }

  /**
   * Get all versions for an agent, ordered by creation time (oldest first).
   */
  listVersions(agentId: string): PromptVersion[] {
    return [...(this.versions.get(agentId) ?? [])];
  }

  /**
   * Get the latest registered version for an agent.
   */
  getLatest(agentId: string): PromptVersion | undefined {
    const versions = this.versions.get(agentId) ?? [];
    return versions[versions.length - 1];
  }

  /**
   * Get versions filtered by tag.
   */
  listByTag(agentId: string, tag: string): PromptVersion[] {
    return (this.versions.get(agentId) ?? []).filter(v => v.tags.includes(tag));
  }

  /**
   * Tag a specific version (e.g. mark it as 'production' or 'baseline').
   */
  tag(agentId: string, version: string, tag: string): void {
    const pv = this.getVersion(agentId, version);
    if (!pv) {
      throw new Error(`Prompt version "${version}" not found for agent "${agentId}"`);
    }
    if (!pv.tags.includes(tag)) {
      pv.tags.push(tag);
      logger.debug(`Tagged prompt "${version}" for agent "${agentId}" with "${tag}"`);
    }
  }

  /**
   * Remove a tag from a version.
   */
  untag(agentId: string, version: string, tag: string): void {
    const pv = this.getVersion(agentId, version);
    if (!pv) return;
    pv.tags = pv.tags.filter(t => t !== tag);
  }

  /**
   * Attach an eval score to a prompt version for quality tracking.
   */
  recordEvalScore(agentId: string, version: string, score: number, evalRunId?: string): void {
    const pv = this.getVersion(agentId, version);
    if (!pv) {
      throw new Error(`Prompt version "${version}" not found for agent "${agentId}"`);
    }
    pv.evalScore = score;
    pv.evalRunId = evalRunId;
    logger.info(
      `Recorded eval score ${score.toFixed(3)} for prompt "${version}" (agent: "${agentId}")`,
    );
  }

  /**
   * Compute a simple line-level diff between two prompt versions.
   *
   * Returns a unified diff string + addition/deletion line counts.
   */
  diff(agentId: string, fromVersion: string, toVersion: string): PromptDiff {
    const from = this.getVersion(agentId, fromVersion);
    const to = this.getVersion(agentId, toVersion);

    if (!from) throw new Error(`Version "${fromVersion}" not found for agent "${agentId}"`);
    if (!to) throw new Error(`Version "${toVersion}" not found for agent "${agentId}"`);

    const fromLines = from.content.split('\n');
    const toLines = to.content.split('\n');

    const { additions, deletions, unifiedDiff } = computeUnifiedDiff(
      fromLines,
      toLines,
      `${fromVersion}`,
      `${toVersion}`,
    );

    return {
      fromVersion,
      toVersion,
      agentId,
      additions,
      deletions,
      unifiedDiff,
      summary: to.changelog,
    };
  }

  /**
   * Get quality trend across all versions of an agent (that have eval scores).
   * Returns array of { version, score, createdAt } sorted chronologically.
   */
  qualityTrend(agentId: string): Array<{ version: string; score: number; createdAt: Date }> {
    return (this.versions.get(agentId) ?? [])
      .filter(v => v.evalScore !== undefined)
      .map(v => ({ version: v.version, score: v.evalScore!, createdAt: v.createdAt }));
  }

  /**
   * Find the version with the best eval score for an agent.
   */
  bestVersion(agentId: string): PromptVersion | undefined {
    const scored = (this.versions.get(agentId) ?? []).filter(v => v.evalScore !== undefined);
    if (scored.length === 0) return undefined;
    return scored.reduce((best, v) => (v.evalScore! > best.evalScore! ? v : best));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // A/B Experiment Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create an A/B experiment comparing two prompt versions.
   */
  createExperiment(
    agentId: string,
    name: string,
    controlVersion: string,
    treatmentVersion: string,
    options: {
      description?: string;
      treatmentRatio?: number;
    } = {},
  ): PromptExperiment {
    // Validate both versions exist
    if (!this.getVersion(agentId, controlVersion)) {
      throw new Error(`Control version "${controlVersion}" not found for agent "${agentId}"`);
    }
    if (!this.getVersion(agentId, treatmentVersion)) {
      throw new Error(`Treatment version "${treatmentVersion}" not found for agent "${agentId}"`);
    }

    const id = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const experiment: PromptExperiment = {
      id,
      agentId,
      name,
      description: options.description ?? '',
      controlVersion,
      treatmentVersion,
      status: 'draft',
      treatmentRatio: options.treatmentRatio ?? 0.5,
      createdAt: new Date(),
    };

    this.experiments.set(id, experiment);
    logger.info(
      `Created experiment "${name}" for agent "${agentId}": ` +
      `${controlVersion} vs ${treatmentVersion} (${(experiment.treatmentRatio * 100).toFixed(0)}% treatment)`,
    );
    return experiment;
  }

  /** Start a draft experiment. */
  startExperiment(experimentId: string): void {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment "${experimentId}" not found`);
    if (exp.status !== 'draft') {
      throw new Error(`Experiment "${experimentId}" is not in draft state (current: ${exp.status})`);
    }
    exp.status = 'running';
    logger.info(`Started experiment "${exp.name}" (${experimentId})`);
  }

  /**
   * Determine which prompt variant to use for a given request.
   * Uses consistent hashing on a session/request key for repeatable assignment.
   *
   * @param experimentId - The experiment to route for
   * @param routingKey - A stable key (e.g. userId, sessionId) for consistent assignment
   * @returns 'control' | 'treatment'
   */
  getVariant(experimentId: string, routingKey: string): 'control' | 'treatment' {
    const exp = this.experiments.get(experimentId);
    if (!exp || exp.status !== 'running') return 'control';

    // Deterministic hash: sum char codes modulo 100 for 0-99 range
    let hash = 0;
    for (let i = 0; i < routingKey.length; i++) {
      hash = (hash * 31 + routingKey.charCodeAt(i)) & 0xffffffff;
    }
    const bucket = Math.abs(hash) % 100;
    return bucket < exp.treatmentRatio * 100 ? 'treatment' : 'control';
  }

  /**
   * Get the prompt content for a given experiment variant.
   */
  getExperimentPrompt(experimentId: string, variant: 'control' | 'treatment'): string {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment "${experimentId}" not found`);

    const versionLabel = variant === 'control' ? exp.controlVersion : exp.treatmentVersion;
    const pv = this.getVersion(exp.agentId, versionLabel);
    if (!pv) throw new Error(`Version "${versionLabel}" not found for experiment "${experimentId}"`);

    return pv.content;
  }

  /**
   * Record results for a completed experiment and determine the winner.
   */
  completeExperiment(
    experimentId: string,
    controlScore: number,
    treatmentScore: number,
  ): PromptExperiment {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment "${experimentId}" not found`);
    if (exp.status !== 'running') {
      throw new Error(`Experiment "${experimentId}" is not running (current: ${exp.status})`);
    }

    const delta = treatmentScore - controlScore;
    const relativeImprovement = controlScore > 0 ? delta / controlScore : 0;

    // Simple significance: >5% relative improvement = treatment wins
    let winner: 'control' | 'treatment' | 'inconclusive';
    if (relativeImprovement > 0.05) winner = 'treatment';
    else if (relativeImprovement < -0.05) winner = 'control';
    else winner = 'inconclusive';

    exp.status = 'completed';
    exp.completedAt = new Date();
    exp.results = {
      controlScore,
      treatmentScore,
      winner,
      confidence: Math.min(1, Math.abs(relativeImprovement) / 0.1),
    };

    logger.info(
      `Experiment "${exp.name}" completed: ` +
      `control=${controlScore.toFixed(3)}, treatment=${treatmentScore.toFixed(3)}, winner=${winner}`,
    );

    // Auto-tag the winning version
    if (winner !== 'inconclusive') {
      const winningVersion = winner === 'treatment' ? exp.treatmentVersion : exp.controlVersion;
      this.tag(exp.agentId, winningVersion, 'experiment-winner');
    }

    return exp;
  }

  /** Get an experiment by ID. */
  getExperiment(experimentId: string): PromptExperiment | undefined {
    return this.experiments.get(experimentId);
  }

  /** List all experiments for an agent. */
  listExperiments(agentId: string): PromptExperiment[] {
    return Array.from(this.experiments.values()).filter(e => e.agentId === agentId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Markdown Report
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Generate a Markdown report of all prompt versions and quality trends for an agent.
   */
  toMarkdown(agentId: string): string {
    const versions = this.listVersions(agentId);
    if (versions.length === 0) {
      return `# Prompt Versions: ${agentId}\n\nNo versions registered.\n`;
    }

    const lines: string[] = [];
    lines.push(`# Prompt Versions: ${agentId}`);
    lines.push('');
    lines.push('| Version | Created | Tags | Eval Score | Changelog |');
    lines.push('|---------|---------|------|------------|-----------|');

    for (const v of versions) {
      const score = v.evalScore !== undefined ? v.evalScore.toFixed(3) : '—';
      const tags = v.tags.length > 0 ? v.tags.join(', ') : '—';
      lines.push(
        `| ${v.version} | ${v.createdAt.toISOString().slice(0, 10)} | ${tags} | ${score} | ${v.changelog} |`,
      );
    }

    // Quality trend
    const trend = this.qualityTrend(agentId);
    if (trend.length > 0) {
      lines.push('');
      lines.push('## Quality Trend');
      lines.push('');
      const best = this.bestVersion(agentId);
      lines.push(`Best version: **${best?.version}** (score: ${best?.evalScore?.toFixed(3)})`);
    }

    // Active experiments
    const experiments = this.listExperiments(agentId).filter(e => e.status === 'running');
    if (experiments.length > 0) {
      lines.push('');
      lines.push('## Active Experiments');
      lines.push('');
      for (const exp of experiments) {
        lines.push(
          `- **${exp.name}**: ${exp.controlVersion} vs ${exp.treatmentVersion} ` +
          `(${(exp.treatmentRatio * 100).toFixed(0)}% treatment)`,
        );
      }
    }

    return lines.join('\n') + '\n';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Diff helper (no external deps)
// ─────────────────────────────────────────────────────────────────────────────

interface DiffResult {
  additions: number;
  deletions: number;
  unifiedDiff: string;
}

/**
 * Compute a minimal unified diff between two arrays of lines using LCS.
 * Not full Myers diff — uses the simpler patience-like approach sufficient for prompt diffs.
 */
function computeUnifiedDiff(
  fromLines: string[],
  toLines: string[],
  fromLabel: string,
  toLabel: string,
): DiffResult {
  const lcs = computeLCS(fromLines, toLines);

  const hunks: string[] = [];
  hunks.push(`--- ${fromLabel}`);
  hunks.push(`+++ ${toLabel}`);

  let fromIdx = 0;
  let toIdx = 0;
  let lcsIdx = 0;
  let additions = 0;
  let deletions = 0;

  const changes: Array<{ type: 'context' | 'add' | 'del'; line: string }> = [];

  while (fromIdx < fromLines.length || toIdx < toLines.length) {
    if (
      fromIdx < fromLines.length &&
      toIdx < toLines.length &&
      lcsIdx < lcs.length &&
      fromLines[fromIdx] === lcs[lcsIdx] &&
      toLines[toIdx] === lcs[lcsIdx]
    ) {
      changes.push({ type: 'context', line: fromLines[fromIdx] });
      fromIdx++;
      toIdx++;
      lcsIdx++;
    } else if (fromIdx < fromLines.length && (lcsIdx >= lcs.length || fromLines[fromIdx] !== lcs[lcsIdx])) {
      changes.push({ type: 'del', line: fromLines[fromIdx] });
      deletions++;
      fromIdx++;
    } else {
      changes.push({ type: 'add', line: toLines[toIdx] });
      additions++;
      toIdx++;
    }
  }

  // Render as unified diff with context
  const CONTEXT = 3;
  let i = 0;
  while (i < changes.length) {
    // Find next non-context
    let start = i;
    while (start < changes.length && changes[start].type === 'context') start++;
    if (start >= changes.length) break;

    // Hunk boundaries with context lines
    const hunkStart = Math.max(0, start - CONTEXT);
    let end = start;
    while (end < changes.length && changes[end].type !== 'context') end++;
    const hunkEnd = Math.min(changes.length, end + CONTEXT);

    hunks.push(`@@ -${hunkStart + 1} +${hunkStart + 1} @@`);
    for (let j = hunkStart; j < hunkEnd; j++) {
      const c = changes[j];
      const prefix = c.type === 'add' ? '+' : c.type === 'del' ? '-' : ' ';
      hunks.push(`${prefix}${c.line}`);
    }

    i = hunkEnd;
  }

  return { additions, deletions, unifiedDiff: hunks.join('\n') };
}

/**
 * Compute Longest Common Subsequence of two string arrays.
 * Returns the LCS as an array of matched lines.
 */
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // For large prompts, limit to keep performance acceptable
  if (m * n > 250_000) {
    return [];
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const lcs: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}
