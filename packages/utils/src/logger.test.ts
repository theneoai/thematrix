import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from './logger.js';

describe('Logger', () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should log at info level by default', () => {
    const logger = new Logger({ enableColors: false });
    logger.info('test message');
    expect(consoleSpy.info).toHaveBeenCalled();
  });

  it('should not log debug when level is info', () => {
    const logger = new Logger({ level: 'info', enableColors: false });
    logger.debug('debug message');
    expect(consoleSpy.debug).not.toHaveBeenCalled();
  });

  it('should include prefix in log messages', () => {
    const logger = new Logger({ prefix: 'TEST', enableColors: false });
    logger.info('test message');
    expect(consoleSpy.info).toHaveBeenCalled();
    const callArg = consoleSpy.info.mock.calls[0][0];
    expect(callArg).toContain('[TEST]');
  });

  it('should create child logger with combined prefix', () => {
    const parent = new Logger({ prefix: 'PARENT', enableColors: false });
    const child = parent.child('CHILD');
    child.info('test message');
    expect(consoleSpy.info).toHaveBeenCalled();
    const callArg = consoleSpy.info.mock.calls[0][0];
    expect(callArg).toContain('[PARENT:CHILD]');
  });

  it('should log at all levels when level is debug', () => {
    const logger = new Logger({ level: 'debug', enableColors: false });
    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');
    expect(consoleSpy.debug).toHaveBeenCalled();
    expect(consoleSpy.info).toHaveBeenCalled();
    expect(consoleSpy.warn).toHaveBeenCalled();
    expect(consoleSpy.error).toHaveBeenCalled();
  });
});
