import { describe, expect, it } from 'vitest';
import { buildIdentity, IdentityError, netboxSerial } from '../../src/domain/identity.js';

describe('buildIdentity – fully scoped externalId per provider', () => {
  it('AWS: <accountId>/<region>/<instanceId>', () => {
    expect(buildIdentity.aws('123456789012', 'ap-south-1', 'i-0a1b2c3d4e5f60001')).toEqual({
      provider: 'AWS',
      externalId: '123456789012/ap-south-1/i-0a1b2c3d4e5f60001',
      nativeId: 'i-0a1b2c3d4e5f60001',
      account: '123456789012',
    });
  });

  it('AWS: same instance ID in another account or region is a different VM', () => {
    const a = buildIdentity.aws('111111111111', 'us-east-1', 'i-abc');
    const b = buildIdentity.aws('222222222222', 'us-east-1', 'i-abc');
    const c = buildIdentity.aws('111111111111', 'eu-west-1', 'i-abc');
    expect(new Set([a.externalId, b.externalId, c.externalId]).size).toBe(3);
  });

  it('Azure: <subscriptionId>/<vmId>, case-normalised GUIDs', () => {
    const id = buildIdentity.azure('00000000-AAAA-4BBB-8CCC-000000000001', '6F1C9A3E-0000-4000-8000-000000000001');
    expect(id.externalId).toBe('00000000-aaaa-4bbb-8ccc-000000000001/6f1c9a3e-0000-4000-8000-000000000001');
    expect(buildIdentity.azure('00000000-aaaa-4bbb-8ccc-000000000001', '6f1c9a3e-0000-4000-8000-000000000001').externalId).toBe(id.externalId);
  });

  it('GCP: <projectId>/<instanceId>', () => {
    expect(buildIdentity.gcp('cloudvm-demo-project', '4417300000000000001').externalId).toBe(
      'cloudvm-demo-project/4417300000000000001',
    );
  });

  it('Proxmox: VMID 100 in two clusters gives two identities', () => {
    const dc1 = buildIdentity.proxmox('pve-dc1', 100);
    const lab = buildIdentity.proxmox('pve-lab', 100);
    expect(dc1.externalId).toBe('pve-dc1/100');
    expect(lab.externalId).toBe('pve-lab/100');
    expect(dc1.nativeId).toBe(lab.nativeId);
  });

  it('VMware: <vCenter host>/<instanceUuid>, case-normalised', () => {
    expect(buildIdentity.vmware('VCSA01.corp.example.com', '50000001-1A2B-4C3D-8E9F-0A1B2C3D4E5F').externalId).toBe(
      'vcsa01.corp.example.com/50000001-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    );
  });

  it('rejects missing or ambiguous parts instead of building a bad key', () => {
    expect(() => buildIdentity.aws('', 'us-east-1', 'i-abc')).toThrow(IdentityError);
    expect(() => buildIdentity.gcp('proj', '  ')).toThrow(IdentityError);
    expect(() => buildIdentity.proxmox('pve/dc1', 100)).toThrow(/must not contain/);
  });

  it('builds the NetBox serial from provider + externalId', () => {
    expect(netboxSerial(buildIdentity.proxmox('pve-lab', 100))).toBe('proxmox:pve-lab/100');
  });
});
