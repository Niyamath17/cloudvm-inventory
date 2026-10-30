import { beforeAll, describe, expect, it } from 'vitest';
import { VMWARE_SAMPLE_FILE, VmwareMockAdapter } from '../../../src/modules/providers/mock/vmware.mock-adapter.js';
import { mapVmwareVm } from '../../../src/modules/normalization/mappers/vmware.mapper.js';
import { normalizeBatch } from '../../../src/modules/normalization/normalizer.js';
import type { NormalizationResult } from '../../../src/modules/normalization/types.js';
import { byName, tamperedSample } from './fixtures.js';

let r: NormalizationResult;
beforeAll(async () => {
  r = normalizeBatch(await new VmwareMockAdapter().collect(), mapVmwareVm);
});

describe('VMware MOCK adapter + mapper', () => {
  it('normalizes all 11 VMs, labelled MOCK, none invalid', () => {
    expect(r).toMatchObject({ provider: 'VMWARE', dataSource: 'MOCK' });
    expect(r.vms).toHaveLength(11);
    expect(r.invalid).toEqual([]);
  });

  it('two VMs both named "app-server" are two VMs (identity is the instance UUID, not the name)', () => {
    const apps = r.vms.filter((v) => v.vm.name === 'app-server');
    expect(apps).toHaveLength(2);
    expect(new Set(apps.map((a) => a.vm.externalId)).size).toBe(2);
    expect(apps[0]?.vm.externalId).toMatch(/^vcsa01\.corp\.example\.com\/5000000[23]-/);
  });

  it('memory MiB as is; disk capacity bytes -> GiB summed', () => {
    expect(byName(r, 'oracle-db-01').vm).toMatchObject({ cpuCores: 8, memoryMb: 65536, diskGb: 100 + 2048 });
  });

  it('powered-off / no VMware Tools -> no hostname or IP, with a warning', () => {
    const p = byName(r, 'print-srv-01');
    expect(p.vm).toMatchObject({ powerState: 'STOPPED', hostname: null, ipAddresses: [] });
    expect(p.warnings.join()).toMatch(/VMware Tools/);
    expect(byName(r, 'backup-proxy-01').vm).toMatchObject({ powerState: 'RUNNING', hostname: null });
  });

  it('SUSPENDED -> SUSPENDED; OS from guest identity, else configured guest_OS', () => {
    expect(byName(r, 'dev-db-01').vm.powerState).toBe('SUSPENDED');
    expect(byName(r, 'web-01').vm.osName).toBe('Ubuntu Linux (64-bit)');
    expect(byName(r, 'print-srv-01').vm.osName).toBe('WINDOWS_2019SERVER_64');
  });

  it('tags from category/name; owner from the Owner category; none -> null', () => {
    expect(byName(r, 'web-01').vm).toMatchObject({ owner: 'web-team', tags: { Owner: 'web-team', Environment: 'prod' } });
    expect(byName(r, 'qa-selenium-01').vm).toMatchObject({ owner: null, tags: {} });
    expect(byName(r, 'web-01').vm.cluster).toBe('Prod-Cluster-01');
  });

  it('rejects a malformed VM without losing the others', async () => {
    const dir = await tamperedSample(VMWARE_SAMPLE_FILE, (j) => {
      j.vms[3].summary.power_state = 'HALF_ON';
    });
    const t = normalizeBatch(await new VmwareMockAdapter(dir).collect(), mapVmwareVm);
    expect(t.vms).toHaveLength(10);
    expect(t.invalid).toEqual([expect.objectContaining({ ref: 'oracle-db-01', stage: 'raw' })]);
  });

  it('refuses the whole file when the vCenter host (identity scope) is missing', async () => {
    const dir = await tamperedSample(VMWARE_SAMPLE_FILE, (j) => {
      delete j.vcenter;
    });
    await expect(new VmwareMockAdapter(dir).collect()).rejects.toThrow(/vcenter/);
  });

  it('a VM listed twice is kept once (duplicate identity in one batch)', async () => {
    const dir = await tamperedSample(VMWARE_SAMPLE_FILE, (j) => {
      j.vms.push(structuredClone(j.vms[0]));
    });
    const t = normalizeBatch(await new VmwareMockAdapter(dir).collect(), mapVmwareVm);
    expect(t.vms).toHaveLength(11);
    expect(t.invalid).toEqual([expect.objectContaining({ stage: 'duplicate', ref: expect.stringMatching(/50000001/) })]);
  });
});
