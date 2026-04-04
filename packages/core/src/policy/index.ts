/**
 * Policy Engine - 策略引擎
 *
 * Evaluates policies against execution contexts to enforce
 * security, compliance, and operational rules.
 */

import type {
  Policy,
  PolicyRule,
  PolicyScope,
  PolicyEvalContext,
  PolicyEvalResult,
  PolicyViolation,
  IPolicyEngine,
  IEventBus,
} from '@thematrix/types';
import { EventTypes } from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';

const logger = new Logger({ prefix: 'PolicyEngine' });

export class PolicyEngine implements IPolicyEngine {
  private policies = new Map<string, Policy>();
  private eventBus?: IEventBus;

  constructor(eventBus?: IEventBus) {
    this.eventBus = eventBus;
  }

  addPolicy(policy: Policy): void {
    this.policies.set(policy.id, policy);
    logger.info(`Policy added: ${policy.name} (${policy.id}), scope=${JSON.stringify(policy.scope)}`);
  }

  removePolicy(policyId: string): void {
    this.policies.delete(policyId);
    logger.info(`Policy removed: ${policyId}`);
  }

  listPolicies(): Policy[] {
    return Array.from(this.policies.values());
  }

  evaluate(context: PolicyEvalContext): PolicyEvalResult {
    const violations: PolicyViolation[] = [];

    for (const policy of this.policies.values()) {
      if (!this.scopeMatches(policy.scope, context)) {
        continue;
      }

      for (const rule of policy.rules) {
        const conditionMet = this.evaluateCondition(rule.condition, context);

        if (conditionMet && rule.effect === 'deny') {
          violations.push({
            policyId: policy.id,
            ruleId: rule.id,
            message: rule.description,
            enforcement: policy.enforcement,
          });
        }
      }
    }

    const enforced = violations.filter(v => v.enforcement === 'enforce');
    const allowed = enforced.length === 0;

    if (violations.length > 0) {
      logger.warn(
        `Policy evaluation: ${violations.length} violation(s), allowed=${allowed}, action=${context.action} resource=${context.resource}`
      );
      this.publishEvent(EventTypes.POLICY_VIOLATED, {
        context,
        violations,
        allowed,
      });
    } else {
      this.publishEvent(EventTypes.POLICY_EVALUATED, {
        context,
        allowed: true,
      });
    }

    return { allowed, violations };
  }

  private scopeMatches(scope: PolicyScope, context: PolicyEvalContext): boolean {
    switch (scope.type) {
      case 'global':
        return true;
      case 'workflow':
        return context.workflowId === scope.workflowId;
      case 'agent':
        return context.agentId === scope.agentId;
      case 'environment':
        return context.environment === scope.environment;
      default:
        return false;
    }
  }

  /**
   * Evaluate a condition expression against the context.
   *
   * Supported expression syntax:
   *   - `field == value` / `field != value`
   *   - `field in [val1, val2]`
   *   - `field matches /regex/`
   *   - `field > number` / `field < number`
   *   - Boolean combinators: `&&`, `||`
   *
   * For simplicity we evaluate a single condition at a time (no nested parens).
   */
  private evaluateCondition(condition: string, context: PolicyEvalContext): boolean {
    try {
      // Build a flat context object for field resolution
      const flatContext: Record<string, unknown> = {
        action: context.action,
        resource: context.resource,
        workflowId: context.workflowId ?? '',
        agentId: context.agentId ?? '',
        environment: context.environment ?? '',
        ...context.metadata,
      };

      // Handle && (all must be true)
      if (condition.includes('&&')) {
        return condition.split('&&').every(part => this.evaluateSingle(part.trim(), flatContext));
      }

      // Handle || (any must be true)
      if (condition.includes('||')) {
        return condition.split('||').some(part => this.evaluateSingle(part.trim(), flatContext));
      }

      return this.evaluateSingle(condition, flatContext);
    } catch (error) {
      logger.error(`Failed to evaluate condition "${condition}":`, error);
      return false;
    }
  }

  private evaluateSingle(expr: string, context: Record<string, unknown>): boolean {
    // field == "value"
    let match = expr.match(/^(\w+)\s*==\s*"([^"]*)"$/);
    if (match) {
      return String(context[match[1]] ?? '') === match[2];
    }

    // field != "value"
    match = expr.match(/^(\w+)\s*!=\s*"([^"]*)"$/);
    if (match) {
      return String(context[match[1]] ?? '') !== match[2];
    }

    // field == value (unquoted)
    match = expr.match(/^(\w+)\s*==\s*(\S+)$/);
    if (match) {
      const fieldVal = context[match[1]];
      const compareVal = match[2];
      if (compareVal === 'true') return fieldVal === true;
      if (compareVal === 'false') return fieldVal === false;
      return String(fieldVal ?? '') === compareVal;
    }

    // field != value (unquoted)
    match = expr.match(/^(\w+)\s*!=\s*(\S+)$/);
    if (match) {
      return String(context[match[1]] ?? '') !== match[2];
    }

    // field > number
    match = expr.match(/^(\w+)\s*>\s*(\d+(?:\.\d+)?)$/);
    if (match) {
      return Number(context[match[1]] ?? 0) > Number(match[2]);
    }

    // field < number
    match = expr.match(/^(\w+)\s*<\s*(\d+(?:\.\d+)?)$/);
    if (match) {
      return Number(context[match[1]] ?? 0) < Number(match[2]);
    }

    // field in [val1, val2, val3]
    match = expr.match(/^(\w+)\s+in\s+\[([^\]]*)\]$/);
    if (match) {
      const values = match[2].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      return values.includes(String(context[match[1]] ?? ''));
    }

    // field matches /regex/
    match = expr.match(/^(\w+)\s+matches\s+\/(.*)\/$/);
    if (match) {
      const fieldValue = String(context[match[1]] ?? '');
      if (fieldValue.length > 10_000) return false;
      try {
        return new RegExp(match[2]).test(fieldValue);
      } catch {
        return false;
      }
    }

    // Bare truthy: just a field name
    if (/^\w+$/.test(expr)) {
      return Boolean(context[expr]);
    }

    logger.warn(`Unrecognized condition expression: "${expr}"`);
    return false;
  }

  private publishEvent(type: string, payload: unknown): void {
    if (!this.eventBus) return;
    this.eventBus.publish({
      eventId: generateId(),
      type,
      source: { kind: 'system', id: 'policy-engine' },
      timestamp: new Date(),
      payload,
      correlationId: '',
    }).catch(err => logger.error('Failed to publish policy event:', err));
  }
}
