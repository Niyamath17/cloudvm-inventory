/**
 * Azure MOCK adapter.
 *
 * ⚠️ MOCK: reads backend/sample-data/azure.compute.virtual-machines.json – NOT Azure Resource Manager.
 *
 * A LIVE adapter would call (via @azure/arm-compute / @azure/arm-network):
 * "Virtual Machines – List All" with instanceView, "Virtual Machine Sizes – List"
 * and "Network Interfaces – Get", and return the same AzureRawVm records.
 */
import type { z } from 'zod';
import { azureNicSchema, azureVmSchema, azureVmSizeSchema, type AzureVm } from '../raw/azure.raw.js';
import type { CollectionBatch, ProviderAdapter } from '../ProviderAdapter.js';
import { asArray, DEFAULT_SAMPLE_DIR, readMockSample, readString, validateEach } from './sample-file.js';

export const AZURE_SAMPLE_FILE = 'azure.compute.virtual-machines.json';

export interface AzureRawVm {
  vm: AzureVm;
  size: z.infer<typeof azureVmSizeSchema> | null; // VM size entry (cores / memoryInMB)
  nics: Array<z.infer<typeof azureNicSchema>>; // network interfaces referenced by the VM
}

export class AzureMockAdapter implements ProviderAdapter<AzureRawVm> {
  readonly provider = 'AZURE' as const;
  readonly dataSource = 'MOCK' as const;

  constructor(private readonly sampleDir: string = DEFAULT_SAMPLE_DIR) {}

  async collect(): Promise<CollectionBatch<AzureRawVm>> {
    const file = await readMockSample(this.sampleDir, AZURE_SAMPLE_FILE, 'AZURE');

    const sizes = validateEach(asArray(file.vmSizes), azureVmSizeSchema, () => null).valid;
    const nics = validateEach(asArray(file.networkInterfaces), azureNicSchema, () => null).valid;
    // ARM resource IDs are case-insensitive.
    const sizeByName = new Map(sizes.map((s) => [s.name.toLowerCase(), s]));
    const nicById = new Map(nics.map((n) => [n.id.toLowerCase(), n]));

    const { valid, rejected } = validateEach(asArray(file.value), azureVmSchema, (v) => readString(v, 'name'));

    return {
      provider: 'AZURE',
      dataSource: 'MOCK',
      sourceLabel: `MOCK sample file ${AZURE_SAMPLE_FILE}`,
      collectedAt: new Date(),
      rejected,
      records: valid.map((vm) => ({
        vm,
        size: sizeByName.get(vm.properties.hardwareProfile.vmSize.toLowerCase()) ?? null,
        nics: vm.properties.networkProfile.networkInterfaces.flatMap((ref) => {
          const nic = nicById.get(ref.id.toLowerCase());
          return nic ? [nic] : [];
        }),
      })),
    };
  }
}
