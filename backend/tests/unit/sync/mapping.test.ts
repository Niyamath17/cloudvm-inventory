import { describe, expect, it } from 'vitest';
import { clusterFor, diffWrite, disambiguatedName, statusFor, toNetBoxWrite } from '../../../src/modules/netbox/mapping.js';
import type { NbVm } from '../../../src/modules/netbox/NetBoxGateway.js';

const vm = {
  provider: 'VMWARE' as const,
  externalId: 'vcsa01.corp.example.com/50000003-1a2b',
  nativeId: '50000003-1a2b',
  account: 'vcsa01.corp.example.com',
  name: 'app-server',
  hostname: 'app-server-b.corp.example.com',
  ipAddresses: ['172.16.10.22'],
  osName: 'RHEL 8',
  cpuCores: 4,
  memoryMb: 8192,
  diskGb: 160,
  region: null,
  cluster: 'Prod-Cluster-01',
  owner: 'erp-team',
  powerState: 'RUNNING' as const,
  lifecycle: 'ACTIVE' as const,
  dataSource: 'MOCK' as const,
};

describe('NetBox mapping', () => {
  it('maps to built-in NetBox VM fields only', () => {
    const w = toNetBoxWrite(vm);
    expect(w).toMatchObject({
      name: 'app-server',
      serial: 'vmware:vcsa01.corp.example.com/50000003-1a2b',
      cluster: 'VMWARE/Prod-Cluster-01',
      status: 'active',
      vcpus: 4,
      memory: 8192,
      disk: 160 * 1024, // GiB -> MB (NetBox >= 4.1)
      tags: ['cloudvm-managed', 'cloudvm-mock'],
    });
    expect(w.description).toMatch(/MOCK/);
    expect(w.comments).toContain('owner: erp-team');
    expect(w.comments).toContain('CloudVM (MOCK data)');
  });

  it('status: decommissioned / running / stopped / suspended, UNKNOWN not sent', () => {
    expect(statusFor({ lifecycle: 'DECOMMISSIONED', powerState: 'UNKNOWN' })).toBe('decommissioning');
    expect(statusFor({ lifecycle: 'ACTIVE', powerState: 'RUNNING' })).toBe('active');
    expect(statusFor({ lifecycle: 'ACTIVE', powerState: 'STOPPED' })).toBe('offline');
    expect(statusFor({ lifecycle: 'ACTIVE', powerState: 'SUSPENDED' })).toBe('offline');
    expect(statusFor({ lifecycle: 'ACTIVE', powerState: 'UNKNOWN' })).toBeUndefined();
    expect(toNetBoxWrite({ ...vm, powerState: 'UNKNOWN' })).not.toHaveProperty('status');
  });

  it('cluster falls back to region, then account', () => {
    expect(clusterFor({ provider: 'AWS', cluster: null, region: 'ap-south-1', account: 'a' }).name).toBe('AWS/ap-south-1');
    expect(clusterFor({ provider: 'PROXMOX', cluster: null, region: null, account: 'pve-dc1' }).name).toBe('PROXMOX/pve-dc1');
  });

  it('disk null stays null', () => {
    expect(toNetBoxWrite({ ...vm, diskGb: null }).disk).toBeNull();
  });

  const remoteOf = (over: Partial<NbVm> = {}): NbVm => {
    const w = toNetBoxWrite(vm);
    return { id: 7, name: w.name, serial: w.serial, status: w.status ?? null, cluster: w.cluster, vcpus: w.vcpus, memory: w.memory, disk: w.disk, description: w.description, comments: w.comments, tags: [...w.tags].reverse(), ...over };
  };

  it('diff is empty when NetBox already matches (tag order ignored)', () => {
    expect(diffWrite(toNetBoxWrite(vm), remoteOf(), vm).patch).toEqual({});
  });

  it('diff contains only changed fields, with from/to', () => {
    const { patch, diff } = diffWrite(toNetBoxWrite(vm), remoteOf({ memory: 4096, status: 'offline' }), vm);
    expect(patch).toEqual({ memory: 8192, status: 'active' });
    expect(diff).toEqual({ memory: { from: 4096, to: 8192 }, status: { from: 'offline', to: 'active' } });
  });

  it('the disambiguated name is not "renamed back" every run', () => {
    expect(disambiguatedName(vm)).toBe('app-server (50000003)');
    expect(diffWrite(toNetBoxWrite(vm), remoteOf({ name: 'app-server (50000003)' }), vm).patch).toEqual({});
  });

  it('fields the backend cannot store are never diffed', () => {
    expect(diffWrite(toNetBoxWrite(vm), remoteOf({ comments: null }), vm, ['comments']).patch).toEqual({});
  });
});
