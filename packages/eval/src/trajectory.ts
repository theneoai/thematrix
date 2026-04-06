/**
 * Trajectory Evaluation - Agent 决策轨迹评估
 *
 * 不仅评估最终输出, 还评估 Agent 的决策过程:
 * - 工具调用序列是否合理
 * - 步骤效率 (实际步数 vs 最优步数)
 * - 是否产生不必要的副作用
 * - 错误恢复能力
 */
import type { EvalScore, LLMAdapter } from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'TrajectoryEval' });

// ============================================================
// Trajectory Types
// ============================================================

export interface TrajectoryStep {
  /** 步骤类型 */
  type: 'tool-call' | 'llm-call' | 'handoff' | 'reflection' | 'planning';
  /** 步骤名称 (工具名/Agent名) */
  name: string;
  /** 输入 */
  input?: string;
  /** 输出 */
  output?: string;
  /** 是否成功 */
  success: boolean;
  /** 耗时 (ms) */
  durationMs: number;
  /** Token 消耗 */
  tokensUsed?: number;
}

export interface Trajectory {
  /** Agent ID */
  agentId: string;
  /** 任务目标 */
  goal: string;
  /** 最终输出 */
  finalOutput: string;
  /** 是否完成任务 */
  taskCompleted: boolean;
  /** 步骤序列 */
  steps: TrajectoryStep[];
  /** 总耗时 (ms) */
  totalDurationMs: number;
  /** 总 Token 消耗 */
  totalTokens: number;
}

export interface TrajectoryEvalResult {
  /** 综合评分 (0-1) */
  overallScore: number;
  /** 各维度评分 */
  scores: EvalScore[];
  /** 改进建议 */
  suggestions: string[];
}

// ============================================================
// Built-in Trajectory Metrics
// ============================================================

export type TrajectoryMetricFunction = (trajectory: Trajectory) => Promise<EvalScore>;

/**
 * 任务完成度指标
 */
export function TaskCompletionMetric(name: string = 'task-completion'): TrajectoryMetricFunction {
  return async (trajectory: Trajectory): Promise<EvalScore> => {
    const score = trajectory.taskCompleted ? 1 : 0;
    return {
      metric: name,
      score,
      reason: trajectory.taskCompleted ? 'Task completed successfully' : 'Task not completed',
    };
  };
}

/**
 * 步骤效率指标: 实际步数 / 基准步数 (越低越好, 归一化到 0-1)
 */
export function StepEfficiencyMetric(
  name: string = 'step-efficiency',
  expectedSteps?: number,
): TrajectoryMetricFunction {
  return async (trajectory: Trajectory): Promise<EvalScore> => {
    const actualSteps = trajectory.steps.length;

    if (actualSteps === 0) {
      return {
        metric: name,
        score: 1,
        reason: '0 steps taken (no work needed)',
      };
    }

    if (expectedSteps && expectedSteps > 0) {
      // Score = min(expected/actual, 1)
      const score = Math.min(expectedSteps / actualSteps, 1);
      return {
        metric: name,
        score,
        reason: `${actualSteps} steps taken (expected ~${expectedSteps}). Efficiency: ${(score * 100).toFixed(0)}%`,
      };
    }

    // Without expected steps, penalize for excessive steps (>20 = low efficiency)
    const score = Math.min(1, Math.max(0, 1 - (actualSteps - 1) / 20));
    return {
      metric: name,
      score,
      reason: `${actualSteps} steps taken`,
    };
  };
}

/**
 * 工具使用准确度: 成功的工具调用 / 总工具调用
 */
export function ToolAccuracyMetric(name: string = 'tool-accuracy'): TrajectoryMetricFunction {
  return async (trajectory: Trajectory): Promise<EvalScore> => {
    const toolCalls = trajectory.steps.filter(s => s.type === 'tool-call');
    if (toolCalls.length === 0) {
      return { metric: name, score: 1, reason: 'No tool calls to evaluate' };
    }

    const successfulCalls = toolCalls.filter(s => s.success).length;
    const score = successfulCalls / toolCalls.length;

    return {
      metric: name,
      score,
      reason: `${successfulCalls}/${toolCalls.length} tool calls succeeded (${(score * 100).toFixed(0)}%)`,
    };
  };
}

/**
 * 错误恢复能力: 在错误后是否成功恢复并完成任务
 */
