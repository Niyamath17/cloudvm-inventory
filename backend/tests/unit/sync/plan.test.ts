import { describe, expect, it } from 'vitest';
import { decide, preDecide } from '../../../src/modules/sync/plan.js';

const active = { fingerprint: 'f1', lifecycle: 'ACTIVE' as const };
const dead = { fingerprint: 'f1', lifecycle: 'DECOMMISSIONED' as const };

describe('preDecide', () => {
  it('skips an unchanged, already synced VM (no NetBox call)', () => {
    expect(preDecide(active, { state: 'SYNCED', syncedFingerprint: 'f1', remoteId: 3 })).toEqual({ kind: 'SKIP', reason: 'unchanged' });
  });
  it('syncs when the fingerprint changed, or after a failure', () => {
    expect(preDecide(active, { state: 'SYNCED', syncedFingerprint: 'old', remoteId: 3 }).kind).toBe('SYNC');
    expect(preDecide(active, { state: 'FAILED', syncedFingerprint: 'f1', remoteId: 3 }).kind).toBe('SYNC');
    expect(preDecide(active, null).kind).toBe('SYNC');
  });
  it('never creates a VM that was already dead before its first sync', () => {
    expect(preDecide(dead, null)).toEqual({ kind: 'SKIP', reason: 'decommissioned-never-synced' });
  });
  it('syncs a decommission for a VM that exists in NetBox', () => {
    expect(preDecide(dead, { state: 'SYNCED', syncedFingerprint: 'old', remoteId: 3 }).kind).toBe('SYNC');
  });
});

describe('decide', () => {
  it.each([
    [active, 0, false, 'CREATE'],
    [active, 1, true, 'UPDATE'],
    [active, 1, false, 'SKIP'],
    [active, 2, true, 'DUPLICATE'],
    [dead, 1, true, 'DECOMMISSION'],
    [dead, 0, false, 'SKIP'],
    [dead, 3, true, 'DUPLICATE'],
  ] as const)('%o, matches=%i, changed=%s -> %s', (vm, matches, changed, expected) => {
    expect(decide(vm, matches, changed)).toBe(expected);
  });
});
