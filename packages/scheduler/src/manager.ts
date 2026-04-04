import type {
  CronSchedule,
  TriggerRule,
  TriggerEvent,
  ScheduleExecution,
  ISchedulerManager,
} from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';
import { CronScheduler } from './cron.js';
import { TriggerMatcher } from './trigger.js';
import { ScheduleStore } from './store.js';

export interface SchedulerManagerOptions {
  onWorkflowTrigger: (
    workflowId: string,
    input: Record<string, unknown>,
    triggerInfo: { type: 'cron' | 'event'; sourceId: string; executionId: string },
  ) => void;
  maxHistorySize?: number;
}

export class SchedulerManager implements ISchedulerManager {
  private cronScheduler: CronScheduler;
  private triggerMatcher: TriggerMatcher;
  private store: ScheduleStore;
  private logger: Logger;
  private onWorkflowTrigger: SchedulerManagerOptions['onWorkflowTrigger'];
  private lastTriggerTimes: Map<string, number> = new Map();

  constructor(options: SchedulerManagerOptions) {
    this.logger = new Logger({ prefix: 'SchedulerManager' });
    this.onWorkflowTrigger = options.onWorkflowTrigger;
    this.store = new ScheduleStore(options.maxHistorySize);
    this.triggerMatcher = new TriggerMatcher();

    this.cronScheduler = new CronScheduler((schedule: CronSchedule) => {
      this.handleCronFire(schedule);
    });
  }

  addCronJob(schedule: CronSchedule): void {
    this.cronScheduler.addJob(schedule);
  }

  removeCronJob(id: string): void {
    this.cronScheduler.removeJob(id);
  }

  addTriggerRule(rule: TriggerRule): void {
    this.triggerMatcher.addRule(rule);
  }

  removeTriggerRule(id: string): void {
    this.triggerMatcher.removeRule(id);
  }

  listJobs(): CronSchedule[] {
    return this.cronScheduler.listJobs();
  }

  listRules(): TriggerRule[] {
    return this.triggerMatcher.listRules();
  }

  getHistory(limit?: number): ScheduleExecution[] {
    return this.store.getHistory(limit);
  }

  /**
   * Handle an incoming event from the gateway. Matches against trigger rules,
   * checks cooldown and concurrency, then fires the workflow trigger callback.
   */
  handleEvent(event: TriggerEvent): void {
    const matchedRules = this.triggerMatcher.match(event);

    if (matchedRules.length === 0) {
      this.logger.debug(`No rules matched event ${event.id} (${event.platform}:${event.eventType})`);
      return;
    }

    this.logger.info(
      `Event ${event.id} matched ${matchedRules.length} rule(s): ${matchedRules.map((r) => r.name).join(', ')}`,
    );

    for (const rule of matchedRules) {
      // Check cooldown
      if (rule.cooldownMs) {
        const lastFired = this.lastTriggerTimes.get(rule.id);
        if (lastFired && Date.now() - lastFired < rule.cooldownMs) {
          this.logger.info(
            `Rule ${rule.name} is in cooldown (${rule.cooldownMs}ms), skipping`,
          );
          continue;
        }
      }

      // Check max concurrent
      if (rule.maxConcurrent) {
        const running = this.store.getRunningCount(rule.id);
        if (running >= rule.maxConcurrent) {
          this.logger.info(
            `Rule ${rule.name} at max concurrent (${running}/${rule.maxConcurrent}), skipping`,
          );
          continue;
        }
      }

      // Map input from event payload
      const input = this.triggerMatcher.mapInput(rule, event);
      const executionId = generateId();

      const execution: ScheduleExecution = {
        id: executionId,
        triggerId: rule.id,
        workflowRunId: executionId,
        triggeredAt: new Date(),
        triggerType: 'event',
        status: 'triggered',
      };

      this.store.addExecution(execution);
      this.lastTriggerTimes.set(rule.id, Date.now());

      try {
        this.onWorkflowTrigger(rule.workflowId, input, {
          type: 'event',
          sourceId: rule.id,
          executionId,
        });
      } catch (err) {
        this.logger.error(`Error triggering workflow for rule ${rule.name}: ${err}`);
        this.store.updateExecution(executionId, { status: 'failed', error: String(err) });
      }
    }
  }

  async start(): Promise<void> {
    this.cronScheduler.start();
    this.logger.info('Scheduler manager started');
  }

  async stop(): Promise<void> {
    this.cronScheduler.stop();
    this.logger.info('Scheduler manager stopped');
  }

  private handleCronFire(schedule: CronSchedule): void {
    // Check max concurrent
    if (schedule.maxConcurrent) {
      const running = this.store.getRunningCount(schedule.id);
      if (running >= schedule.maxConcurrent) {
        this.logger.info(
          `Cron job ${schedule.name} at max concurrent (${running}/${schedule.maxConcurrent}), skipping`,
        );
        return;
      }
    }

    const executionId = generateId();
    const execution: ScheduleExecution = {
      id: executionId,
      scheduleId: schedule.id,
      workflowRunId: executionId,
      triggeredAt: new Date(),
      triggerType: 'cron',
      status: 'triggered',
    };

    this.store.addExecution(execution);

    try {
      this.onWorkflowTrigger(schedule.workflowId, schedule.input ?? {}, {
        type: 'cron',
        sourceId: schedule.id,
        executionId,
      });
    } catch (err) {
      this.logger.error(`Error triggering workflow for cron job ${schedule.name}: ${err}`);
      this.store.updateExecution(executionId, { status: 'failed', error: String(err) });
    }
  }
}
