/**
 * ProviderAdapter – the common interface every infrastructure provider implements.
 *
 * Adapter pattern: the rest of CloudVM (orchestrator, inventory, sync) depends on
 * THIS interface, never on AWS/Azure/GCP/Proxmox/VMware specifics. Swapping a MOCK
 * adapter for a LIVE one (AWS SDK, Azure SDK, Proxmox API, vSphere API) means
 * writing one new class; nothing else changes.
 *
 * Responsibilities are split on purpose:
 *   Adapter (I/O)    – fetch provider data, validate its shape PER RECORD, resolve
 *                      side lookups (instance types, volumes, NICs, guest agent)
 *                      into one self-contained raw record per VM.
 *   Mapper (pure)    – turn ONE raw record into ONE NormalizedVm. No I/O, so every
 *                      rule is unit-testable with plain objects.
 */
import type { ProviderName } from '../../domain/normalized-vm.js';

export type DataSourceKind = 'MOCK' | 'LIVE';

/** A provider record that failed raw-shape validation (kept, never silently dropped). */
export interface RejectedRawRecord {
  /** Best-effort identifier for the log/UI (e.g. instance ID), if one could be read. */
  ref: string | null;
  errors: string[];
}

export interface CollectionBatch<TRaw> {
  provider: ProviderName;
  dataSource: DataSourceKind;
  /** Human-readable origin, e.g. "MOCK sample file aws.ec2.describe-instances.json". */
  sourceLabel: string;
  collectedAt: Date;
  /** One self-contained raw record per VM, already shape-validated. */
  records: TRaw[];
  /** Records whose raw shape was invalid. */
  rejected: RejectedRawRecord[];
}

export interface ProviderAdapter<TRaw> {
  readonly provider: ProviderName;
  readonly dataSource: DataSourceKind;
  /**
   * Fetches the provider's VM inventory.
   * Throws only if the WHOLE source is unusable (file missing, not labelled MOCK,
   * API unreachable). A single bad VM record never throws – it goes to `rejected`.
   */
  collect(): Promise<CollectionBatch<TRaw>>;
}
