import type { CronSchedule } from '@thematrix/types';
import { Logger } from '@thematrix/utils';

interface CronField {
  values: number[];
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

interface CronJob {
  schedule: CronSchedule;
  parsed: ParsedCron;
  timer: ReturnType<typeof setTimeout> | null;
}

export class CronScheduler {
  private jobs: Map<string, CronJob> = new Map();
  private running = false;
  private logger: Logger;
  private onFire: (schedule: CronSchedule) => void;

  constructor(onFire: (schedule: CronSchedule) => void) {
    this.logger = new Logger({ prefix: 'CronScheduler' });
    this.onFire = onFire;
  }

  addJob(schedule: CronSchedule): void {
    if (this.jobs.has(schedule.id)) {
      this.removeJob(schedule.id);
    }

    const parsed = this.parseCron(schedule.cron);
    const job: CronJob = { schedule, parsed, timer: null };
    this.jobs.set(schedule.id, job);

    if (this.running && schedule.enabled) {
      this.scheduleNext(job);
    }

    this.logger.info(`Added cron job: ${schedule.name} (${schedule.cron})`);
  }

  removeJob(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      if (job.timer) {
        clearTimeout(job.timer);
        job.timer = null;
      }
      this.jobs.delete(id);
      this.logger.info(`Removed cron job: ${id}`);
    }
  }

  listJobs(): CronSchedule[] {
    return Array.from(this.jobs.values()).map((j) => j.schedule);
  }

  start(): void {
    this.running = true;
    for (const job of this.jobs.values()) {
      if (job.schedule.enabled) {
        this.scheduleNext(job);
      }
    }
    this.logger.info('Cron scheduler started');
  }

  stop(): void {
    this.running = false;
    for (const job of this.jobs.values()) {
      if (job.timer) {
        clearTimeout(job.timer);
        job.timer = null;
      }
    }
    this.logger.info('Cron scheduler stopped');
  }

  private scheduleNext(job: CronJob): void {
    if (!this.running || !job.schedule.enabled) return;

    const now = new Date();
    const nextRun = this.getNextRunTime(job.parsed, now, job.schedule.timezone);
    const delay = nextRun.getTime() - now.getTime();

    if (delay < 0) {
      // Should not happen, but guard against it
      this.logger.warn(`Negative delay for job ${job.schedule.id}, rescheduling in 1s`);
      job.timer = setTimeout(() => this.scheduleNext(job), 1000);
      return;
    }

    this.logger.debug(
      `Job ${job.schedule.name} next run at ${nextRun.toISOString()} (in ${Math.round(delay / 1000)}s)`,
    );

    job.timer = setTimeout(() => {
      job.timer = null;
      if (!this.running || !job.schedule.enabled) return;

      this.logger.info(`Firing cron job: ${job.schedule.name}`);
      try {
        this.onFire(job.schedule);
      } catch (err) {
        this.logger.error(`Error firing job ${job.schedule.name}: ${err}`);
      }

      // Reschedule
      this.scheduleNext(job);
    }, delay);
  }

