/**
 * Proxmox VE MOCK adapter.
 *
 * ⚠️ MOCK: reads backend/sample-data/proxmox.cluster-resources.json – NOT a Proxmox API.
 *
 * A LIVE adapter would call GET /api2/json/cluster/resources?type=vm per cluster
 * and the QEMU guest agent endpoints (agent/get-host-name, agent/network-get-interfaces)
 * per running VM, and return the same ProxmoxRawVm records.
 *
 * Templates and LXC containers ARE returned here (the adapter reports what the
 * API reports); the mapper decides they are not VMs and skips them.
 */
import type { z } from 'zod';
import { proxmoxAgentSchema, proxmoxResourceSchema, type ProxmoxResource } from '../raw/proxmox.raw.js';
import type { CollectionBatch, ProviderAdapter, RejectedRawRecord } from '../ProviderAdapter.js';
import { asArray, DEFAULT_SAMPLE_DIR, readMockSample, readString, resolveAccounts, validateEach } from './sample-file.js';

export const PROXMOX_SAMPLE_FILE = 'proxmox.cluster-resources.json';

export interface ProxmoxRawVm {
  cluster: string;
  resource: ProxmoxResource;
  agent: z.infer<typeof proxmoxAgentSchema> | null; // null: guest agent not available
}

export class ProxmoxMockAdapter implements ProviderAdapter<ProxmoxRawVm> {
  readonly provider = 'PROXMOX' as const;
  readonly dataSource = 'MOCK' as const;

  constructor(private readonly sampleDir: string = DEFAULT_SAMPLE_DIR) {}

  async collect(): Promise<CollectionBatch<ProxmoxRawVm>> {
    const file = await readMockSample(this.sampleDir, PROXMOX_SAMPLE_FILE, 'PROXMOX');
    const records: ProxmoxRawVm[] = [];
    const rejected: RejectedRawRecord[] = [];
    // Each cluster block is one queried account; "error" marks a failed query (MOCK simulation).
    const declared: Array<{ id: string; error?: string }> = [];

    for (const clusterBlock of asArray(file.clusters)) {
      const cluster = readString(clusterBlock, 'cluster');
      const data = asArray((clusterBlock as { data?: unknown })?.data);
      const ref = (r: unknown) => (cluster ? `${cluster}/` : '') + (readString(r, 'id') ?? '?');

      if (!cluster) {
        // VMIDs are only unique per cluster: without the cluster name there is no identity.
        rejected.push(...data.map((r) => ({ ref: ref(r), errors: ['cluster block has no "cluster" name'] })));
        continue;
      }
      const error = readString(clusterBlock, 'error');
      declared.push(error ? { id: cluster, error } : { id: cluster });
      if (error) continue; // failed query: no data for this cluster

      const agentRaw = (clusterBlock as { agent?: unknown })?.agent;
      const agents = typeof agentRaw === 'object' && agentRaw !== null ? (agentRaw as Record<string, unknown>) : {};

      const { valid, rejected: bad } = validateEach(data, proxmoxResourceSchema, ref);
      rejected.push(...bad.map((b) => ({ ...b, account: cluster })));
      for (const resource of valid) {
        const agent = proxmoxAgentSchema.safeParse(agents[String(resource.vmid)]);
        records.push({ cluster, resource, agent: agent.success ? agent.data : null });
      }
    }

    return {
      provider: 'PROXMOX',
      dataSource: 'MOCK',
      sourceLabel: `MOCK sample file ${PROXMOX_SAMPLE_FILE}`,
      collectedAt: new Date(),
      records,
      rejected,
      accounts: resolveAccounts(declared, []),
    };
  }
}
