/**
 * Reconciliation planning – decides, per provider batch, WHICH accounts may have
 * missing VMs decommissioned. Pure function, no I/O.
 *
 * Driven by the accounts the adapter reports it QUERIED (batch.accounts), not by the
 * accounts that happen to have VMs – so an account that was queried successfully and
 * returned ZERO VMs is reconciled (its previously discovered VMs are decommissioned).
 *
 * Per queried account:
 *   status FAILED                         -> NOT reconciled (unknown, not empty)
 *   has an invalid record of its own      -> NOT reconciled (the bad record may be a live VM)
 *   provider has an unattributable invalid record -> NOT reconciled (could belong to any account)
 *   otherwise (COMPLETE, clean)           -> reconciled, even with zero VMs
 * Accounts not queried at all are never touched.
 *
 * Provider status: SUCCESS (all accounts COMPLETE, no invalid records),
 *                  FAILED  (every queried account FAILED),
 *                  PARTIAL (anything in between).
 */
import type { NormalizationResult } from '../normalization/types.js';

export interface ReconciliationPlan {
  /** Accounts whose collection is complete and trustworthy: missing ACTIVE VMs are decommissioned. */
  reconcile: string[];
  /** Queried accounts NOT reconciled, with the reason. */
  skipped: Array<{ account: string; reason: string }>;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
}

/** Account part of a scoped externalId (identity.ts guarantees "<account>/..."). */
export const accountOf = (externalId: string): string => externalId.split('/')[0] ?? externalId;

export function planReconciliation(result: NormalizationResult): ReconciliationPlan {
  // Defensive: an adapter that reports no accounts falls back to the accounts seen in its VMs.
  const queried = result.accounts.length
    ? result.accounts
    : [...new Set(result.vms.map((r) => r.vm.account))].map((account) => ({ account, status: 'COMPLETE' as const }));

  let unattributable = false;
  const tainted = new Set<string>();
  for (const inv of result.invalid) {
    if (inv.account) tainted.add(inv.account);
    else if ((inv.stage === 'validation' || inv.stage === 'duplicate') && inv.ref?.includes('/')) tainted.add(accountOf(inv.ref));
    else unattributable = true;
  }

  const reconcile: string[] = [];
  const skipped: ReconciliationPlan['skipped'] = [];
  for (const a of [...queried].sort((x, y) => x.account.localeCompare(y.account))) {
    if (a.status === 'FAILED') skipped.push({ account: a.account, reason: `account query failed: ${a.error ?? 'unknown error'}` });
    else if (tainted.has(a.account)) skipped.push({ account: a.account, reason: 'account returned invalid records' });
    else if (unattributable) skipped.push({ account: a.account, reason: 'provider returned invalid records that cannot be attributed to an account' });
    else reconcile.push(a.account);
  }

  const allFailed = queried.length > 0 && queried.every((a) => a.status === 'FAILED');
  const status = allFailed ? 'FAILED' : skipped.length === 0 && result.invalid.length === 0 ? 'SUCCESS' : 'PARTIAL';
  return { reconcile, skipped, status };
}
