/**
 * Mapper contract: ONE raw provider record in, ONE outcome out.
 *
 *   vm       – mapped successfully (may carry warnings about missing/odd fields)
 *   skipped  – valid record that is deliberately NOT a VM (e.g. Proxmox template)
 *   invalid  – cannot produce a trustworthy VM (no stable identity, failed validation)
 */
import type { NormalizedVm, ProviderName } from '../../domain/normalized-vm.js';
import type { AccountOutcome } from '../providers/ProviderAdapter.js';

/** Mapper output before the final schema check and fingerprinting. */
export type DraftVm = Omit<NormalizedVm, 'discoveredAt' | 'dataSource'>;

export type MapOutcome =
  | { kind: 'vm'; vm: DraftVm; warnings: string[] }
  | { kind: 'skipped'; ref: string; reason: string }
  | { kind: 'invalid'; ref: string | null; errors: string[] };

export type VmMapper<TRaw> = (raw: TRaw) => MapOutcome;

/** A normalized VM ready for M3: validated, stamped, fingerprinted. */
export interface NormalizedRecord {
  vm: NormalizedVm;
  fingerprint: string;
  warnings: string[];
}

export interface NormalizationResult {
  provider: ProviderName;
  dataSource: 'MOCK' | 'LIVE';
  sourceLabel: string;
  collectedAt: Date;
  vms: NormalizedRecord[];
  skipped: Array<{ ref: string; reason: string }>;
  /** `account` is set when the invalid record could be attributed to an account. */
  invalid: Array<{ ref: string | null; account?: string; stage: 'raw' | 'mapping' | 'validation' | 'duplicate'; errors: string[] }>;
  /** Every account the adapter queried, with its outcome (passed through from the batch). */
  accounts: AccountOutcome[];
}
