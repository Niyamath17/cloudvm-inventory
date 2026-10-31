/**
 * Pure sync decisions (no I/O) – unit-tested in isolation.
 */
export interface SyncStateLike {
  state: 'PENDING' | 'SYNCED' | 'FAILED' | 'DUPLICATE';
  syncedFingerprint: string | null;
  remoteId: number | null;
}
export interface VmLike {
  fingerprint: string;
  lifecycle: 'ACTIVE' | 'DECOMMISSIONED';
}

/** Before any NetBox call: can this VM be skipped? */
export type PreDecision = { kind: 'SKIP'; reason: 'unchanged' | 'decommissioned-never-synced' } | { kind: 'SYNC' };

export function preDecide(vm: VmLike, state: SyncStateLike | null): PreDecision {
  if (state?.state === 'SYNCED' && state.syncedFingerprint === vm.fingerprint) return { kind: 'SKIP', reason: 'unchanged' };
  if (vm.lifecycle === 'DECOMMISSIONED' && (state === null || state.remoteId === null)) {
    // Never pushed while alive: don't create dead VMs in NetBox.
    return { kind: 'SKIP', reason: 'decommissioned-never-synced' };
  }
  return { kind: 'SYNC' };
}

/** After matching: what to do with the remote side. */
export type Action = 'CREATE' | 'UPDATE' | 'DECOMMISSION' | 'DUPLICATE' | 'SKIP';

export function decide(vm: VmLike, matches: number, hasChanges: boolean): Action {
  if (matches > 1) return 'DUPLICATE';
  if (matches === 0) return vm.lifecycle === 'DECOMMISSIONED' ? 'SKIP' : 'CREATE';
  if (!hasChanges) return 'SKIP';
  return vm.lifecycle === 'DECOMMISSIONED' ? 'DECOMMISSION' : 'UPDATE';
}
