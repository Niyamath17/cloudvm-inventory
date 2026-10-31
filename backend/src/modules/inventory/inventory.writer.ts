/**
 * Inventory writer – persists ONE provider's normalized batch in ONE database
 * transaction (all-or-nothing per provider).
 *
 * Per VM, keyed by the unique (provider, externalId):
 *   not in DB                      -> CREATE
 *   in DB, fingerprint differs     -> UPDATE (includes reactivation of a decommissioned VM)
 *   in DB, fingerprint equal       -> UNCHANGED: the row is NOT rewritten. Only the
 *                                     lastDiscoveredAt "heartbeat" is advanced, for all
 *                                     unchanged VMs at once, in a single SQL statement
 *                                     that deliberately does not touch updatedAt.
 * Then, for each account in plan.reconcile only:
 *   ACTIVE in DB but absent from batch -> DECOMMISSIONED (MISSING_FROM_PROVIDER)
 *
 * Idempotent: running the same batch twice gives 0 creates, 0 updates, 0 decommissions.
 */
import { Prisma, type PrismaClient, type VirtualMachine } from '@prisma/client';
import { fingerprint } from '../normalization/fingerprint.js';
import type { NormalizationResult, NormalizedRecord } from '../normalization/types.js';

export interface WriteCounts {
  created: number;
  updated: number;
  reactivated: number; // subset of updated: DECOMMISSIONED -> ACTIVE
  unchanged: number;
  decommissioned: number;
}

type Tx = Prisma.TransactionClient;

/** Columns written from a NormalizedVm (identity columns are never changed on update). */
function dataColumns(rec: NormalizedRecord, existing: VirtualMachine | null) {
  const vm = rec.vm;
  const decommissioned = vm.lifecycle === 'DECOMMISSIONED';
  return {
    name: vm.name,
    hostname: vm.hostname,
    ipAddresses: vm.ipAddresses,
    osName: vm.osName,
    cpuCores: vm.cpuCores,
    memoryMb: vm.memoryMb,
    diskGb: vm.diskGb,
    region: vm.region,
    cluster: vm.cluster,
    owner: vm.owner,
    tags: vm.tags,
    powerState: vm.powerState,
    rawPowerState: vm.rawPowerState,
    lifecycle: vm.lifecycle,
    decommissionReason: vm.decommissionReason,
    // keep the ORIGINAL decommission time if it was already decommissioned
    decommissionedAt: decommissioned ? (existing?.decommissionedAt ?? vm.discoveredAt) : null,
    dataSource: vm.dataSource,
    rawData: vm.rawData as Prisma.InputJsonValue,
    fingerprint: rec.fingerprint,
    lastDiscoveredAt: vm.discoveredAt,
  };
}

export async function writeProviderBatch(
  prisma: PrismaClient,
  result: NormalizationResult,
  reconcileAccounts: string[],
): Promise<WriteCounts> {
  const counts: WriteCounts = { created: 0, updated: 0, reactivated: 0, unchanged: 0, decommissioned: 0 };
  const now = result.collectedAt;

  await prisma.$transaction(
    async (tx: Tx) => {
      const externalIds = result.vms.map((r) => r.vm.externalId);
      const existing = await tx.virtualMachine.findMany({
        where: { provider: result.provider, externalId: { in: externalIds } },
      });
      const byExternalId = new Map(existing.map((v) => [v.externalId, v]));

      const toCreate: Prisma.VirtualMachineCreateManyInput[] = [];
      const unchangedIds: string[] = [];

      for (const rec of result.vms) {
        const current = byExternalId.get(rec.vm.externalId) ?? null;
        if (!current) {
          toCreate.push({
            provider: rec.vm.provider,
            externalId: rec.vm.externalId,
            nativeId: rec.vm.nativeId,
            account: rec.vm.account,
            firstDiscoveredAt: now,
            ...dataColumns(rec, null),
          });
        } else if (current.fingerprint === rec.fingerprint) {
          unchangedIds.push(current.id);
        } else {
          await tx.virtualMachine.update({ where: { id: current.id }, data: dataColumns(rec, current) });
          counts.updated += 1;
          if (current.lifecycle === 'DECOMMISSIONED' && rec.vm.lifecycle === 'ACTIVE') counts.reactivated += 1;
        }
      }

      if (toCreate.length) counts.created = (await tx.virtualMachine.createMany({ data: toCreate })).count;

      if (unchangedIds.length) {
        // Heartbeat only: one statement, data columns and updatedAt untouched.
        // Timestamp passed as ISO text and converted to UTC explicitly (Prisma stores DateTime as UTC).
        await tx.$executeRaw`UPDATE "virtual_machines" SET "lastDiscoveredAt" = (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC') WHERE "id" = ANY(${unchangedIds}::text[])`;
        counts.unchanged = unchangedIds.length;
      }

      // Account-scoped decommissioning of VMs that disappeared.
      if (reconcileAccounts.length) {
        const missing = await tx.virtualMachine.findMany({
          where: {
            provider: result.provider,
            account: { in: reconcileAccounts },
            lifecycle: 'ACTIVE',
            externalId: { notIn: externalIds },
          },
        });
        for (const vm of missing) {
          const next = { ...vm, lifecycle: 'DECOMMISSIONED' as const, powerState: 'UNKNOWN' as const };
          await tx.virtualMachine.update({
            where: { id: vm.id },
            data: {
              lifecycle: 'DECOMMISSIONED',
              decommissionReason: 'MISSING_FROM_PROVIDER',
              decommissionedAt: now,
              powerState: 'UNKNOWN', // a VM that no longer exists has no power state
              fingerprint: fingerprint({ ...next, tags: next.tags as Record<string, string> }),
            },
          });
        }
        counts.decommissioned = missing.length;
      }
    },
    { timeout: 30_000 },
  );

  return counts;
}
