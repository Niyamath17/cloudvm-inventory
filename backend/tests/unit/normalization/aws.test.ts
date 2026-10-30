/**
 * AWS MOCK adapter + mapper, run end-to-end over the real 14-instance sample file.
 */
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { AWS_SAMPLE_FILE, AwsMockAdapter, type AwsRawVm } from '../../../src/modules/providers/mock/aws.mock-adapter.js';
import { DEFAULT_SAMPLE_DIR } from '../../../src/modules/providers/mock/sample-file.js';
import { mapAwsVm } from '../../../src/modules/normalization/mappers/aws.mapper.js';
import { normalizeBatch } from '../../../src/modules/normalization/normalizer.js';
import type { NormalizationResult } from '../../../src/modules/normalization/types.js';

let result: NormalizationResult;
const byNative = (id: string) => {
  const r = result.vms.find((v) => v.vm.nativeId === id);
  if (!r) throw new Error(`VM ${id} not found`);
  return r;
};

beforeAll(async () => {
  result = normalizeBatch(await new AwsMockAdapter().collect(), mapAwsVm);
});

describe('AWS MOCK adapter', () => {
  it('labels the batch as MOCK and collects all 14 instances', () => {
    expect(result.dataSource).toBe('MOCK');
    expect(result.sourceLabel).toMatch(/^MOCK sample file/);
    expect(result.vms).toHaveLength(14);
    expect(result.invalid).toEqual([]);
    expect(result.vms.every((r) => r.vm.dataSource === 'MOCK')).toBe(true);
  });

  it('refuses a sample file that is not labelled MOCK', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cloudvm-'));
    const json = JSON.parse(await readFile(join(DEFAULT_SAMPLE_DIR, AWS_SAMPLE_FILE), 'utf8'));
    json._meta.mock = false;
    await writeFile(join(dir, AWS_SAMPLE_FILE), JSON.stringify(json));
    await expect(new AwsMockAdapter(dir).collect()).rejects.toThrow(/not labelled as MOCK/);
  });

  it('rejects malformed instances individually without failing the batch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cloudvm-'));
    await cp(join(DEFAULT_SAMPLE_DIR, AWS_SAMPLE_FILE), join(dir, AWS_SAMPLE_FILE));
    const json = JSON.parse(await readFile(join(dir, AWS_SAMPLE_FILE), 'utf8'));
    json.Reservations[0].Instances[0].InstanceId = 'not-an-instance-id';
    delete json.Reservations[1].OwnerId;
    await writeFile(join(dir, AWS_SAMPLE_FILE), JSON.stringify(json));

    const r = normalizeBatch(await new AwsMockAdapter(dir).collect(), mapAwsVm);
    expect(r.vms).toHaveLength(12);
    expect(r.invalid).toHaveLength(2);
    expect(r.invalid.every((i) => i.stage === 'raw')).toBe(true);
    expect(r.invalid.map((i) => i.errors.join(' '))).toEqual(
      expect.arrayContaining([expect.stringMatching(/InstanceId/), expect.stringMatching(/OwnerId/)]),
    );
  });
});

describe('AWS mapper', () => {
  it('builds the fully scoped identity', () => {
    const vm = byNative('i-0a1b2c3d4e5f60001').vm;
    expect(vm).toMatchObject({
      externalId: '123456789012/ap-south-1/i-0a1b2c3d4e5f60001',
      account: '123456789012',
      region: 'ap-south-1',
      cluster: 'ap-south-1a',
      name: 'web-01',
    });
  });

  it('takes memory (MiB) and vCPUs from the instance type, sums EBS volumes', () => {
    const vm = byNative('i-0a1b2c3d4e5f60004').vm; // m5.xlarge, volumes 80 + 200
    expect(vm).toMatchObject({ cpuCores: 4, memoryMb: 16384, diskGb: 280 });
  });

  it('falls back to the instance ID when there is no Name tag', () => {
    const r = byNative('i-0a1b2c3d4e5f60010');
    expect(r.vm.name).toBe('i-0a1b2c3d4e5f60010');
    expect(r.warnings.join()).toMatch(/no Name tag/);
  });

  it('reads owner from Owner / owner / CreatedBy, and null when absent', () => {
    expect(byNative('i-0a1b2c3d4e5f60001').vm.owner).toBe('web-team'); // Owner
    expect(byNative('i-0a1b2c3d4e5f60003').vm.owner).toBe('platform-team'); // owner
    expect(byNative('i-0a1b2c3d4e5f60006').vm.owner).toBe('data-eng'); // CreatedBy
    expect(byNative('i-0a1b2c3d4e5f60010').vm.owner).toBeNull();
  });

  it('keeps Name out of tags and keeps the other tags', () => {
    const vm = byNative('i-0a1b2c3d4e5f60004').vm;
    expect(vm.tags).toEqual({ Environment: 'prod', Owner: 'payments', PCI: 'true' });
  });

  it('maps terminated to DECOMMISSIONED / PROVIDER_TERMINATED, never STOPPED', () => {
    const vm = byNative('i-0a1b2c3d4e5f60012').vm;
    expect(vm).toMatchObject({
      lifecycle: 'DECOMMISSIONED',
      decommissionReason: 'PROVIDER_TERMINATED',
      powerState: 'UNKNOWN',
      rawPowerState: 'terminated',
      hostname: null,
      ipAddresses: [],
      diskGb: null,
    });
  });

  it('maps stopped / stopping / pending as ACTIVE VMs', () => {
    expect(byNative('i-0a1b2c3d4e5f60005').vm).toMatchObject({ lifecycle: 'ACTIVE', powerState: 'STOPPED' });
    expect(byNative('i-0a1b2c3d4e5f60007').vm).toMatchObject({ lifecycle: 'ACTIVE', powerState: 'STOPPED', rawPowerState: 'stopping' });
    expect(byNative('i-0a1b2c3d4e5f60011').vm).toMatchObject({ lifecycle: 'ACTIVE', powerState: 'RUNNING', rawPowerState: 'pending' });
  });

  it('collects private + public IPs and the private DNS hostname', () => {
    const vm = byNative('i-0a1b2c3d4e5f60001').vm;
    expect(vm.ipAddresses).toEqual(['10.10.1.11', '13.233.10.21']);
    expect(vm.hostname).toBe('ip-10-10-1-11.ap-south-1.compute.internal');
  });

  it('is deterministic: two collections produce identical fingerprints', async () => {
    const again = normalizeBatch(await new AwsMockAdapter().collect(), mapAwsVm);
    expect(again.vms.map((r) => r.fingerprint)).toEqual(result.vms.map((r) => r.fingerprint));
    expect(new Set(result.vms.map((r) => r.fingerprint)).size).toBe(14);
  });

  it('marks a record invalid when the AZ cannot give a region', () => {
    const raw = byNative('i-0a1b2c3d4e5f60001').vm.rawData as AwsRawVm;
    const broken: AwsRawVm = { ...raw, instance: { ...raw.instance, Placement: { AvailabilityZone: 'nowhere' } } };
    expect(mapAwsVm(broken)).toMatchObject({ kind: 'invalid', errors: [expect.stringMatching(/region/)] });
  });

  it('warns (not fails) when the instance type is unknown', () => {
    const raw = byNative('i-0a1b2c3d4e5f60001').vm.rawData as AwsRawVm;
    const out = mapAwsVm({ ...raw, instanceType: null });
    expect(out.kind).toBe('vm');
    if (out.kind === 'vm') {
      expect(out.vm.memoryMb).toBeNull();
      expect(out.warnings.join()).toMatch(/not found/);
    }
  });
});
