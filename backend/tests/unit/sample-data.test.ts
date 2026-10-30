/**
 * M1 – MOCK sample data validation.
 *
 * Proves that each provider-shaped sample file:
 *   - is explicitly labelled as MOCK,
 *   - matches its raw provider schema (the same schemas M2 adapters will use),
 *   - has stable, unique provider identifiers,
 *   - contains the deliberate edge cases the normalizer must handle,
 *   - contains nothing that looks like a real credential.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  awsSampleSchema,
  azureSampleSchema,
  gcpSampleSchema,
  proxmoxSampleSchema,
  sampleFiles,
  vmwareSampleSchema,
} from '../../src/modules/providers/raw/index.js';
import { buildIdentity } from '../../src/domain/identity.js';

const dir = join(import.meta.dirname, '../../sample-data');
const readRaw = (file: string): string => readFileSync(join(dir, file), 'utf8');
const readJson = (file: string): unknown => JSON.parse(readRaw(file));

const aws = awsSampleSchema.parse(readJson(sampleFiles.AWS.file));
const azure = azureSampleSchema.parse(readJson(sampleFiles.AZURE.file));
const gcp = gcpSampleSchema.parse(readJson(sampleFiles.GCP.file));
const proxmox = proxmoxSampleSchema.parse(readJson(sampleFiles.PROXMOX.file));
const vmware = vmwareSampleSchema.parse(readJson(sampleFiles.VMWARE.file));

const awsInstances = aws.Reservations.flatMap((r) => r.Instances);
const gcpInstances = Object.values(gcp.items).flatMap((z) => z.instances);
const proxmoxEntries = proxmox.clusters.flatMap((c) => c.data.map((d) => ({ ...d, cluster: c.cluster })));

describe('sample files: labelling and schema', () => {
  it.each(Object.entries(sampleFiles))('%s file is valid and labelled MOCK', (provider, { file, schema }) => {
    const parsed = schema.safeParse(readJson(file));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2)).toBe(true);
    if (parsed.success) {
      expect(parsed.data._meta.mock).toBe(true);
      expect(parsed.data._meta.provider).toBe(provider);
      expect(parsed.data._meta.label).toMatch(/^MOCK DATA/);
      expect(parsed.data._meta.edgeCases.length).toBeGreaterThan(0);
    }
  });

  it('rejects a file that is not marked as mock', () => {
    const tampered = readJson(sampleFiles.AWS.file) as { _meta: { mock: boolean } };
    tampered._meta.mock = false;
    expect(awsSampleSchema.safeParse(tampered).success).toBe(false);
  });

  it('contains roughly 60 VM entries in total', () => {
    const total = awsInstances.length + azure.value.length + gcpInstances.length + proxmoxEntries.length + vmware.vms.length;
    expect(total).toBe(60);
  });

  it('contains no credential-like values', () => {
    const credentialPatterns = [/AKIA[0-9A-Z]{16}/, /BEGIN [A-Z ]*PRIVATE KEY/, /"(password|secret|token|apiKey|clientSecret)"\s*:/i];
    for (const { file } of Object.values(sampleFiles)) {
      const text = readRaw(file);
      for (const pattern of credentialPatterns) expect(text, `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe('sample files: stable identifiers', () => {
  const expectUnique = (ids: string[]) => expect(new Set(ids).size).toBe(ids.length);

  it('AWS instance IDs are unique', () => expectUnique(awsInstances.map((i) => i.InstanceId)));
  it('Azure vmIds are unique', () => expectUnique(azure.value.map((v) => v.properties.vmId)));
  it('GCP instance ids are unique', () => expectUnique(gcpInstances.map((i) => i.id)));
  it('VMware instance UUIDs are unique', () => expectUnique(vmware.vms.map((v) => v.detail.identity.instance_uuid)));

  it('Proxmox VMIDs repeat across clusters, so the ID must be scoped "<cluster>/<vmid>"', () => {
    const bare = proxmoxEntries.map((e) => String(e.vmid));
    expect(new Set(bare).size).toBeLessThan(bare.length); // bare VMID is NOT unique
    expectUnique(proxmoxEntries.map((e) => `${e.cluster}/${e.vmid}`)); // scoped ID is
  });
});

describe('sample files: fully scoped identities', () => {
  it('every entry yields a unique scoped externalId (59 VMs + 1 template)', () => {
    const ids = [
      ...aws.Reservations.flatMap((r) =>
        r.Instances.map((i) =>
          buildIdentity.aws(String(r.OwnerId), i.Placement.AvailabilityZone.slice(0, -1), i.InstanceId).externalId,
        ),
      ),
      ...azure.value.map((v) => buildIdentity.azure(v.id.split('/')[2] ?? '', v.properties.vmId).externalId),
      ...gcpInstances.map((i) => buildIdentity.gcp(i.zone.split('/projects/')[1]?.split('/')[0] ?? '', i.id).externalId),
      ...proxmoxEntries.map((e) => buildIdentity.proxmox(e.cluster, e.vmid).externalId),
      ...vmware.vms.map((v) => buildIdentity.vmware(vmware.vcenter, v.detail.identity.instance_uuid).externalId),
    ];
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
    expect(ids).toContain('pve-dc1/100');
    expect(ids).toContain('pve-lab/100');
    expect(ids).toContain('123456789012/ap-south-1/i-0a1b2c3d4e5f60001');
  });
});

describe('sample files: deliberate edge cases are present', () => {
  it('missing names / hostnames', () => {
    expect(awsInstances.some((i) => !i.Tags.some((t) => t.Key === 'Name'))).toBe(true);
    expect(azure.value.some((v) => v.properties.osProfile === undefined)).toBe(true);
    expect(gcpInstances.some((i) => i.hostname === undefined)).toBe(true);
    expect(vmware.vms.some((v) => v.guestIdentity === null)).toBe(true);
  });

  it('different memory units across providers', () => {
    // AWS MiB, Azure MB, GCP MB, Proxmox bytes, VMware MiB
    expect(aws.InstanceTypes[0]?.MemoryInfo.SizeInMiB).toBeLessThan(1_000_000);
    expect(proxmoxEntries.every((e) => e.maxmem === 0 || e.maxmem > 100_000_000)).toBe(true);
    expect(gcp.machineTypes.length).toBeGreaterThan(0);
    expect(gcpInstances.some((i) => i.machineType.includes('/custom-'))).toBe(true);
  });

  it('unusual power states', () => {
    expect(awsInstances.map((i) => i.State.Name)).toEqual(expect.arrayContaining(['stopping', 'pending', 'terminated']));
    const azureCodes = azure.value.flatMap((v) => v.properties.instanceView?.statuses.map((s) => s.code) ?? []);
    expect(azureCodes).toContain('PowerState/deallocated');
    expect(azure.value.some((v) => v.properties.instanceView === undefined)).toBe(true);
    expect(gcpInstances.map((i) => i.status)).toEqual(expect.arrayContaining(['TERMINATED', 'SUSPENDED', 'REPAIRING']));
    expect(proxmoxEntries.map((e) => e.status)).toContain('unknown');
    expect(vmware.vms.map((v) => v.summary.power_state)).toContain('SUSPENDED');
  });

  it('duplicate names (within VMware and across providers)', () => {
    const vmwareNames = vmware.vms.map((v) => v.summary.name);
    expect(vmwareNames.filter((n) => n === 'app-server')).toHaveLength(2);
    const awsNames = awsInstances.flatMap((i) => i.Tags.filter((t) => t.Key === 'Name').map((t) => t.Value));
    expect(awsNames).toContain('web-01');
    expect(vmwareNames).toContain('web-01');
  });

  it('non-VM entries that must be filtered (Proxmox template)', () => {
    expect(proxmoxEntries.some((e) => e.template === 1)).toBe(true);
    expect(proxmoxEntries.some((e) => e.type === 'lxc')).toBe(true);
  });

  it('inconsistent field types (GCP disk size as string)', () => {
    expect(gcpInstances.every((i) => i.disks.every((d) => typeof d.diskSizeGb === 'string'))).toBe(true);
  });
});
