/** GET /providers – registered adapters (all MOCK), their last result and VM counts. */
import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import type { RegisteredProvider } from './registry.js';

export function createProvidersRouter(prisma: PrismaClient, providers: RegisteredProvider[]): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const data = await Promise.all(
      providers.map(async (p) => {
        const [lastResult, active, decommissioned] = await Promise.all([
          prisma.providerRunResult.findFirst({
            where: { provider: p.provider },
            orderBy: { run: { startedAt: 'desc' } },
            include: { run: { select: { id: true, startedAt: true, finishedAt: true } } },
          }),
          prisma.virtualMachine.count({ where: { provider: p.provider, lifecycle: 'ACTIVE' } }),
          prisma.virtualMachine.count({ where: { provider: p.provider, lifecycle: 'DECOMMISSIONED' } }),
        ]);
        return {
          provider: p.provider,
          dataSource: p.dataSource,
          label: p.dataSource === 'MOCK' ? 'MOCK adapter – sample data, not a real provider API' : 'LIVE adapter',
          vmCounts: { active, decommissioned },
          lastResult,
        };
      }),
    );
    res.json({ data });
  });
  return router;
}
