/**
 * GET /dashboard/summary – headline numbers for the dashboard.
 * Power-state counts include ACTIVE VMs only: a decommissioned VM is never "stopped".
 */
import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';

export function createDashboardRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.get('/summary', async (_req, res) => {
    const [byPower, byProvider, decommissioned, total, lastCollection, lastSync] = await Promise.all([
      prisma.virtualMachine.groupBy({ by: ['powerState'], where: { lifecycle: 'ACTIVE' }, _count: { _all: true } }),
      prisma.virtualMachine.groupBy({
        by: ['provider'],
        where: { lifecycle: 'ACTIVE' },
        _count: { _all: true },
        _sum: { cpuCores: true, memoryMb: true, diskGb: true },
        orderBy: { provider: 'asc' },
      }),
      prisma.virtualMachine.count({ where: { lifecycle: 'DECOMMISSIONED' } }),
      prisma.virtualMachine.count(),
      prisma.collectionRun.findFirst({
        where: { status: { not: 'RUNNING' } },
        orderBy: { startedAt: 'desc' },
        select: { id: true, status: true, trigger: true, startedAt: true, finishedAt: true },
      }),
      prisma.syncRun.findFirst({
        where: { status: { not: 'RUNNING' } },
        orderBy: { startedAt: 'desc' },
        select: { id: true, target: true, status: true, startedAt: true, finishedAt: true, createdCount: true, updatedCount: true, decommissionedCount: true, skippedCount: true, failedCount: true, duplicateCount: true },
      }),
    ]);

    const power = (s: string) => byPower.find((p) => p.powerState === s)?._count._all ?? 0;
    const sum = (k: 'cpuCores' | 'memoryMb' | 'diskGb') => byProvider.reduce((acc, p) => acc + (p._sum[k] ?? 0), 0);

    res.json({
      dataSource: 'MOCK',
      vms: {
        total,
        active: total - decommissioned,
        running: power('RUNNING'),
        stopped: power('STOPPED'),
        suspended: power('SUSPENDED'),
        unknown: power('UNKNOWN'),
        decommissioned,
      },
      resources: { cpuCores: sum('cpuCores'), memoryMb: sum('memoryMb'), diskGb: sum('diskGb') }, // ACTIVE VMs; MiB / GiB
      providers: byProvider.map((p) => ({
        provider: p.provider,
        vms: p._count._all,
        cpuCores: p._sum.cpuCores ?? 0,
        memoryMb: p._sum.memoryMb ?? 0,
        diskGb: p._sum.diskGb ?? 0,
      })),
      lastCollection,
      // target SIMULATION = local stand-in; never presented as a real NetBox sync
      lastSync: lastSync ? { ...lastSync, simulated: lastSync.target === 'SIMULATION' } : null,
    });
  });
  return router;
}
