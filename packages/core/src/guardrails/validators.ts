/**
 * Output Validator - Structured output validation against JSON schemas
 */
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'OutputValidator' });

export class OutputValidator {
  /**
   * Validate a string output against a JSON schema definition.
   * Attempts to parse the output as JSON and performs basic schema validation
   * (required fields, type checking, enum values).
   */
  validateStructuredOutput(
    output: string,
    schema: Record<string, unknown>,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Step 1: parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Invalid JSON: ${message}`);
      return { valid: false, errors };
    }

    // Step 2: validate against schema (with depth limit to prevent stack overflow)
    this.validateValue(parsed, schema, '', errors, 0);

    const valid = errors.length === 0;
    if (!valid) {
      logger.warn(`Structured output validation failed with ${errors.length} error(s)`);
    }
    return { valid, errors };
  }

  private static readonly MAX_DEPTH = 20;

  private validateValue(
    value: unknown,
    schema: Record<string, unknown>,
    path: string,
    errors: string[],
    depth: number,
  ): void {
    if (depth > OutputValidator.MAX_DEPTH) {
      errors.push(`${path || '(root)'}: schema validation exceeded maximum depth of ${OutputValidator.MAX_DEPTH}`);
      return;
    }
    const expectedType = schema['type'] as string | undefined;

    if (expectedType) {
      if (!this.checkType(value, expectedType)) {
        errors.push(`${path || '(root)'}: expected type "${expectedType}" but got "${this.getType(value)}"`);
        return; // no point drilling deeper if root type is wrong
      }
    }

    // Enum validation
    const enumValues = schema['enum'] as unknown[] | undefined;
    if (enumValues && !enumValues.includes(value)) {
      errors.push(`${path || '(root)'}: value must be one of [${enumValues.map(v => JSON.stringify(v)).join(', ')}]`);
    }

    // Object validation
    if (expectedType === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const properties = schema['properties'] as Record<string, Record<string, unknown>> | undefined;
      const required = schema['required'] as string[] | undefined;

      // Check required fields
      if (required) {
        for (const field of required) {
          if (!(field in (value as Record<string, unknown>))) {
            errors.push(`${path || '(root)'}: missing required field "${field}"`);
          }
        }
      }

      // Validate each property
      if (properties) {
        const obj = value as Record<string, unknown>;
        for (const [key, propSchema] of Object.entries(properties)) {
          if (key in obj) {
            this.validateValue(obj[key], propSchema, path ? `${path}.${key}` : key, errors, depth + 1);
          }
        }
      }
    }

    // Array validation
    if (expectedType === 'array' && Array.isArray(value)) {
      const items = schema['items'] as Record<string, unknown> | undefined;
      if (items) {
        for (let i = 0; i < value.length; i++) {
          this.validateValue(value[i], items, `${path || '(root)'}[${i}]`, errors, depth + 1);
        }
      }
    }
  }

  private checkType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
      case 'integer':
        return typeof value === 'number' && (expectedType !== 'integer' || Number.isInteger(value));
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      case 'null':
        return value === null;
      default:
        return true;
    }
  }

  private getType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }
}
