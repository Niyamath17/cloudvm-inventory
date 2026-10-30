/**
 * VMware vSphere MOCK adapter.
 *
 * ⚠️ MOCK: reads backend/sample-data/vmware.vcenter-vms.json – NOT a vCenter Server.
 *
 * A LIVE adapter would call the vSphere Automation REST API: GET /api/vcenter/vm,
 * GET /api/vcenter/vm/{vm}, GET /api/vcenter/vm/{vm}/guest/identity and the
 * tagging API, per vCenter, and return the same VmwareRawVm records.
 */
import { vmwareVmSchema, type VmwareVm } from '../raw/vmware.raw.js';
import type { CollectionBatch, ProviderAdapter } from '../ProviderAdapter.js';
import { asArray, DEFAULT_SAMPLE_DIR, readMockSample, readString, SampleFileError, validateEach } from './sample-file.js';

export const VMWARE_SAMPLE_FILE = 'vmware.vcenter-vms.json';

export interface VmwareRawVm {
  vcenter: string; // vCenter host – scopes instance_uuid in the identity
  vm: VmwareVm;
}

export class VmwareMockAdapter implements ProviderAdapter<VmwareRawVm> {
  readonly provider = 'VMWARE' as const;
  readonly dataSource = 'MOCK' as const;

  constructor(private readonly sampleDir: string = DEFAULT_SAMPLE_DIR) {}

  async collect(): Promise<CollectionBatch<VmwareRawVm>> {
    const file = await readMockSample(this.sampleDir, VMWARE_SAMPLE_FILE, 'VMWARE');
    const vcenter = typeof file.vcenter === 'string' ? file.vcenter.trim() : '';
    // The whole file comes from one vCenter: without its name no VM has an identity.
    if (!vcenter) throw new SampleFileError(`${VMWARE_SAMPLE_FILE} has no "vcenter" host`);

    const { valid, rejected } = validateEach(asArray(file.vms), vmwareVmSchema, (v) => readString(v, 'summary', 'name'));
    return {
      provider: 'VMWARE',
      dataSource: 'MOCK',
      sourceLabel: `MOCK sample file ${VMWARE_SAMPLE_FILE} (vCenter ${vcenter})`,
      collectedAt: new Date(),
      rejected,
      records: valid.map((vm) => ({ vcenter, vm })),
    };
  }
}
