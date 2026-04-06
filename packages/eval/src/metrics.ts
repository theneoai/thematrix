/**
 * Built-in evaluation metrics
 */
import type {
  EvalScore,
  EvalMetricConfig,
  LLMAdapter,
  IEmbeddingProvider,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'EvalMetrics' });

/**
 * A function that scores an output against an expected value.
 */
export type EvalMetricFunction = (
  input: string,
  output: string,
  expected?: string,
) => Promise<EvalScore>;

/**
 * ExactMatchMetric: score=1 if output === expectedOutput, else 0.
 */
export function ExactMatchMetric(name: string): EvalMetricFunction {
  return async (_input: string, output: string, expected?: string): Promise<EvalScore> => {
    const score = output === expected ? 1 : 0;
    return {
      metric: name,
      score,
      reason: score === 1 ? 'Exact match' : 'Output does not match expected',
    };
  };
}

/**
 * ContainsMetric: score=1 if output contains expectedOutput, else 0.
 */
export function ContainsMetric(name: string): EvalMetricFunction {
  return async (_input: string, output: string, expected?: string): Promise<EvalScore> => {
    if (!expected) {
      return { metric: name, score: 0, reason: 'No expected output provided' };
    }
    const score = output.includes(expected) ? 1 : 0;
    return {
      metric: name,
      score,
      reason: score === 1 ? 'Output contains expected text' : 'Output does not contain expected text',
    };
  };
}

/**
 * JsonValidityMetric: score=1 if output is valid JSON, else 0.
 * If a schema object is provided in config, validates parsed JSON against it (basic key check).
 */
export function JsonValidityMetric(name: string, schema?: Record<string, unknown>): EvalMetricFunction {
  return async (_input: string, output: string, _expected?: string): Promise<EvalScore> => {
    try {
      const parsed = JSON.parse(output);

      if (schema) {
        // Basic schema validation: check that all required keys from schema are present
        const schemaKeys = Object.keys(schema);
        const missingKeys = schemaKeys.filter((key) => !(key in parsed));
        if (missingKeys.length > 0) {
          return {
            metric: name,
            score: 0,
            reason: `Valid JSON but missing schema keys: ${missingKeys.join(', ')}`,
          };
        }
      }

      return { metric: name, score: 1, reason: 'Valid JSON' };
    } catch {
      return { metric: name, score: 0, reason: 'Invalid JSON' };
    }
  };
}

/**
 * LLMJudgeMetric: uses an LLM to evaluate output quality.
 * The prompt template can contain {input}, {expected}, and {output} placeholders.
 * Parses a numeric score (0-10) from the LLM response and normalizes to 0-1.
 */
export function LLMJudgeMetric(
  name: string,
  promptTemplate: string,
  llmAdapter: LLMAdapter,
  model: string,
): EvalMetricFunction {
  return async (input: string, output: string, expected?: string): Promise<EvalScore> => {
    const filledPrompt = promptTemplate
      .replace(/\{input\}/g, input)
      .replace(/\{output\}/g, output)
      .replace(/\{expected\}/g, expected ?? '');

    try {
      const response = await llmAdapter.chat({
        model,
        messages: [{ role: 'user', content: filledPrompt }],
        temperature: 0,
      });

      const content = response.content.trim();
      // Extract the first number found in the response
      const match = content.match(/(\d+(?:\.\d+)?)/);
      if (!match) {
        logger.warn(`LLM judge returned no numeric score: ${content}`);
        return { metric: name, score: 0, reason: `Could not parse score from: ${content}` };
      }

      const rawScore = parseFloat(match[1]);
      // Normalize from 0-10 to 0-1
      const normalizedScore = Math.min(1, Math.max(0, rawScore / 10));

      return {
        metric: name,
        score: normalizedScore,
        reason: content,
      };
    } catch (error) {
      logger.error(`LLM judge failed: ${error instanceof Error ? error.message : String(error)}`);
      return { metric: name, score: 0, reason: `LLM judge error: ${String(error)}` };
    }
  };
}

/**
 * SemanticSimilarityMetric: compares embeddings of output vs expectedOutput using cosine similarity.
 */
export function SemanticSimilarityMetric(
  name: string,
  embeddingProvider: IEmbeddingProvider,
): EvalMetricFunction {
  return async (_input: string, output: string, expected?: string): Promise<EvalScore> => {
    if (!expected) {
      return { metric: name, score: 0, reason: 'No expected output for semantic comparison' };
    }

    try {
      const [outputEmbedding, expectedEmbedding] = await embeddingProvider.embed([output, expected]);
      const similarity = cosineSimilarity(outputEmbedding, expectedEmbedding);
      // Clamp to 0-1 range
      const score = Math.min(1, Math.max(0, similarity));

      return {
        metric: name,
        score,
        reason: `Cosine similarity: ${similarity.toFixed(4)}`,
      };
    } catch (error) {
      logger.error(`Semantic similarity failed: ${error instanceof Error ? error.message : String(error)}`);
      return { metric: name, score: 0, reason: `Embedding error: ${String(error)}` };
    }
  };
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch in cosine similarity: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

/**
 * Options for metric creation when external dependencies are needed.
 */
export interface CreateMetricOptions {
  llmAdapter?: LLMAdapter;
  embeddingProvider?: IEmbeddingProvider;
}

/**
 * Factory function that creates the right metric function based on config.
 */
export function createMetric(
  config: EvalMetricConfig,
  options: CreateMetricOptions = {},
): EvalMetricFunction {
  switch (config.type) {
    case 'exact-match':
      return ExactMatchMetric(config.name);

    case 'contains':
      return ContainsMetric(config.name);

    case 'json-validity':
      return JsonValidityMetric(config.name);

    case 'llm-judge': {
      if (!options.llmAdapter) {
        throw new Error('LLM adapter required for llm-judge metric');
      }
      if (!config.prompt) {
        throw new Error('Prompt template required for llm-judge metric');
      }
      return LLMJudgeMetric(config.name, config.prompt, options.llmAdapter);
    }

    case 'semantic-similarity': {
      if (!options.embeddingProvider) {
        throw new Error('Embedding provider required for semantic-similarity metric');
      }
      return SemanticSimilarityMetric(config.name, options.embeddingProvider);
    }

    default:
      throw new Error(`Unknown metric type: ${config.type}`);
  }
}
