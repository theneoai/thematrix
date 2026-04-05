import type { CronSchedule, TriggerRule, ScheduleExecution } from '@thematrix/types';

export class ScheduleStore {
  private executions: ScheduleExecution[] = [];
  private maxHistorySize: number;

  constructor(maxHistorySize = 1000) {
    this.maxHistorySize = maxHistorySize;
  }

  addExecution(exec: ScheduleExecution): void {
    this.executions.push(exec);
    if (this.executions.length > this.maxHistorySize) {
      this.executions = this.executions.slice(-this.maxHistorySize);
    }
  }

  getHistory(limit?: number): ScheduleExecution[] {
    const sorted = [...this.executions].sort(
      (a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime(),
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  getByScheduleId(id: string): ScheduleExecution[] {
    return this.executions
      .filter((e) => e.scheduleId === id || e.triggerId === id)
      .sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime());
  }

  updateExecution(id: string, update: Partial<ScheduleExecution>): void {
    const idx = this.executions.findIndex((e) => e.id === id);
    if (idx !== -1) {
      this.executions[idx] = { ...this.executions[idx], ...update };
    }
  }

  getRunningCount(scheduleOrTriggerId: string): number {
    return this.executions.filter(
      (e) =>
        (e.scheduleId === scheduleOrTriggerId || e.triggerId === scheduleOrTriggerId) &&
        (e.status === 'triggered' || e.status === 'running'),
    ).length;
  }
}
