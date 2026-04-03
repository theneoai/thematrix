import { describe, it, expect } from 'vitest';
import { withRetry, sleep, timeout, RetryableError } from './retry.js';

describe('retry', () => {
  describe('sleep', () => {
    it('should wait for specified time', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });

  describe('timeout', () => {
    it('should return result if promise resolves in time', async () => {
      const result = await timeout(
        Promise.resolve('success'),
        1000
      );
      expect(result).toBe('success');
    });

    it('should throw if promise times out', async () => {
      await expect(
        timeout(sleep(100), 50, 'Custom timeout message')
      ).rejects.toThrow('Custom timeout message');
    });
  });

  describe('withRetry', () => {
    it('should return result on first success', async () => {
      const fn = () => Promise.resolve('success');
      const result = await withRetry(fn, {
        maxRetries: 3,
        retryDelayMs: 10,
      });
      expect(result).toBe('success');
    });

    it('should retry on failure and eventually succeed', async () => {
      let attempts = 0;
      const fn = () => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('temporary error'));
        }
        return Promise.resolve('success');
      };

      const result = await withRetry(fn, {
        maxRetries: 3,
        retryDelayMs: 10,
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should throw RetryableError after max retries', async () => {
      const fn = () => Promise.reject(new Error('persistent error'));

      await expect(
        withRetry(fn, {
          maxRetries: 2,
          retryDelayMs: 10,
        })
      ).rejects.toThrow(RetryableError);
    });

    it('should not retry non-retryable errors', async () => {
      let attempts = 0;
      const fn = () => {
        attempts++;
        return Promise.reject(new Error('fatal error'));
      };

      await expect(
        withRetry(fn, {
          maxRetries: 3,
          retryDelayMs: 10,
          retryableErrors: (e) => e.message !== 'fatal error',
        })
      ).rejects.toThrow('fatal error');

      expect(attempts).toBe(1);
    });
  });
});
