import { describe, expect, it } from 'vitest';
import { detectDrift, summarize, type LocalVm } from '../../../src/modules/drift/drift.engine.js';
import type { NbVm } from '../../../src/modules/netbox/NetBoxGateway.js';

const vm = (over: Partial<LocalVm> = {}): LocalVm => ({
  id: 'vm-1', provider: 'AWS', externalId: '123/ap-south-1/i-1', nativeId: 'i-1', account: '123', name: 'web-01',
  region: 'ap-south-1', cluster: 'ap-south-1a', cpuCores: 2, memoryMb: 4096, diskGb: 30, powerState: 'RUNNING', lifecycle: 'ACTIVE', ...over,
});
const rec = (over: Partial<NbVm> = {}): NbVm => ({
  id: 10, name: 'web-01', serial: 'aws:123/ap-south-1/i-1', status: 'active', cluster: 'AWS/ap-south-1a', vcpus: 2, memory: 4096, disk: 30 * 1024,
  description: null, comments: null, tags: [], ...over,
});

describe('detectDrift', () => {
  it('no findings when NetBox matches the inventory', () => {
    expect(detectDrift([vm()], [rec()])).toEqual([]);
  });

  it('MISSING_IN_NETBOX for an ACTIVE VM without a record', () => {
    expect(detectDrift([vm()], [])).toEqual([expect.objectContaining({ type: 'MISSING_IN_NETBOX', severity: 'WARNING', vmId: 'vm-1', expected: 'aws:123/ap-south-1/i-1' })]);
  });

  it('a DECOMMISSIONED VM that never existed in NetBox is not drift', () => {
    expect(detectDrift([vm({ lifecycle: 'DECOMMISSIONED', powerState: 'UNKNOWN' })], [])).toEqual([]);
  });

  it('ORPHAN_IN_NETBOX: managed serial -> WARNING, unmanaged/no serial -> INFO', () => {
    const f = detectDrift([], [rec({ id: 1, serial: 'gcp:p/9' }), rec({ id: 2, serial: null, name: 'manual-vm' }), rec({ id: 3, serial: 'ASSET-77' })]);
    expect(f.map((x) => [x.type, x.severity, x.remoteId])).toEqual([
      ['ORPHAN_IN_NETBOX', 'WARNING', 1],
      ['ORPHAN_IN_NETBOX', 'INFO', 2],
      ['ORPHAN_IN_NETBOX', 'INFO', 3],
    ]);
  });

  it('DUPLICATE (CRITICAL) when two records share the serial; no other checks for that VM', () => {
    const f = detectDrift([vm()], [rec({ id: 1 }), rec({ id: 2, memory: 1 })]);
    expect(f).toEqual([expect.objectContaining({ type: 'DUPLICATE', severity: 'CRITICAL', actual: '2 records (ids 1, 2)' })]);
  });

  it('POWER_STATE_MISMATCH: WARNING for running vs offline', () => {
    expect(detectDrift([vm()], [rec({ status: 'offline' })])).toEqual([expect.objectContaining({ type: 'POWER_STATE_MISMATCH', severity: 'WARNING', expected: 'active', actual: 'offline' })]);
  });

  it('POWER_STATE_MISMATCH: CRITICAL when lifecycle disagrees', () => {
    expect(detectDrift([vm({ lifecycle: 'DECOMMISSIONED', powerState: 'UNKNOWN' })], [rec()])[0]).toMatchObject({ severity: 'CRITICAL', expected: 'decommissioning', actual: 'active' });
    expect(detectDrift([vm()], [rec({ status: 'decommissioning' })])[0]).toMatchObject({ severity: 'CRITICAL' });
  });

  it('UNKNOWN power state is never compared', () => {
    expect(detectDrift([vm({ powerState: 'UNKNOWN' })], [rec({ status: 'offline' })])).toEqual([]);
  });

  it('RESOURCE_MISMATCH per field (disk compared in MB)', () => {
    const f = detectDrift([vm()], [rec({ vcpus: 4, memory: 2048, disk: 30_000 })]);
    expect(f.map((x) => [x.field, x.expected, x.actual])).toEqual([
      ['vcpus', '2', '4'],
      ['memory', '4096', '2048'],
      ['disk', '30720', '30000'],
    ]);
    expect(f.every((x) => x.type === 'RESOURCE_MISMATCH' && x.severity === 'WARNING')).toBe(true);
  });

  it('unknown local resources (null) are not compared', () => {
    expect(detectDrift([vm({ cpuCores: null, memoryMb: null, diskGb: null })], [rec({ vcpus: 8, memory: 1, disk: 1 })])).toEqual([]);
  });

  it('name / cluster differences are INFO; the disambiguated name is accepted', () => {
    expect(detectDrift([vm()], [rec({ name: 'web-01 (i-1)' })])).toEqual([]);
    const f = detectDrift([vm()], [rec({ name: 'renamed', cluster: 'AWS/other' })]);
    expect(f.map((x) => [x.field, x.severity])).toEqual([['name', 'INFO'], ['cluster', 'INFO']]);
  });

  it('a decommissioned VM correctly marked in NetBox is not drift (resources ignored)', () => {
    expect(detectDrift([vm({ lifecycle: 'DECOMMISSIONED', powerState: 'UNKNOWN' })], [rec({ status: 'decommissioning', memory: 1 })])).toEqual([]);
  });
});

describe('summarize', () => {
  it('counts by type and severity', () => {
    const f = detectDrift([vm(), vm({ id: 'vm-2', externalId: '123/ap-south-1/i-2', nativeId: 'i-2' })], [rec({ status: 'offline' }), rec({ id: 99, serial: 'aws:gone' })]);
    expect(summarize(f, 2, 2)).toEqual({
      totalItems: 3,
      byType: { MISSING_IN_NETBOX: 1, ORPHAN_IN_NETBOX: 1, RESOURCE_MISMATCH: 0, POWER_STATE_MISMATCH: 1, DUPLICATE: 0 },
      bySeverity: { INFO: 0, WARNING: 3, CRITICAL: 0 },
      comparedLocal: 2,
      comparedRemote: 2,
    });
  });
});
