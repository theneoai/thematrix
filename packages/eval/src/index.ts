/**
 * @thematrix/eval - Evaluation Framework for TheMatrix
 *
 * Provides tools to measure agent output quality, compare configurations,
 * and detect regressions.
 */

export { EvalRunner, type EvalRunnerOptions, type AgentRuntimeFactory } from './runner.js';

export {
  type EvalMetricFunction,
  type CreateMetricOptions,
  ExactMatchMetric,
  ContainsMetric,
  JsonValidityMetric,
  LLMJudgeMetric,
  SemanticSimilarityMetric,
  createMetric,
} from './metrics.js';

export { EvalReporter, type EvalSummary, type MetricSummary } from './reporter.js';

export { EvalSuiteLoader } from './suite-loader.js';
