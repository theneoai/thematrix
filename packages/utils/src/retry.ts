/**
 * 重试工具
 */

export interface RetryOptions {
  maxRetries: number;
  retryDelayMs: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  retryableErrors?: (error: Error) => boolean;
}

export class RetryableError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'RetryableError';
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxRetries,
    retryDelayMs,
    backoffMultiplier = 1,
    maxDelayMs = 30000,
    retryableErrors = () => true,
  } = options;

  let lastError: Error | undefined;
  let delay = retryDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries) {
        break;
      }

      if (!retryableErrors(lastError)) {
        throw lastError;
      }

      await sleep(delay);
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw new RetryableError(
    `Failed after ${maxRetries + 1} attempts`,
    lastError
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function timeout<T>(
  promise: Promise<T>,
  ms: number,
  message = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ]);
}
