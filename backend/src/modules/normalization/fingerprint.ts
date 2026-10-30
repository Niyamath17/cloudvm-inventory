/**
 * Deterministic fingerprint of a NormalizedVm.
 *
 * SHA-256 over a canonical JSON of the fields that matter for NetBox sync.
 * "Canonical" = fixed field order, sorted IPs, sorted tag keys – so the same VM
 * data always yields the same hash, regardless of the order a provider returned
 * things in. Excluded on purpose:
 *   - discoveredAt  (changes every run; would make every VM look changed)
 *   - rawData       (provider noise such as uptime counters)
 *   - rawPowerState ("pending" vs "running" both normalise to RUNNING)
 *   - dataSource    (provenance, not VM state)
 *
 * M4 compares this with VmSyncState.syncedFingerprint: equal => SKIP (no write).
 */
import { createHash } from 'node:crypto';
import type { NormalizedVm } from '../../domain/normalized-vm.js';

export const FINGERPRINT_VERSION = 1;

export function fingerprintFields(vm: NormalizedVm) {
  return {
    v: FINGERPRINT_VERSION,
    provider: vm.provider,
    externalId: vm.externalId,
    name: vm.name,
    hostname: vm.hostname,
    ipAddresses: [...vm.ipAddresses].sort(),
    osName: vm.osName,
    cpuCores: vm.cpuCores,
    memoryMb: vm.memoryMb,
    diskGb: vm.diskGb,
    region: vm.region,
    cluster: vm.cluster,
    owner: vm.owner,
    tags: Object.fromEntries(Object.entries(vm.tags).sort(([a], [b]) => a.localeCompare(b))),
    powerState: vm.powerState,
    lifecycle: vm.lifecycle,
  };
}

export function fingerprint(vm: NormalizedVm): string {
  return createHash('sha256').update(JSON.stringify(fingerprintFields(vm))).digest('hex');
}
