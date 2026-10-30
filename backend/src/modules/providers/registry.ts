/**
 * Provider registry: pairs each adapter with its mapper.
 *
 * `defineProvider` ties the adapter's raw record type to the mapper's input
 * type at compile time, so an AWS adapter can never be paired with the Azure
 * mapper. The orchestrator (M3) just loops over the registry:
 *   batch = await adapter.collect();  result = normalizeBatch(batch, mapper)
 */
import type { ProviderName } from '../../domain/normalized-vm.js';
import { normalizeBatch } from '../normalization/normalizer.js';
import { mapAwsVm } from '../normalization/mappers/aws.mapper.js';
import { mapAzureVm } from '../normalization/mappers/azure.mapper.js';
import { mapGcpVm } from '../normalization/mappers/gcp.mapper.js';
import { mapProxmoxVm } from '../normalization/mappers/proxmox.mapper.js';
import { mapVmwareVm } from '../normalization/mappers/vmware.mapper.js';
import type { NormalizationResult, VmMapper } from '../normalization/types.js';
import { AwsMockAdapter } from './mock/aws.mock-adapter.js';
import { AzureMockAdapter } from './mock/azure.mock-adapter.js';
import { GcpMockAdapter } from './mock/gcp.mock-adapter.js';
import { ProxmoxMockAdapter } from './mock/proxmox.mock-adapter.js';
import { VmwareMockAdapter } from './mock/vmware.mock-adapter.js';
import type { ProviderAdapter } from './ProviderAdapter.js';

export interface RegisteredProvider {
  provider: ProviderName;
  dataSource: 'MOCK' | 'LIVE';
  /** Collect + normalize. Throws only if the whole source is unusable. */
  collectAndNormalize(): Promise<NormalizationResult>;
}

export function defineProvider<TRaw>(adapter: ProviderAdapter<TRaw>, mapper: VmMapper<TRaw>): RegisteredProvider {
  return {
    provider: adapter.provider,
    dataSource: adapter.dataSource,
    collectAndNormalize: async () => normalizeBatch(await adapter.collect(), mapper),
  };
}

/** All providers in MOCK mode (the only mode this prototype ships). */
export function createMockProviders(sampleDir?: string): RegisteredProvider[] {
  return [
    defineProvider(new AwsMockAdapter(sampleDir), mapAwsVm),
    defineProvider(new AzureMockAdapter(sampleDir), mapAzureVm),
    defineProvider(new GcpMockAdapter(sampleDir), mapGcpVm),
    defineProvider(new ProxmoxMockAdapter(sampleDir), mapProxmoxVm),
    defineProvider(new VmwareMockAdapter(sampleDir), mapVmwareVm),
  ];
}
