/**
 * NormalizedVm – the ONE common VM model every provider maps into.
 *
 * It mirrors the VirtualMachine table's columns (minus DB bookkeeping such as
 * id, timestamps and sync state), so M3 can upsert it directly. The Zod schema
 * is the final quality gate of the normalization engine: a mapper's output that
 * fails it is reported as an invalid record instead of reaching the database.
 *
 * Units – BINARY convention, used identically for every provider:
 *   memoryMb – MEBIBYTES (MiB, 1024 × 1024 bytes). The column keeps the M1 name
 *              "memoryMb" for compatibility, but the value is MiB. Providers and
 *              NetBox already count RAM in MiB even when they label it "MB"
 *              (Azure memoryInMB 4096 = 4 GiB; NetBox shows memory / 1024 as GB):
 *                AWS SizeInMiB, Azure memoryInMB, GCP memoryMb, VMware memory_size_MiB -> as is
 *                Proxmox maxmem (bytes) -> bytes / 1024²
 *              No decimal (×1.048576) conversion is ever applied.
 *   diskGb   – GIBIBYTES (GiB, 1024³ bytes):
 *                AWS volume Size (GiB), Azure diskSizeGB, GCP diskSizeGb (string) -> as is
 *                Proxmox maxdisk, VMware capacity (bytes) -> bytes / 1024³
 */
import { z } from 'zod';
import type { ProviderName } from './identity.js';

export const PROVIDERS = ['AWS', 'AZURE', 'GCP', 'PROXMOX', 'VMWARE'] as const satisfies readonly ProviderName[];
export const POWER_STATES = ['RUNNING', 'STOPPED', 'SUSPENDED', 'UNKNOWN'] as const;

const ip = z.union([z.ipv4(), z.ipv6()]);

export const normalizedVmSchema = z
  .object({
    // identity (built by domain/identity.ts)
    provider: z.enum(PROVIDERS),
    externalId: z.string().min(3),
    nativeId: z.string().min(1),
    account: z.string().min(1),

    // attributes
    name: z.string().trim().min(1).max(255),
    hostname: z.string().min(1).max(255).nullable(),
    ipAddresses: z.array(ip),
    osName: z.string().min(1).nullable(),
    cpuCores: z.number().int().positive().max(4096).nullable(),
    memoryMb: z.number().int().positive().max(64 * 1024 * 1024).nullable(), // ≤ 64 TiB
    diskGb: z.number().int().nonnegative().max(10 * 1024 * 1024).nullable(), // ≤ 10 PiB
    region: z.string().min(1).nullable(),
    cluster: z.string().min(1).nullable(),
    owner: z.string().min(1).nullable(),
    tags: z.record(z.string(), z.string()),

    // state (from domain/state.ts)
    powerState: z.enum(POWER_STATES),
    rawPowerState: z.string().nullable(),
    lifecycle: z.enum(['ACTIVE', 'DECOMMISSIONED']),
    decommissionReason: z.enum(['PROVIDER_TERMINATED', 'MISSING_FROM_PROVIDER']).nullable(),

    // provenance
    dataSource: z.enum(['MOCK', 'LIVE']),
    discoveredAt: z.date(),
    rawData: z.unknown(),
  })
  .superRefine((vm, ctx) => {
    // Same rule as the DB CHECK constraint – caught here first, with a readable message.
    const decommissioned = vm.lifecycle === 'DECOMMISSIONED';
    if (decommissioned !== (vm.decommissionReason !== null)) {
      ctx.addIssue({ code: 'custom', path: ['decommissionReason'], message: 'must be set if and only if lifecycle is DECOMMISSIONED' });
    }
    if (decommissioned && vm.powerState !== 'UNKNOWN') {
      ctx.addIssue({ code: 'custom', path: ['powerState'], message: 'a decommissioned VM has no power state (UNKNOWN)' });
    }
  });

export type NormalizedVm = z.infer<typeof normalizedVmSchema>;
export type { ProviderName };
