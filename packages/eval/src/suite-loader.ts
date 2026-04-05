/**
 * Eval Suite Loader - loads eval suites from YAML or JSON files
 */
import { readFile } from 'node:fs/promises';
import type { EvalSuite } from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'EvalSuiteLoader' });

/**
 * Raw suite structure as it appears in YAML/JSON files.
 */
interface RawEvalSuite {
  id: string;
  name: string;
  description?: string;
  cases: Array<{
    id: string;
    input: string;
    expectedOutput?: string;
    metadata?: Record<string, unknown>;
  }>;
  metrics: Array<{
    name: string;
    type: string;
    prompt?: string;
    threshold?: number;
  }>;
}

export class EvalSuiteLoader {
  /**
   * Load an eval suite from a YAML file.
   *
   * YAML format:
   * ```yaml
   * id: code-review-eval
   * name: Code Review Quality
   * cases:
   *   - id: case-1
   *     input: "Review this Python code: def add(a,b): return a+b"
   *     expectedOutput: "The function looks correct..."
   * metrics:
   *   - name: relevance
   *     type: llm-judge
   *     prompt: "Rate relevance 0-10..."
   *     threshold: 0.7
   * ```
   */
  async loadFromYaml(filePath: string): Promise<EvalSuite> {
    logger.info(`Loading eval suite from YAML: ${filePath}`);

    const content = await readFile(filePath, 'utf-8');
    const raw = parseYaml(content) as unknown as RawEvalSuite;

    return this.validateAndBuild(raw, filePath);
  }

  /**
   * Load an eval suite from a JSON file.
   */
  async loadFromJson(filePath: string): Promise<EvalSuite> {
    logger.info(`Loading eval suite from JSON: ${filePath}`);

    const content = await readFile(filePath, 'utf-8');
    const raw = JSON.parse(content) as RawEvalSuite;

    return this.validateAndBuild(raw, filePath);
  }

  private validateAndBuild(raw: RawEvalSuite, source: string): EvalSuite {
    if (!raw.id) throw new Error(`Missing "id" in eval suite from ${source}`);
    if (!raw.name) throw new Error(`Missing "name" in eval suite from ${source}`);
    if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
      throw new Error(`Eval suite from ${source} must have at least one case`);
    }
    if (!Array.isArray(raw.metrics) || raw.metrics.length === 0) {
      throw new Error(`Eval suite from ${source} must have at least one metric`);
    }

    // Validate each case
    for (const c of raw.cases) {
      if (!c.id) throw new Error(`Case missing "id" in ${source}`);
      if (!c.input) throw new Error(`Case "${c.id}" missing "input" in ${source}`);
    }

    // Validate each metric
    for (const m of raw.metrics) {
      if (!m.name) throw new Error(`Metric missing "name" in ${source}`);
      if (!m.type) throw new Error(`Metric "${m.name}" missing "type" in ${source}`);
    }

    return {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      cases: raw.cases.map((c) => ({
        id: c.id,
        input: c.input,
        expectedOutput: c.expectedOutput,
        metadata: c.metadata,
      })),
      metrics: raw.metrics.map((m) => ({
        name: m.name,
        type: m.type,
        prompt: m.prompt,
        threshold: m.threshold,
      })),
    };
  }
}

/**
 * Minimal YAML parser for eval suite files.
 * Supports the subset of YAML needed for eval suite definitions:
 * - Top-level scalar fields (id, name, description)
 * - Arrays of objects (cases, metrics)
 * - String, number, and optional fields
 */
function parseYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    // Top-level key
    const topMatch = trimmed.match(/^(\w+):\s*(.*)?$/);
    if (!topMatch) {
      i++;
      continue;
    }

    const key = topMatch[1];
    const inlineValue = topMatch[2]?.trim();

    // If there's an inline value (scalar)
    if (inlineValue && !inlineValue.startsWith('|') && !inlineValue.startsWith('>')) {
      result[key] = parseScalar(inlineValue);
      i++;
      continue;
    }

    // Check if next line starts an array
    if (i + 1 < lines.length && lines[i + 1].trim().startsWith('-')) {
      const items: Record<string, unknown>[] = [];
      i++;

      while (i < lines.length) {
        const itemLine = lines[i];
        const itemTrimmed = itemLine.trim();

        // Stop if we hit a non-indented line that isn't empty/comment
        if (!itemTrimmed || itemTrimmed.startsWith('#')) {
          i++;
          continue;
        }

        if (!itemLine.startsWith(' ') && !itemLine.startsWith('\t') && !itemTrimmed.startsWith('-')) {
          break;
        }

        if (itemTrimmed.startsWith('-')) {
          const item: Record<string, unknown> = {};

          // Parse the first field on the same line as the dash
          const firstField = itemTrimmed.slice(1).trim();
          if (firstField) {
            const fieldMatch = firstField.match(/^(\w+):\s*(.*)$/);
            if (fieldMatch) {
              item[fieldMatch[1]] = parseScalar(fieldMatch[2].trim());
            }
          }

          i++;

          // Parse indented fields of this item
          while (i < lines.length) {
            const fieldLine = lines[i];
            const fieldTrimmed = fieldLine.trim();

            if (!fieldTrimmed || fieldTrimmed.startsWith('#')) {
              i++;
              continue;
            }

            // Stop if we hit a new array item or a top-level key
            if (fieldTrimmed.startsWith('-')) break;
            if (!fieldLine.startsWith(' ') && !fieldLine.startsWith('\t')) break;

            const fieldMatch = fieldTrimmed.match(/^(\w+):\s*(.*)$/);
            if (fieldMatch) {
              item[fieldMatch[1]] = parseScalar(fieldMatch[2].trim());
            }
            i++;
          }

          items.push(item);
        } else {
          i++;
        }
      }

      result[key] = items;
    } else {
      i++;
    }
  }

  return result;
}

function parseScalar(value: string): string | number | boolean | undefined {
  if (!value || value === '~' || value === 'null') return undefined;

  // Remove surrounding quotes
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Number
  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;

  return value;
}
