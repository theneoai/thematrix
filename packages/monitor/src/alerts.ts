/**
 * AlertManager - Evaluates alert rules and manages alert lifecycle
 */

import type { AlertRule, Alert, AlertSeverity } from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';

export type AlertCallback = (alert: Alert) => void;

interface FiringState {
  ruleId: string;
  firstTriggeredAt: number;
  lastValue: number;
}

export class AlertManager {
  private readonly logger = new Logger({ prefix: 'AlertManager' });
  private readonly rules = new Map<string, AlertRule>();
  private readonly activeAlerts = new Map<string, Alert>();
  private readonly alertHistory: Alert[] = [];
  private readonly firingStates = new Map<string, FiringState>();
  private readonly cooldowns = new Map<string, number>(); // ruleId -> last fired timestamp
  private onAlert: AlertCallback | null = null;

  constructor(onAlert?: AlertCallback) {
    this.onAlert = onAlert ?? null;
  }

  /** Set the alert callback */
  setAlertCallback(cb: AlertCallback): void {
    this.onAlert = cb;
  }

  /** Register an alert rule */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
    this.logger.info(`Alert rule added: ${rule.name} (${rule.id})`);
  }

  /** Remove an alert rule */
  removeRule(id: string): void {
    this.rules.delete(id);
    this.firingStates.delete(id);
    this.cooldowns.delete(id);
    this.logger.info(`Alert rule removed: ${id}`);
  }

  /** Get all registered rules */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Evaluate a metric value against all matching rules.
   * Call this whenever a metric is updated.
   */
  evaluate(metric: string, value: number): void {
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      if (rule.metric !== metric) continue;

      const conditionMet = this.checkCondition(rule, value);

      if (conditionMet) {
        this.handleConditionMet(rule, value);
      } else {
        // Condition no longer met, clear firing state
        this.firingStates.delete(rule.id);
      }
    }
  }

  /** Get all currently active (firing or acknowledged) alerts */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  /** Acknowledge an alert */
  acknowledgeAlert(alertId: string, acknowledgedBy?: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert || alert.status === 'resolved') return false;

    alert.status = 'acknowledged';
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;
    this.logger.info(`Alert acknowledged: ${alertId}`);
    return true;
  }

  /** Resolve an alert */
  resolveAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return false;

    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    this.activeAlerts.delete(alertId);
    this.logger.info(`Alert resolved: ${alertId}`);
    return true;
  }

  /** Get alert history (most recent first) */
  getAlertHistory(limit = 100): Alert[] {
    return this.alertHistory.slice(-limit).reverse();
  }

  // ----------------------------------------------------------
  // Private
  // ----------------------------------------------------------

  private checkCondition(rule: AlertRule, value: number): boolean {
    const { operator, threshold } = rule.condition;
    switch (operator) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  private handleConditionMet(rule: AlertRule, value: number): void {
    const now = Date.now();

    // Check cooldown
    const lastFired = this.cooldowns.get(rule.id) ?? 0;
    if (rule.cooldownMs && now - lastFired < rule.cooldownMs) {
      return;
    }

    // Track firing duration
    const state = this.firingStates.get(rule.id);
    if (!state) {
      this.firingStates.set(rule.id, {
        ruleId: rule.id,
        firstTriggeredAt: now,
        lastValue: value,
      });
      // If durationMs required, wait
      if (rule.condition.durationMs) return;
    } else {
      state.lastValue = value;
      // Check if duration requirement is met
      if (rule.condition.durationMs) {
        const elapsed = now - state.firstTriggeredAt;
        if (elapsed < rule.condition.durationMs) return;
      }
    }

    // Check if already active (firing or acknowledged) for this rule
    for (const alert of this.activeAlerts.values()) {
      if (alert.ruleId === rule.id && alert.status !== 'resolved') {
        return; // Already active, don't duplicate
      }
    }

    // Fire the alert
    this.fireAlert(rule, value);
  }

  private fireAlert(rule: AlertRule, value: number): void {
    const alert: Alert = {
      id: generateId(),
      ruleId: rule.id,
      severity: rule.severity,
      title: rule.name,
      message: `${rule.name}: ${rule.metric} is ${value} (threshold: ${rule.condition.operator} ${rule.condition.threshold})`,
      metric: rule.metric,
      currentValue: value,
      threshold: rule.condition.threshold,
      firedAt: new Date(),
      status: 'firing',
    };

    this.activeAlerts.set(alert.id, alert);
    this.alertHistory.push({ ...alert });
    // Cap alert history to prevent unbounded growth
    if (this.alertHistory.length > 10_000) {
      this.alertHistory.splice(0, this.alertHistory.length - 10_000);
    }
    this.cooldowns.set(rule.id, Date.now());

    this.logger.warn(`Alert fired: ${alert.title} [${alert.severity}] - ${alert.message}`);

    if (this.onAlert) {
      try {
        this.onAlert(alert);
      } catch (err) {
        this.logger.error('Alert callback error', err);
      }
    }
  }
}
