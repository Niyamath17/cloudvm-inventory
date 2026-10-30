import { beforeAll, describe, expect, it } from 'vitest';
import { PROXMOX_SAMPLE_FILE, ProxmoxMockAdapter } from '../../../src/modules/providers/mock/proxmox.mock-adapter.js';
import { mapProxmoxVm } from '../../../src/modules/normalization/mappers/proxmox.mapper.js';
import { normalizeBatch } from '../../../src/modules/normalization/normalizer.js';
import type { NormalizationResult } from '../../../src/modules/normalization/types.js';
import { byName, tamperedSample } from './fixtures.js';

let r: NormalizationResult;
beforeAll(async () => {
  r = normalizeBatch(await new ProxmoxMockAdapter().collect(), mapProxmoxVm);
});

describe('Proxmox MOCK adapter + mapper', () => {
  it('11 entries -> 9 VMs, 2 skipped (template + LXC), 0 invalid', () => {
    expect(r).toMatchObject({ provider: 'PROXMOX', dataSource: 'MOCK' });
    expect(r.vms).toHaveLength(9);
    expect(r.invalid).toEqual([]);
    expect(r.skipped).toHaveLength(2);
  });

  it('skips the template and the LXC container with clear reasons', () => {
    expect(r.skipped).toEqual(
      expect.arrayContaining([
        { ref: 'pve-dc1/9000 (ubuntu-2204-template)', reason: expect.stringMatching(/template/) },
        { ref: 'pve-dc1/210 (nginx-lxc-01)', reason: expect.stringMatching(/LXC container/) },
      ]),
    );
    expect(r.vms.some((v) => v.vm.name === 'nginx-lxc-01' || v.vm.name === 'ubuntu-2204-template')).toBe(false);
  });

  it('VMID 100 in two clusters -> two distinct VMs', () => {
    expect(byName(r, 'dns-01').vm.externalId).toBe('pve-dc1/100');
    expect(byName(r, 'lab-k8s-master').vm.externalId).toBe('pve-lab/100');
  });

  it('converts bytes: maxmem -> MiB, maxdisk -> GiB', () => {
    expect(byName(r, 'gitlab-01').vm).toMatchObject({ cpuCores: 8, memoryMb: 16384, diskGb: 500 });
    expect(byName(r, 'dns-01').vm).toMatchObject({ memoryMb: 2048, diskGb: 32 });
  });

  it('parses ";"-separated tags and the owner-<team> convention', () => {
    expect(byName(r, 'gitlab-01').vm).toMatchObject({
      owner: 'devops',
      tags: { prod: 'true', devtools: 'true', owner: 'devops' },
    });
    expect(byName(r, 'lab-win-test').vm).toMatchObject({ owner: null, tags: {} });
  });

  it('guest agent: hostname + IPs, IPv6 link-local dropped with a warning', () => {
    const dns = byName(r, 'dns-01');
    expect(dns.vm).toMatchObject({ hostname: 'dns-01.dc1.example.internal', ipAddresses: ['10.80.1.10'] });
    expect(dns.warnings.join()).toMatch(/link-local/);
    expect(byName(r, 'old-crm-01').vm).toMatchObject({ hostname: null, ipAddresses: [] });
  });

  it('status "unknown" (offline node) -> UNKNOWN; ostype -> readable OS', () => {
    expect(byName(r, 'build-agent-01').vm.powerState).toBe('UNKNOWN');
    expect(byName(r, 'file-srv-01').vm.osName).toBe('Windows 11 / Server 2022');
    expect(byName(r, 'old-crm-01').vm.osName).toBeNull();
    expect(byName(r, 'dns-01').vm.region).toBeNull();
  });

  it('rejects a malformed resource and a nameless cluster block without losing the rest', async () => {
    const dir = await tamperedSample(PROXMOX_SAMPLE_FILE, (j) => {
      j.clusters[0].data[1].maxmem = 'sixteen gigs'; // gitlab-01
      delete j.clusters[1].cluster; // all 3 pve-lab entries lose their identity scope
    });
    const t = normalizeBatch(await new ProxmoxMockAdapter(dir).collect(), mapProxmoxVm);
    expect(t.vms).toHaveLength(5);
    expect(t.skipped).toHaveLength(2);
    expect(t.invalid).toHaveLength(4);
    expect(t.invalid.every((i) => i.stage === 'raw')).toBe(true);
  });
});
