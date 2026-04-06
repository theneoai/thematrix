import type { TriggerRule, TriggerCondition, TriggerEvent } from '@thematrix/types';
import { Logger } from '@thematrix/utils';

export class TriggerMatcher {
  private rules: Map<string, TriggerRule> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ prefix: 'TriggerMatcher' });
  }

  addRule(rule: TriggerRule): void {
    this.rules.set(rule.id, rule);
    this.logger.info(`Added trigger rule: ${rule.name} [${rule.channel}:${rule.eventType}]`);
  }

  removeRule(id: string): void {
    this.rules.delete(id);
    this.logger.info(`Removed trigger rule: ${id}`);
  }

  listRules(): TriggerRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Check if an event matches any registered rules. Returns all matched rules.
   */
  match(event: TriggerEvent): TriggerRule[] {
    const matched: TriggerRule[] = [];

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      if (this.matchRule(rule, event)) {
        matched.push(rule);
      }
    }

    return matched;
  }

  /**
   * Check if a single rule matches an event by platform, eventType, and conditions.
   */
  matchRule(rule: TriggerRule, event: TriggerEvent): boolean {
    // Platform must match
    if (rule.channel !== event.platform) return false;

    // Event type must match
    if (rule.eventType !== event.eventType) return false;

    // All conditions must be satisfied
    if (rule.conditions && rule.conditions.length > 0) {
      for (const condition of rule.conditions) {
        if (!this.evaluateCondition(condition, event.payload)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Evaluate a single condition against an event payload.
   * Field uses JSONPath-like syntax: $.field.subfield
   */
  evaluateCondition(condition: TriggerCondition, payload: Record<string, unknown>): boolean {
    const fieldValue = this.resolveJsonPath(condition.field, payload);

    switch (condition.operator) {
      case 'equals':
        return fieldValue === condition.value;

      case 'not_equals':
        return fieldValue !== condition.value;

      case 'contains': {
        if (typeof fieldValue === 'string' && typeof condition.value === 'string') {
          return fieldValue.includes(condition.value);
        }
        if (Array.isArray(fieldValue)) {
          return fieldValue.includes(condition.value);
        }
        return false;
      }

      case 'matches': {
        if (typeof fieldValue !== 'string' || typeof condition.value !== 'string') return false;
        // Guard against ReDoS by limiting field value length
        if (fieldValue.length > 10_000) {
          this.logger.warn(`Field value too long for regex matching: ${fieldValue.length} chars`);
          return false;
        }
        try {
          const regex = new RegExp(condition.value);
          return regex.test(fieldValue);
        } catch {
          this.logger.warn(`Invalid regex in condition: ${condition.value}`);
          return false;
        }
      }

      case 'in': {
        if (!Array.isArray(condition.value)) return false;
        return condition.value.includes(fieldValue as string);
      }

      case 'gt': {
        if (typeof fieldValue === 'number' && typeof condition.value === 'number') {
          return fieldValue > condition.value;
        }
        return false;
      }

      case 'lt': {
        if (typeof fieldValue === 'number' && typeof condition.value === 'number') {
          return fieldValue < condition.value;
        }
        return false;
      }

      default:
        this.logger.warn(`Unknown operator: ${(condition as TriggerCondition).operator}`);
        return false;
    }
  }

  /**
   * Apply inputMapping to extract workflow input from event payload.
   * Each key in inputMapping maps to a JSONPath expression resolved against the event payload.
   */
  mapInput(rule: TriggerRule, event: TriggerEvent): Record<string, unknown> {
    const input: Record<string, unknown> = {};

    const entries = Object.entries(rule.inputMapping);
    // Limit the number of input mapping keys to prevent unbounded expansion
    const MAX_INPUT_KEYS = 100;
    if (entries.length > MAX_INPUT_KEYS) {
      this.logger.warn(
        `Input mapping for rule "${rule.name}" has ${entries.length} keys, limiting to ${MAX_INPUT_KEYS}`,
      );
    }

    for (const [key, path] of entries.slice(0, MAX_INPUT_KEYS)) {
      input[key] = this.resolveJsonPath(path as string, event.payload);
    }

    return input;
  }

  /**
   * Resolve a simple JSONPath-like expression: $.field.subfield
   * Supports dot notation only.
   */
  private resolveJsonPath(path: string, obj: Record<string, unknown>): unknown {
    // Strip leading "$." if present
    const normalized = path.startsWith('$.') ? path.slice(2) : path;
    const parts = normalized.split('.');

    // Limit traversal depth to prevent abuse via deeply nested paths
    const MAX_DEPTH = 20;
    if (parts.length > MAX_DEPTH) {
      this.logger.warn(`JSONPath too deep (${parts.length} levels, max ${MAX_DEPTH}): ${path}`);
      return undefined;
    }

    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }
}
