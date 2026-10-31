import { describe, expect, it } from 'vitest';
import { NetBoxTransientError, NetBoxValidationError } from '../../../src/modules/netbox/NetBoxGateway.js';
import { backoffDelay, RetryAfterError, withRetry } from '../../../src/modules/netbox/retry.js';

const opts = { attempts: 3, baseDelayMs: 250, maxDelayMs: 10_000 };

describe('retry', () => {
  it('exponential backoff with bounded jitter', () => {
    expect(backoffDelay(1, opts, () => 0)).toBe(250);
    expect(backoffDelay(2, opts, () => 0)).toBe(1000);
    expect(backoffDelay(2, opts, () => 1)).toBe(1200);
    expect(backoffDelay(9, opts, () => 0)).toBe(10_000);
  });

  it('retries transient errors, then succeeds', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 3) throw new NetBoxTransientError('503');
      return 'ok';
    }, { ...opts, sleep: async (ms) => void sleeps.push(ms) });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(sleeps).toHaveLength(2);
  });

  it('gives up after the last attempt', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls += 1; throw new NetBoxTransientError('down'); }, { ...opts, sleep: async () => {} })).rejects.toThrow('down');
    expect(calls).toBe(3);
  });

  it('never retries non-transient errors', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls += 1; throw new NetBoxValidationError('bad'); }, { ...opts, sleep: async () => {} })).rejects.toThrow('bad');
    expect(calls).toBe(1);
  });

  it('honours Retry-After (capped)', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await withRetry(async () => {
      calls += 1;
      if (calls === 1) throw new RetryAfterError('429', 429, 3000);
      if (calls === 2) throw new RetryAfterError('429', 429, 60_000);
      return 1;
    }, { ...opts, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([3000, 10_000]);
  });
});
