import { beforeAll, describe, expect, it } from 'vitest';
import { GCP_SAMPLE_FILE, GcpMockAdapter, type GcpRawVm } from '../../../src/modules/providers/mock/gcp.mock-adapter.js';
import { mapGcpVm } from '../../../src/modules/normalization/mappers/gcp.mapper.js';
import { normalizeBatch } from '../../../src/modules/normalization/normalizer.js';
import type { NormalizationResult } from '../../../src/modules/normalization/types.js';
import { byName, tamperedSample } from './fixtures.js';

let r: NormalizationResult;
beforeAll(async () => {
  r = normalizeBatch(await new GcpMockAdapter().collect(), mapGcpVm);
});

describe('GCP MOCK adapter + mapper', () => {
  it('normalizes all 12 instances across zones, labelled MOCK, none invalid', () => {
    expect(r).toMatchObject({ provider: 'GCP', dataSource: 'MOCK' });
    expect(r.vms).toHaveLength(12);
    expect(r.invalid).toEqual([]);
  });

  it('identity = <projectId>/<instanceId>; region from zone', () => {
    expect(byName(r, 'ml-train-01').vm).toMatchObject({
      externalId: 'cloudvm-demo-project/4417300000000000001',
      account: 'cloudvm-demo-project',
      region: 'asia-south1',
      cluster: 'asia-south1-a',
    });
  });

  it('TERMINATED means STOPPED (still exists), not decommissioned', () => {
    expect(byName(r, 'ml-train-02').vm).toMatchObject({ lifecycle: 'ACTIVE', powerState: 'STOPPED', rawPowerState: 'TERMINATED' });
  });

  it('maps SUSPENDED, STAGING and REPAIRING (-> UNKNOWN)', () => {
    expect(byName(r, 'dev-notebook-01').vm.powerState).toBe('SUSPENDED');
    expect(byName(r, 'analytics-db-02').vm.powerState).toBe('RUNNING');
    expect(byName(r, 'web-eu-02').vm.powerState).toBe('UNKNOWN');
  });

  it('decodes a custom machine type name: custom-6-23040 = 6 vCPU / 23040 MiB', () => {
    expect(byName(r, 'ml-inference-01').vm).toMatchObject({ cpuCores: 6, memoryMb: 23040 });
  });

  it('sums diskSizeGb strings', () => {
    expect(byName(r, 'ml-train-01').vm.diskGb).toBe(1200);
  });

  it('hostname only when set; otherwise null + warning (never invented from the name)', () => {
    expect(byName(r, 'ml-inference-01').vm.hostname).toBe('inference-01.ml.example.internal');
    expect(byName(r, 'ml-train-01').vm.hostname).toBeNull();
    expect(byName(r, 'ml-train-01').warnings.join()).toMatch(/hostname unknown/);
  });

  it('OS from boot disk license; internal + NAT IPs; owner label', () => {
    expect(byName(r, 'win-jumpbox-01').vm).toMatchObject({
      osName: 'windows-server-2022-dc',
      ipAddresses: ['10.60.2.10', '35.192.1.10'],
      owner: 'it-ops',
    });
    expect(byName(r, 'old-etl-01').vm.owner).toBeNull();
  });

  it('unknown non-custom machine type -> CPU/memory null with a warning', () => {
    const raw = byName(r, 'ml-train-01').vm.rawData as GcpRawVm;
    const out = mapGcpVm({ ...raw, machineType: null });
    expect(out).toMatchObject({ kind: 'vm', vm: { cpuCores: null, memoryMb: null } });
  });

  it('rejects a malformed instance without losing the others', async () => {
    const dir = await tamperedSample(GCP_SAMPLE_FILE, (j) => {
      j.items['zones/asia-south1-a'].instances[0].disks[0].diskSizeGb = 'lots';
    });
    const t = normalizeBatch(await new GcpMockAdapter(dir).collect(), mapGcpVm);
    expect(t.vms).toHaveLength(11);
    expect(t.invalid).toEqual([expect.objectContaining({ ref: 'ml-train-01', stage: 'raw' })]);
  });
});
