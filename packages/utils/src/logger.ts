/**
 * Logger 工具
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  enableColors?: boolean;
}

export class Logger {
  private level: LogLevel;
  private prefix: string;
  private enableColors: boolean;

  private static levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.prefix = options.prefix ?? '';
    this.enableColors = options.enableColors ?? true;
  }

  private shouldLog(level: LogLevel): boolean {
    return Logger.levelPriority[level] >= Logger.levelPriority[this.level];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    const prefix = this.prefix ? `[${this.prefix}] ` : '';
    return `${timestamp} ${prefix}${message}`;
  }

  private colorize(level: LogLevel, text: string): string {
    if (!this.enableColors) return text;
    
    const colors: Record<LogLevel, string> = {
      debug: '\x1b[36m',  // Cyan
      info: '\x1b[32m',   // Green
      warn: '\x1b[33m',   // Yellow
      error: '\x1b[31m',  // Red
    };
    const reset = '\x1b[0m';
    return `${colors[level]}${text}${reset}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.colorize('debug', this.formatMessage('debug', message)), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(this.colorize('info', this.formatMessage('info', message)), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.colorize('warn', this.formatMessage('warn', message)), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.colorize('error', this.formatMessage('error', message)), ...args);
    }
  }

  child(prefix: string): Logger {
    return new Logger({
      level: this.level,
      prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix,
      enableColors: this.enableColors,
    });
  }
}

export const defaultLogger = new Logger();
