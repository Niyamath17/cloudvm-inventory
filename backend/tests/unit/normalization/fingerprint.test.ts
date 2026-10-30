import { describe, expect, it } from 'vitest';
import type { NormalizedVm } from '../../../src/domain/normalized-vm.js';
import { fingerprint } from '../../../src/modules/normalization/fingerprint.js';

const base: NormalizedVm = {
  provider: 'AWS',
  externalId: '123456789012/ap-south-1/i-1',
  nativeId: 'i-1',
  account: '123456789012',
  name: 'web-01',
  hostname: 'web-01.internal',
  ipAddresses: ['10.0.0.1', '10.0.0.2'],
  osName: 'Linux/UNIX',
  cpuCores: 2,
  memoryMb: 4096,
  diskGb: 30,
  region: 'ap-south-1',
  cluster: 'ap-south-1a',
  owner: 'web-team',
  tags: { env: 'prod', app: 'shop' },
  powerState: 'RUNNING',
  rawPowerState: 'running',
  lifecycle: 'ACTIVE',
  decommissionReason: null,
  dataSource: 'MOCK',
  discoveredAt: new Date('2026-10-30T10:00:00Z'),
  rawData: { uptime: 1 },
};

describe('fingerprint', () => {
  it('is a stable SHA-256 hex string', () => {
    expect(fingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint(base)).toBe(fingerprint({ ...base }));
  });

  it('ignores ordering of IPs and tags', () => {
    expect(fingerprint({ ...base, ipAddresses: ['10.0.0.2', '10.0.0.1'], tags: { app: 'shop', env: 'prod' } })).toBe(fingerprint(base));
  });

  it('ignores discovery time, raw payload, raw power word and data source', () => {
    expect(
      fingerprint({ ...base, discoveredAt: new Date(), rawData: { uptime: 999 }, rawPowerState: 'pending', dataSource: 'LIVE' }),
    ).toBe(fingerprint(base));
  });

  it.each([
    ['memoryMb', { memoryMb: 8192 }],
    ['cpuCores', { cpuCores: 4 }],
    ['powerState', { powerState: 'STOPPED' as const }],
    ['owner', { owner: 'other' }],
    ['tags', { tags: { env: 'dev', app: 'shop' } }],
    ['ipAddresses', { ipAddresses: ['10.0.0.1'] }],
    ['hostname', { hostname: null }],
  ])('changes when %s changes', (_field, patch) => {
    expect(fingerprint({ ...base, ...patch })).not.toBe(fingerprint(base));
  });
});
