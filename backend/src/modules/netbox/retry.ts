/**
 * Retry with exponential backoff + jitter, honouring Retry-After. Only errors marked
 * retryable (NetBoxTransientError) are retried.
 */
import { NetBoxTransientError } from './NetBoxGateway.js';

export interface RetryOptions {
  attempts: number; // total attempts, e.g. 3
  baseDelayMs: number; // e.g. 250 -> ~250ms, ~1s, ~2s
  maxDelayMs: number; // cap, e.g. 10_000
  sleep?: (ms: number) => Promise<void>;
}

export class RetryAfterError extends NetBoxTransientError {
  constructor(
    message: string,
    httpStatus: number,
    public readonly retryAfterMs: number,
  ) {
    super(message, httpStatus);
  }
}

export function backoffDelay(attempt: number, opts: RetryOptions, random = Math.random): number {
  const exp = opts.baseDelayMs * 4 ** (attempt - 1); // 250, 1000, 4000…
  const jitter = exp * 0.2 * random();
  return Math.min(opts.maxDelayMs, Math.round(exp + jitter));
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof NetBoxTransientError) || attempt >= opts.attempts) throw err;
      const delay = err instanceof RetryAfterError ? Math.min(opts.maxDelayMs, err.retryAfterMs) : backoffDelay(attempt, opts);
      await sleep(delay);
    }
  }
}
