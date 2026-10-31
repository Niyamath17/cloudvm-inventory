/**
 * planReconciliation – which queried accounts may have missing VMs decommissioned.
 */
import { describe, expect, it } from 'vitest';
import { planReconciliation } from '../../src/modules/collection/reconciliation.js';
import type { AccountOutcome } from '../../src/modules/providers/ProviderAdapter.js';
import type { NormalizationResult, NormalizedRecord } from '../../src/modules/normalization/types.js';

const rec = (account: string, id: string) => ({ vm: { account, externalId: `${account}/${id}` } }) as unknown as NormalizedRecord;
const ok = (account: string): AccountOutcome => ({ account, status: 'COMPLETE' });
const failed = (account: string): AccountOutcome => ({ account, status: 'FAILED', error: 'AccessDenied' });
const result = (vms: NormalizedRecord[], accounts: AccountOutcome[], invalid: NormalizationResult['invalid'] = []): NormalizationResult => ({
  provider: 'PROXMOX',
  dataSource: 'MOCK',
  sourceLabel: 't',
  collectedAt: new Date(),
  vms,
  skipped: [{ ref: 'tpl', reason: 'template' }],
  invalid,
  accounts,
});

describe('planReconciliation', () => {
  it('clean batch: every queried account is reconciled, status SUCCESS', () => {
    expect(planReconciliation(result([rec('a', '1'), rec('b', '1')], [ok('a'), ok('b')]))).toEqual({
      reconcile: ['a', 'b'],
      skipped: [],
      status: 'SUCCESS',
    });
  });

  it('ZERO-VM account: queried successfully with no VMs -> reconciled (its VMs get decommissioned)', () => {
    const plan = planReconciliation(result([rec('a', '1')], [ok('a'), ok('empty')]));
    expect(plan.reconcile).toEqual(['a', 'empty']);
    expect(plan.status).toBe('SUCCESS');
  });

  it('ZERO-VM provider: every queried account empty -> all reconciled', () => {
    expect(planReconciliation(result([], [ok('a'), ok('b')])).reconcile).toEqual(['a', 'b']);
  });

  it('FAILED account is never reconciled; the other accounts still are', () => {
    const plan = planReconciliation(result([rec('a', '1')], [ok('a'), failed('b')]));
    expect(plan.reconcile).toEqual(['a']);
    expect(plan.skipped).toEqual([{ account: 'b', reason: 'account query failed: AccessDenied' }]);
    expect(plan.status).toBe('PARTIAL');
  });

  it('every account FAILED -> provider FAILED, nothing reconciled', () => {
    expect(planReconciliation(result([], [failed('a'), failed('b')]))).toMatchObject({ reconcile: [], status: 'FAILED' });
  });

  it('PARTIAL account (invalid record attributed to it) is not reconciled; others are', () => {
    const plan = planReconciliation(result([rec('a', '1'), rec('b', '1')], [ok('a'), ok('b')], [{ ref: 'x', account: 'b', stage: 'raw', errors: ['bad'] }]));
    expect(plan.reconcile).toEqual(['a']);
    expect(plan.skipped).toEqual([{ account: 'b', reason: 'account returned invalid records' }]);
    expect(plan.status).toBe('PARTIAL');
  });

  it('a duplicate/validation invalid record taints the account in its externalId', () => {
    const plan = planReconciliation(result([rec('a', '1'), rec('b', '1')], [ok('a'), ok('b')], [{ ref: 'b/2', stage: 'duplicate', errors: ['dup'] }]));
    expect(plan.reconcile).toEqual(['a']);
  });

  it('an unattributable invalid record taints EVERY account', () => {
    const plan = planReconciliation(result([rec('a', '1')], [ok('a'), ok('b')], [{ ref: 'i-123', stage: 'mapping', errors: ['x'] }]));
    expect(plan.reconcile).toEqual([]);
    expect(plan.skipped.map((s) => s.account)).toEqual(['a', 'b']);
    expect(plan.status).toBe('PARTIAL');
  });

  it('accounts that were not queried are never candidates', () => {
    expect(planReconciliation(result([rec('a', '1')], [ok('a')])).reconcile).toEqual(['a']);
  });

  it('falls back to accounts seen in VMs if an adapter reports none', () => {
    expect(planReconciliation(result([rec('a', '1')], [])).reconcile).toEqual(['a']);
  });
});