export function ErrorRecoveryMetric(name: string = 'error-recovery'): TrajectoryMetricFunction {
  return async (trajectory: Trajectory): Promise<EvalScore> => {
    const failures = trajectory.steps.filter(s => !s.success);

    if (failures.length === 0) {
      return { metric: name, score: 1, reason: 'No errors encountered' };
    }

    // Agent 在错误后仍然完成了任务
    if (trajectory.taskCompleted) {
      // 扣分量取决于错误数量 (越多错误扣越多)
      const score = Math.max(0.3, 1 - failures.length * 0.15);
      return {
        metric: name,
        score,
        reason: `Recovered from ${failures.length} error(s) and completed task`,
      };
    }

    return {
      metric: name,
      score: 0,
      reason: `Failed to recover from ${failures.length} error(s)`,
    };
  };
}

/**
 * Token 效率: 基于 token 消耗评分 (可设基准)
 */
export function TokenEfficiencyMetric(
  name: string = 'token-efficiency',
  maxExpectedTokens: number = 10000,
): TrajectoryMetricFunction {
  return async (trajectory: Trajectory): Promise<EvalScore> => {
    if (trajectory.totalTokens === 0) {
      return { metric: name, score: 1, reason: 'No tokens used' };
    }

    const score = Math.max(0, Math.min(1, 1 - (trajectory.totalTokens - maxExpectedTokens * 0.5) / (maxExpectedTokens * 0.5)));

    return {
      metric: name,
      score,
      reason: `${trajectory.totalTokens} tokens used (budget: ${maxExpectedTokens})`,
    };
  };
}

/**
 * LLM-Judge 轨迹评估: 使用 LLM 综合评判决策轨迹质量
 */
export function LLMTrajectoryJudgeMetric(
  name: string,
  llmAdapter: LLMAdapter,
  model?: string,
): TrajectoryMetricFunction {
  return async (trajectory: Trajectory): Promise<EvalScore> => {
    const stepsStr = trajectory.steps
      .map((s, i) => `  ${i + 1}. [${s.type}] ${s.name} → ${s.success ? 'OK' : 'FAIL'} (${s.durationMs}ms)`)
      .join('\n');

    const prompt = [
      'You are an expert evaluator of AI agent behavior. Analyze the following agent trajectory and rate it on a scale of 0-10.',
      '',
      `Goal: ${trajectory.goal}`,
      `Final Output: ${trajectory.finalOutput.slice(0, 500)}`,
      `Task Completed: ${trajectory.taskCompleted}`,
      '',
      'Steps taken:',
      stepsStr,
      '',
      'Evaluate based on:',
      '1. Was the goal achieved effectively?',
      '2. Were the tools used appropriately?',
      '3. Was the approach efficient (minimal unnecessary steps)?',
      '4. Were errors handled well?',
      '5. Was the final output high quality?',
      '',
      'Respond with ONLY a number 0-10.',
    ].join('\n');

    try {
      const response = await llmAdapter.chat({
        model: model ?? '',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      });

      const match = response.content.trim().match(/(\d+(?:\.\d+)?)/);
      if (!match) {
        return { metric: name, score: 0, reason: 'Could not parse LLM judge score' };
      }

      const rawScore = parseFloat(match[1]);
      const normalizedScore = Math.min(1, Math.max(0, rawScore / 10));
      return { metric: name, score: normalizedScore, reason: response.content.trim() };
    } catch (error) {
      return { metric: name, score: 0, reason: `LLM judge error: ${String(error)}` };
    }
  };
}

// ============================================================
// Trajectory Evaluator
// ============================================================

export class TrajectoryEvaluator {
  private readonly metrics: TrajectoryMetricFunction[];

  constructor(metrics: TrajectoryMetricFunction[]) {
    this.metrics = metrics;
  }

  /**
   * 评估单条轨迹
   */
  async evaluate(trajectory: Trajectory): Promise<TrajectoryEvalResult> {
    const scores = await Promise.all(
      this.metrics.map(fn => fn(trajectory)),
    );

    const overallScore = scores.length > 0
      ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
      : 0;

    const suggestions: string[] = [];
    for (const score of scores) {
      if (score.score < 0.7 && score.reason) {
        suggestions.push(`[${score.metric}] ${score.reason}`);
      }
    }

    return { overallScore, scores, suggestions };
  }

  /**
   * 批量评估多条轨迹
   */
  async evaluateBatch(trajectories: Trajectory[]): Promise<TrajectoryEvalResult[]> {
    return Promise.all(trajectories.map(t => this.evaluate(t)));
  }

  /**
   * 创建包含所有默认指标的评估器
   */
  static withDefaults(options?: { expectedSteps?: number; maxTokens?: number }): TrajectoryEvaluator {
    return new TrajectoryEvaluator([
      TaskCompletionMetric(),
      StepEfficiencyMetric('step-efficiency', options?.expectedSteps),
      ToolAccuracyMetric(),
      ErrorRecoveryMetric(),
      TokenEfficiencyMetric('token-efficiency', options?.maxTokens),
    ]);
  }
}
