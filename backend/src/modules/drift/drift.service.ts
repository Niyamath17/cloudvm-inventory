/**
 * Drift reporting service.
 *
 *   generate()      reads all VMs + all NetBox records of the target, runs detectDrift(),
 *                   persists a DriftReport with its DriftItems (one transaction).
 *   remediate(id)   marks VMs with MISSING / RESOURCE / POWER-STATE drift for re-sync
 *                   (VmSyncState -> PENDING), so the next POST /sync corrects NetBox.
 *                   ORPHAN and DUPLICATE findings are NEVER fixed automatically – deleting
 *                   NetBox records is an operator decision.
 *
 * Reports carry their target; in SIMULATION mode they describe the simulated NetBox only.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { NetBoxReader } from '../netbox/NetBoxReader.js';
import { detectDrift, summarize } from './drift.engine.js';

export const RESYNC_TYPES = ['MISSING_IN_NETBOX', 'RESOURCE_MISMATCH', 'POWER_STATE_MISMATCH'] as const;

export class DriftService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly reader: NetBoxReader,
    private readonly logger: Logger,
  ) {}

  get target() {
    return this.reader.target;
  }

  async generate(): Promise<string> {
    const [local, remote] = await Promise.all([
      this.prisma.virtualMachine.findMany({
        select: { id: true, provider: true, externalId: true, nativeId: true, account: true, name: true, region: true, cluster: true, cpuCores: true, memoryMb: true, diskGb: true, powerState: true, lifecycle: true },
      }),
      this.reader.listVms(),
    ]);
    const findings = detectDrift(local, remote);
    const summary = summarize(findings, local.length, remote.length);

    const report = await this.prisma.$transaction(async (tx) => {
      const r = await tx.driftReport.create({
        data: {
          target: this.reader.target,
          totalItems: summary.totalItems,
          summary: summary as unknown as Prisma.InputJsonValue,
        },
      });
      if (findings.length) {
        await tx.driftItem.createMany({ data: findings.map((f) => ({ ...f, reportId: r.id })) });
      }
      return r;
    });
    this.logger.info({ reportId: report.id, target: this.reader.target, ...summary.byType }, 'Drift report generated');
    return report.id;
  }

  async remediate(reportId: string): Promise<{ markedForResync: number; manualActionRequired: number }> {
    const report = await this.prisma.driftReport.findUnique({ where: { id: reportId }, include: { items: true } });
    if (!report) throw new NotFoundError(`Drift report ${reportId} not found`);
    const vmIds = [...new Set(report.items.filter((i) => (RESYNC_TYPES as readonly string[]).includes(i.type) && i.vmId).map((i) => i.vmId as string))];
    const { count } = await this.prisma.vmSyncState.updateMany({
      where: { target: report.target, vmId: { in: vmIds } },
      data: { state: 'PENDING', syncedFingerprint: null },
    });
    // A VM with no sync state yet is already PENDING for the sync engine.
    const manual = report.items.filter((i) => i.type === 'ORPHAN_IN_NETBOX' || i.type === 'DUPLICATE').length;
    this.logger.info({ reportId, markedForResync: vmIds.length, statesReset: count, manual }, 'Drift remediation prepared');
    return { markedForResync: vmIds.length, manualActionRequired: manual };
  }
}