  /**
   * Parse a 5-field cron expression: minute hour day-of-month month day-of-week
   * Supports: *, specific values, ranges (1-5), steps (* /5), lists (1,3,5)
   */
  parseCron(expression: string): ParsedCron {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression: "${expression}" - expected 5 fields`);
    }

    return {
      minute: this.parseField(parts[0], 0, 59),
      hour: this.parseField(parts[1], 0, 23),
      dayOfMonth: this.parseField(parts[2], 1, 31),
      month: this.parseField(parts[3], 1, 12),
      dayOfWeek: this.parseField(parts[4], 0, 6),
    };
  }

  private parseField(field: string, min: number, max: number): CronField {
    const values = new Set<number>();

    for (const part of field.split(',')) {
      if (part === '*') {
        for (let i = min; i <= max; i++) values.add(i);
      } else if (part.includes('/')) {
        // Step values: */5 or 1-10/2
        const [range, stepStr] = part.split('/');
        const step = parseInt(stepStr, 10);
        if (isNaN(step) || step <= 0) {
          throw new Error(`Invalid step value in cron field: "${field}"`);
        }
        let start = min;
        let end = max;
        if (range !== '*') {
          if (range.includes('-')) {
            [start, end] = range.split('-').map(Number);
          } else {
            start = parseInt(range, 10);
          }
        }
        for (let i = start; i <= end; i += step) {
          values.add(i);
        }
      } else if (part.includes('-')) {
        // Range: 1-5
        const [start, end] = part.split('-').map(Number);
        if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
          throw new Error(`Invalid range "${part}" in cron field (valid: ${min}-${max})`);
        }
        for (let i = start; i <= end; i++) {
          values.add(i);
        }
      } else {
        // Single value
        const val = parseInt(part, 10);
        if (isNaN(val) || val < min || val > max) {
          throw new Error(`Invalid value "${part}" in cron field (range ${min}-${max})`);
        }
        values.add(val);
      }
    }

    return { values: Array.from(values).sort((a, b) => a - b) };
  }

  /**
   * Convert a UTC Date to the individual date/time components in a given timezone.
   * Uses Intl.DateTimeFormat to resolve the wall-clock time in the target timezone.
   */
  private getPartsInTimezone(date: Date, timezone: string): {
    year: number; month: number; day: number; hour: number; minute: number; weekday: number;
  } {
    let fmt: Intl.DateTimeFormat;
    try {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'short',
        hour12: false,
      });
    } catch (err) {
      throw new Error(`Invalid timezone "${timezone}": ${err instanceof Error ? err.message : String(err)}`);
    }

    const parts = fmt.formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find(p => p.type === type)?.value ?? '0';

    const weekdayStr = get('weekday');
    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };

    return {
      year: parseInt(get('year'), 10),
      month: parseInt(get('month'), 10),
      day: parseInt(get('day'), 10),
      hour: parseInt(get('hour'), 10),
      minute: parseInt(get('minute'), 10),
      weekday: weekdayMap[weekdayStr] ?? 0,
    };
  }

  /**
   * Calculate the next run time from `now` that matches the parsed cron expression.
   * Scans forward minute by minute (up to ~2 years) to find a match.
   *
   * If a timezone is provided, the cron fields are evaluated against the wall-clock
   * time in that timezone, but the returned Date is in UTC.
   */
  getNextRunTime(parsed: ParsedCron, now: Date, timezone?: string): Date {
    const candidate = new Date(now);
    // Start from the next minute
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);

    // Safety limit: don't scan more than ~2 years worth of minutes
    const maxIterations = 366 * 24 * 60;

    for (let i = 0; i < maxIterations; i++) {
      let month: number;
      let dayOfMonth: number;
      let dayOfWeek: number;
      let hour: number;
      let minute: number;

      if (timezone) {
        const parts = this.getPartsInTimezone(candidate, timezone);
        month = parts.month;
        dayOfMonth = parts.day;
        dayOfWeek = parts.weekday;
        hour = parts.hour;
        minute = parts.minute;
      } else {
        month = candidate.getMonth() + 1; // 1-12
        dayOfMonth = candidate.getDate();
        dayOfWeek = candidate.getDay(); // 0=Sun
        hour = candidate.getHours();
        minute = candidate.getMinutes();
      }

      // Per cron spec: dayOfMonth and dayOfWeek use logical OR when both are specified (not *)
      const dayOfMonthIsWild = parsed.dayOfMonth.values.length === 31;
      const dayOfWeekIsWild = parsed.dayOfWeek.values.length === 7;
      let dayMatch: boolean;
      if (dayOfMonthIsWild && dayOfWeekIsWild) {
        dayMatch = true; // Both wildcard — any day
      } else if (dayOfMonthIsWild) {
        dayMatch = parsed.dayOfWeek.values.includes(dayOfWeek); // Only dayOfWeek constrained
      } else if (dayOfWeekIsWild) {
        dayMatch = parsed.dayOfMonth.values.includes(dayOfMonth); // Only dayOfMonth constrained
      } else {
        dayMatch = parsed.dayOfMonth.values.includes(dayOfMonth) || parsed.dayOfWeek.values.includes(dayOfWeek); // Both specified — OR
      }

      if (
        parsed.month.values.includes(month) &&
        dayMatch &&
        parsed.hour.values.includes(hour) &&
        parsed.minute.values.includes(minute)
      ) {
        return candidate;
      }

      candidate.setMinutes(candidate.getMinutes() + 1);
    }

    throw new Error('Could not find next cron run time within scan window');
  }
}
