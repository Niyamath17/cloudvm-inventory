import { beforeAll, describe, expect, it } from 'vitest';
import { AZURE_SAMPLE_FILE, AzureMockAdapter } from '../../../src/modules/providers/mock/azure.mock-adapter.js';
import { mapAzureVm } from '../../../src/modules/normalization/mappers/azure.mapper.js';
import { normalizeBatch } from '../../../src/modules/normalization/normalizer.js';
import type { NormalizationResult } from '../../../src/modules/normalization/types.js';
import { byName, tamperedSample } from './fixtures.js';

let r: NormalizationResult;
beforeAll(async () => {
  r = normalizeBatch(await new AzureMockAdapter().collect(), mapAzureVm);
});

describe('Azure MOCK adapter + mapper', () => {
  it('normalizes all 12 VMs, labelled MOCK, none invalid', () => {
    expect(r).toMatchObject({ provider: 'AZURE', dataSource: 'MOCK' });
    expect(r.vms).toHaveLength(12);
    expect(r.invalid).toEqual([]);
  });

  it('identity = <subscriptionId>/<vmId>; cluster = resource group; region = location', () => {
    expect(byName(r, 'crm-db-01').vm).toMatchObject({
      externalId: '00000000-aaaa-4bbb-8ccc-000000000001/6f1c9a3e-0000-4000-8000-000000000003',
      account: '00000000-aaaa-4bbb-8ccc-000000000001',
      region: 'centralindia',
      cluster: 'rg-crm-prod',
    });
  });

  it('memoryInMB is binary MiB, kept as is; disk = OS disk + data disks', () => {
    expect(byName(r, 'crm-db-01').vm).toMatchObject({ cpuCores: 2, memoryMb: 16384, diskGb: 64 + 512 + 512 });
    expect(byName(r, 'vpn-gw-vm-01').vm.memoryMb).toBe(4096); // Standard_B2s = 4 GiB
  });

  it('maps PowerState/deallocated and /stopped to STOPPED, /starting to RUNNING', () => {
    expect(byName(r, 'hr-portal-02').vm).toMatchObject({ powerState: 'STOPPED', rawPowerState: 'PowerState/deallocated', lifecycle: 'ACTIVE' });
    expect(byName(r, 'etl-runner-01').vm.powerState).toBe('STOPPED');
    expect(byName(r, 'test-agent-01').vm.powerState).toBe('RUNNING');
  });

  it('missing instanceView -> UNKNOWN power with a warning', () => {
    const rec = byName(r, 'img-builder-01');
    expect(rec.vm).toMatchObject({ powerState: 'UNKNOWN', rawPowerState: null });
    expect(rec.warnings.join()).toMatch(/power state unknown/);
  });

  it('missing osProfile -> hostname null with a warning; Windows computerName kept as reported', () => {
    expect(byName(r, 'test-agent-02').vm.hostname).toBeNull();
    expect(byName(r, 'test-agent-02').warnings.join()).toMatch(/hostname unknown/);
    expect(byName(r, 'hr-portal-01').vm.hostname).toBe('HRPORTAL01');
  });

  it('owner from "owner" or "Owner"; null when absent; IP from the NIC', () => {
    expect(byName(r, 'crm-app-01').vm.owner).toBe('sales-it');
    expect(byName(r, 'crm-db-01').vm.owner).toBe('dba-team');
    expect(byName(r, 'test-agent-01').vm.owner).toBeNull();
    expect(byName(r, 'crm-app-01').vm.ipAddresses).toEqual(['10.40.1.10']);
  });

  it('builds a readable OS name from osType + image reference', () => {
    expect(byName(r, 'crm-app-01').vm.osName).toBe('Linux (Canonical 0001-com-ubuntu-server-jammy 22_04-lts-gen2)');
  });

  it('rejects a malformed VM without losing the others', async () => {
    const dir = await tamperedSample(AZURE_SAMPLE_FILE, (j) => {
      j.value[0].properties.vmId = 'not-a-guid';
      j.value[1].id = '/bogus/path';
    });
    const t = normalizeBatch(await new AzureMockAdapter(dir).collect(), mapAzureVm);
    expect(t.vms).toHaveLength(10);
    expect(t.invalid.map((i) => i.ref).sort()).toEqual(['crm-app-01', 'crm-app-02']);
  });
});
