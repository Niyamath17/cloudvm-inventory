/**
 * GET /vms query parameters – validated with Zod, then turned into a Prisma `where`
 * and `orderBy`. Kept separate from the route so it can be unit-tested without HTTP.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

const PROVIDERS = ['AWS', 'AZURE', 'GCP', 'PROXMOX', 'VMWARE'] as const;
const POWER_STATES = ['RUNNING', 'STOPPED', 'SUSPENDED', 'UNKNOWN'] as const;

/** "AWS,GCP" or ["AWS","GCP"] -> ["AWS","GCP"] (upper-cased, validated). */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim().toUpperCase()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1))
    .optional();

export const SORT_FIELDS = ['name', 'provider', 'region', 'cluster', 'powerState', 'cpuCores', 'memoryMb', 'diskGb', 'owner', 'lastDiscoveredAt'] as const;
const NULLABLE_SORT = new Set(['region', 'cluster', 'cpuCores', 'memoryMb', 'diskGb', 'owner']);

export const vmListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  provider: csvEnum(PROVIDERS),
  powerState: csvEnum(POWER_STATES),
  lifecycle: z.enum(['ACTIVE', 'DECOMMISSIONED', 'ALL']).default('ALL'),
  region: z.string().trim().min(1).max(100).optional(),
  cluster: z.string().trim().min(1).max(100).optional(),
  owner: z.string().trim().min(1).max(100).optional(),
  sortBy: z.enum(SORT_FIELDS).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type VmListQuery = z.infer<typeof vmListQuerySchema>;

export function buildVmWhere(q: VmListQuery): Prisma.VirtualMachineWhereInput {
  const and: Prisma.VirtualMachineWhereInput[] = [];
  if (q.provider) and.push({ provider: { in: q.provider } });
  if (q.powerState) and.push({ powerState: { in: q.powerState } });
  if (q.lifecycle !== 'ALL') and.push({ lifecycle: q.lifecycle });
  if (q.region) and.push({ region: q.region });
  if (q.cluster) and.push({ cluster: q.cluster });
  if (q.owner) and.push({ owner: q.owner });
  if (q.search) {
    const contains = { contains: q.search, mode: 'insensitive' as const };
    and.push({
      OR: [
        { name: contains },
        { hostname: contains },
        { externalId: contains },
        { nativeId: contains },
        { osName: contains },
        { owner: contains },
        { ipAddresses: { has: q.search } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export function buildVmOrderBy(q: VmListQuery): Prisma.VirtualMachineOrderByWithRelationInput[] {
  const primary = NULLABLE_SORT.has(q.sortBy)
    ? { [q.sortBy]: { sort: q.sortOrder, nulls: 'last' } }
    : { [q.sortBy]: q.sortOrder };
  // id as tie-breaker => stable pagination when many rows share the same value
  return [primary as Prisma.VirtualMachineOrderByWithRelationInput, { id: 'asc' }];
}
