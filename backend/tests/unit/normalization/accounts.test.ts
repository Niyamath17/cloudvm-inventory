/**
 * Every MOCK adapter reports the accounts it queried – including empty and failed ones.
 */
import { describe, expect, it } from 'vitest';
import { createMockProviders } from '../../../src/modules/providers/registry.js';
import { AWS_SAMPLE_FILE, AwsMockAdapter } from '../../../src/modules/providers/mock/aws.mock-adapter.js';
import { AZURE_SAMPLE_FILE, AzureMockAdapter } from '../../../src/modules/providers/mock/azure.mock-adapter.js';
import { GCP_SAMPLE_FILE, GcpMockAdapter } from '../../../src/modules/providers/mock/gcp.mock-adapter.js';
import { PROXMOX_SAMPLE_FILE, ProxmoxMockAdapter } from '../../../src/modules/providers/mock/proxmox.mock-adapter.js';
import { VMWARE_SAMPLE_FILE, VmwareMockAdapter } from '../../../src/modules/providers/mock/vmware.mock-adapter.js';
import { tamperedSample } from './fixtures.js';

describe('queried-account outcomes', () => {
  it('default sample files: one COMPLETE account per provider, two Proxmox clusters', async () => {
    const results = await Promise.all(createMockProviders().map((p) => p.collectAndNormalize()));
    expect(Object.fromEntries(results.map((r) => [r.provider, r.accounts]))).toEqual({
      AWS: [{ account: '123456789012', status: 'COMPLETE' }],
      AZURE: [{ account: '00000000-aaaa-4bbb-8ccc-000000000001', status: 'COMPLETE' }],
      GCP: [{ account: 'cloudvm-demo-project', status: 'COMPLETE' }],
      PROXMOX: [
        { account: 'pve-dc1', status: 'COMPLETE' },
        { account: 'pve-lab', status: 'COMPLETE' },
      ],
      VMWARE: [{ account: 'vcsa01.corp.example.com', status: 'COMPLETE' }],
    });
  });

  it('an account with zero VMs is still reported COMPLETE (all five providers)', async () => {
    const batches = await Promise.all([
      new AwsMockAdapter(await tamperedSample(AWS_SAMPLE_FILE, (j) => (j.Reservations = []))).collect(),
      new AzureMockAdapter(await tamperedSample(AZURE_SAMPLE_FILE, (j) => (j.value = []))).collect(),
      new GcpMockAdapter(await tamperedSample(GCP_SAMPLE_FILE, (j) => (j.items = {}))).collect(),
      new ProxmoxMockAdapter(await tamperedSample(PROXMOX_SAMPLE_FILE, (j) => (j.clusters[1].data = []))).collect(),
      new VmwareMockAdapter(await tamperedSample(VMWARE_SAMPLE_FILE, (j) => (j.vms = []))).collect(),
    ]);
    for (const b of batches) {
      expect(b.accounts.length).toBeGreaterThan(0);
      expect(b.accounts.every((a) => a.status === 'COMPLETE')).toBe(true);
    }
    expect(batches[0]?.records).toHaveLength(0);
    expect(batches[3]?.accounts.find((a) => a.account === 'pve-lab')).toEqual({ account: 'pve-lab', status: 'COMPLETE' });
  });

  it('a failed account is reported FAILED and none of its records are returned', async () => {
    const aws = await new AwsMockAdapter(await tamperedSample(AWS_SAMPLE_FILE, (j) => (j.accounts[0].error = 'AccessDenied (simulated)'))).collect();
    expect(aws.accounts).toEqual([{ account: '123456789012', status: 'FAILED', error: 'AccessDenied (simulated)' }]);
    expect(aws.records).toHaveLength(0);

    const pve = await new ProxmoxMockAdapter(await tamperedSample(PROXMOX_SAMPLE_FILE, (j) => (j.clusters[1].error = 'connection timed out'))).collect();
    expect(pve.accounts).toEqual([
      { account: 'pve-dc1', status: 'COMPLETE' },
      { account: 'pve-lab', status: 'FAILED', error: 'connection timed out' },
    ]);
    expect(pve.records.every((r) => r.cluster === 'pve-dc1')).toBe(true);

    const vmw = await new VmwareMockAdapter(await tamperedSample(VMWARE_SAMPLE_FILE, (j) => (j.error = '503 vCenter unavailable'))).collect();
    expect(vmw).toMatchObject({ records: [], accounts: [{ account: 'vcsa01.corp.example.com', status: 'FAILED' }] });
  });

  it('a declared extra account with no data is reported COMPLETE (queried, empty)', async () => {
    const dir = await tamperedSample(GCP_SAMPLE_FILE, (j) => j.accounts.push({ id: 'empty-project' }));
    const gcp = await new GcpMockAdapter(dir).collect();
    expect(gcp.accounts.map((a) => a.account)).toEqual(['cloudvm-demo-project', 'empty-project']);
  });

  it('rejected raw records carry their account when it can be determined', async () => {
    const dir = await tamperedSample(PROXMOX_SAMPLE_FILE, (j) => (j.clusters[1].data[0].maxmem = 'lots'));
    const pve = await new ProxmoxMockAdapter(dir).collect();
    expect(pve.rejected).toEqual([expect.objectContaining({ account: 'pve-lab' })]);
  });
});
