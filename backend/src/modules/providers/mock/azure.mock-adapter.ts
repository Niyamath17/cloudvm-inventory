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
import { asArray, DEFAULT_SAMPLE_DIR, failedSet, readMockSample, readString, resolveAccounts, validateEach } from './sample-file.js';

/** Subscription ID (lower-case, as in the VM identity) from an ARM resource ID. */
export const subscriptionOf = (armId: string | null): string | undefined =>
  /^\/subscriptions\/([^/]+)\//i.exec(armId ?? '')?.[1]?.toLowerCase();

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

    const items = asArray(file.value);
    const { valid, rejected } = validateEach(items, azureVmSchema, (v) => readString(v, 'name'));
    const accountOf = (v: unknown) => subscriptionOf(readString(v, 'id'));

    const declared = asArray(file.accounts).map((a) => ({ ...(a as object), id: readString(a, 'id')?.toLowerCase() }));
    const accounts = resolveAccounts(declared, items.flatMap((v) => accountOf(v) ?? []));
    const failed = failedSet(accounts);
    const ok = (account: string | undefined) => !account || !failed.has(account);

    return {
      provider: 'AZURE',
      dataSource: 'MOCK',
      sourceLabel: `MOCK sample file ${AZURE_SAMPLE_FILE}`,
      collectedAt: new Date(),
      accounts,
      rejected: rejected
        .map((r) => ({ ...r, account: accountOf(items.find((v) => readString(v, 'name') === r.ref)) }))
        .filter((r) => ok(r.account)),
      records: valid.filter((vm) => ok(subscriptionOf(vm.id))).map((vm) => ({
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
