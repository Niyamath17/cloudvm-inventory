/**
 * Normalization engine behaviour, independent of any provider:
 * skipped vs invalid vs valid, output validation, duplicate identities.
 */
import { describe, expect, it } from 'vitest';
import { normalizeBatch } from '../../../src/modules/normalization/normalizer.js';
import type { DraftVm, MapOutcome } from '../../../src/modules/normalization/types.js';
import type { CollectionBatch } from '../../../src/modules/providers/ProviderAdapter.js';

const draft = (over: Partial<DraftVm> = {}): DraftVm => ({
  provider: 'GCP',
  externalId: 'proj/1',
  nativeId: '1',
  account: 'proj',
  name: 'vm-1',
  hostname: null,
  ipAddresses: [],
  osName: null,
  cpuCores: 2,
  memoryMb: 4096,
  diskGb: 20,
  region: 'asia-south1',
  cluster: 'asia-south1-a',
  owner: null,
  tags: {},
  powerState: 'RUNNING',
  rawPowerState: 'RUNNING',
  lifecycle: 'ACTIVE',
  decommissionReason: null,
  rawData: {},
  ...over,
});

const batch = (records: MapOutcome[]): CollectionBatch<MapOutcome> => ({
  provider: 'GCP',
  dataSource: 'MOCK',
  sourceLabel: 'test',
  collectedAt: new Date('2026-10-30T10:00:00Z'),
  records,
  rejected: [{ ref: 'bad-raw', errors: ['raw shape invalid'] }],
});
const passThrough = (o: MapOutcome) => o;

describe('normalizeBatch', () => {
  it('stamps dataSource + discoveredAt and fingerprints valid VMs', () => {
    const r = normalizeBatch(batch([{ kind: 'vm', vm: draft(), warnings: [] }]), passThrough);
    expect(r.vms).toHaveLength(1);
    expect(r.vms[0]?.vm.dataSource).toBe('MOCK');
    expect(r.vms[0]?.vm.discoveredAt.toISOString()).toBe('2026-10-30T10:00:00.000Z');
    expect(r.vms[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('carries adapter-rejected raw records through as invalid[stage=raw]', () => {
    const r = normalizeBatch(batch([]), passThrough);
    expect(r.invalid).toEqual([{ ref: 'bad-raw', stage: 'raw', errors: ['raw shape invalid'] }]);
  });

  it('separates skipped records from invalid ones', () => {
    const r = normalizeBatch(
      batch([
        { kind: 'skipped', ref: 't-1', reason: 'template' },
        { kind: 'invalid', ref: 'x', errors: ['no id'] },
      ]),
      passThrough,
    );
    expect(r.skipped).toEqual([{ ref: 't-1', reason: 'template' }]);
    expect(r.invalid.filter((i) => i.stage === 'mapping')).toHaveLength(1);
  });

  it('rejects mapper output that violates the NormalizedVm schema', () => {
    const r = normalizeBatch(
      batch([
        { kind: 'vm', vm: draft({ cpuCores: -1 }), warnings: [] },
        { kind: 'vm', vm: draft({ externalId: 'proj/2', ipAddresses: ['999.1.1.1'] }), warnings: [] },
        { kind: 'vm', vm: draft({ externalId: 'proj/3', lifecycle: 'DECOMMISSIONED' }), warnings: [] }, // no reason
      ]),
      passThrough,
    );
    expect(r.vms).toHaveLength(0);
    expect(r.invalid.filter((i) => i.stage === 'validation')).toHaveLength(3);
  });

  it('keeps the first of two records with the same externalId', () => {
    const r = normalizeBatch(
      batch([
        { kind: 'vm', vm: draft({ name: 'first' }), warnings: [] },
        { kind: 'vm', vm: draft({ name: 'second' }), warnings: [] },
      ]),
      passThrough,
    );
    expect(r.vms.map((v) => v.vm.name)).toEqual(['first']);
    expect(r.invalid.find((i) => i.stage === 'duplicate')?.ref).toBe('proj/1');
  });

  it('turns a throwing mapper into an invalid record instead of crashing', () => {
    const r = normalizeBatch(batch([{ kind: 'vm', vm: draft(), warnings: [] }]), () => {
      throw new Error('boom');
    });
    expect(r.invalid.some((i) => i.stage === 'mapping' && i.errors[0] === 'boom')).toBe(true);
  });
});
