/**
 * All five MOCK providers together, through the registry the orchestrator (M3) will use.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createMockProviders } from '../../../src/modules/providers/registry.js';
import type { NormalizationResult } from '../../../src/modules/normalization/types.js';
import { normalizedVmSchema } from '../../../src/domain/normalized-vm.js';

const collectAll = async () => Promise.all(createMockProviders().map((p) => p.collectAndNormalize()));
let results: NormalizationResult[];
beforeAll(async () => {
  results = await collectAll();
});
const allVms = () => results.flatMap((r) => r.vms);

describe('all 60 MOCK records together', () => {
  it('registers five MOCK providers', () => {
    const providers = createMockProviders();
    expect(providers.map((p) => p.provider)).toEqual(['AWS', 'AZURE', 'GCP', 'PROXMOX', 'VMWARE']);
    expect(providers.every((p) => p.dataSource === 'MOCK')).toBe(true);
  });

  it('60 entries -> 58 normalized VMs, 2 skipped, 0 invalid', () => {
    expect(allVms()).toHaveLength(58);
    expect(results.flatMap((r) => r.skipped)).toHaveLength(2);
    expect(results.flatMap((r) => r.invalid)).toEqual([]);
    expect(Object.fromEntries(results.map((r) => [r.provider, r.vms.length]))).toEqual({
      AWS: 14,
      AZURE: 12,
      GCP: 12,
      PROXMOX: 9,
      VMWARE: 11,
    });
  });

  it('every VM passes the NormalizedVm schema and is labelled MOCK', () => {
    for (const { vm } of allVms()) {
      expect(normalizedVmSchema.safeParse(vm).success).toBe(true);
      expect(vm.dataSource).toBe('MOCK');
    }
  });

  it('58 unique (provider, externalId) identities, although names repeat', () => {
    const keys = allVms().map((v) => `${v.vm.provider}|${v.vm.externalId}`);
    expect(new Set(keys).size).toBe(58);
    const names = allVms().map((v) => v.vm.name);
    expect(names.filter((n) => n === 'web-01')).toHaveLength(2); // AWS + VMware
    expect(names.filter((n) => n === 'app-server')).toHaveLength(2); // VMware x2
  });

  it('58 distinct fingerprints, identical on a repeated collection', async () => {
    const first = allVms().map((v) => v.fingerprint);
    expect(new Set(first).size).toBe(58);
    const second = (await collectAll()).flatMap((r) => r.vms.map((v) => v.fingerprint));
    expect(second).toEqual(first);
  });

  it('only the AWS terminated instance is decommissioned', () => {
    const dec = allVms().filter((v) => v.vm.lifecycle === 'DECOMMISSIONED');
    expect(dec.map((d) => d.vm.name)).toEqual(['legacy-report-01']);
    expect(dec[0]?.vm).toMatchObject({ decommissionReason: 'PROVIDER_TERMINATED', powerState: 'UNKNOWN' });
  });

  it('memory and disk are always whole binary units (MiB / GiB) or null', () => {
    for (const { vm } of allVms()) {
      if (vm.memoryMb !== null) expect(Number.isInteger(vm.memoryMb) && vm.memoryMb >= 512).toBe(true);
      if (vm.diskGb !== null) expect(Number.isInteger(vm.diskGb)).toBe(true);
    }
  });

  it('power-state distribution across providers', () => {
    const count = (s: string) => allVms().filter((v) => v.vm.powerState === s).length;
    expect({
      RUNNING: count('RUNNING'),
      STOPPED: count('STOPPED'),
      SUSPENDED: count('SUSPENDED'),
      UNKNOWN: count('UNKNOWN'),
    }).toEqual({ RUNNING: 39, STOPPED: 13, SUSPENDED: 2, UNKNOWN: 4 }); // UNKNOWN: AWS terminated, Azure no instanceView, GCP REPAIRING, Proxmox offline node
  });
});
