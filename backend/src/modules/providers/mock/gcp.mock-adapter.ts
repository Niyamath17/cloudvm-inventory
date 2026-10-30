/**
 * GCP MOCK adapter.
 *
 * ⚠️ MOCK: reads backend/sample-data/gcp.compute.instances-aggregated.json – NOT the Compute Engine API.
 *
 * A LIVE adapter would call instances.aggregatedList and machineTypes.get
 * (@google-cloud/compute) per project and return the same GcpRawVm records.
 */
import type { z } from 'zod';
import { gcpInstanceSchema, gcpMachineTypeSchema, type GcpInstance } from '../raw/gcp.raw.js';
import type { CollectionBatch, ProviderAdapter } from '../ProviderAdapter.js';
import { asArray, DEFAULT_SAMPLE_DIR, readMockSample, readString, validateEach } from './sample-file.js';

export const GCP_SAMPLE_FILE = 'gcp.compute.instances-aggregated.json';

export interface GcpRawVm {
  instance: GcpInstance;
  /** Predefined machine type, or null (custom types are decoded by the mapper from the name). */
  machineType: z.infer<typeof gcpMachineTypeSchema> | null;
}

/** Last path segment of a GCP resource URL. */
export const lastSegment = (url: string): string => url.split('/').pop() ?? '';

export class GcpMockAdapter implements ProviderAdapter<GcpRawVm> {
  readonly provider = 'GCP' as const;
  readonly dataSource = 'MOCK' as const;

  constructor(private readonly sampleDir: string = DEFAULT_SAMPLE_DIR) {}

  async collect(): Promise<CollectionBatch<GcpRawVm>> {
    const file = await readMockSample(this.sampleDir, GCP_SAMPLE_FILE, 'GCP');

    const types = validateEach(asArray(file.machineTypes), gcpMachineTypeSchema, () => null).valid;
    const typeByName = new Map(types.map((t) => [t.name, t]));

    // aggregatedList groups instances by zone: { "zones/<zone>": { instances: [...] } }
    const items = typeof file.items === 'object' && file.items !== null ? Object.values(file.items) : [];
    const instances = items.flatMap((group) => asArray((group as { instances?: unknown })?.instances));
    const { valid, rejected } = validateEach(instances, gcpInstanceSchema, (i) => readString(i, 'name'));

    return {
      provider: 'GCP',
      dataSource: 'MOCK',
      sourceLabel: `MOCK sample file ${GCP_SAMPLE_FILE}`,
      collectedAt: new Date(),
      rejected,
      records: valid.map((instance) => ({
        instance,
        machineType: typeByName.get(lastSegment(instance.machineType)) ?? null,
      })),
    };
  }
}
