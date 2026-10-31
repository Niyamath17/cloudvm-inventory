/**
 * Inventory read API.
 *   GET /vms          list with search, filters, sorting, pagination (rawData omitted)
 *   GET /vms/facets   values for filter dropdowns
 *   GET /vms/:id      full detail incl. raw provider payload and sync state
 */
import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import { buildVmOrderBy, buildVmWhere, vmListQuerySchema } from './inventory.query.js';

const idParam = z.object({ id: z.uuid() });

export function createInventoryRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const q = vmListQuerySchema.parse(req.query);
    const where = buildVmWhere(q);
    const [total, data] = await Promise.all([
      prisma.virtualMachine.count({ where }),
      prisma.virtualMachine.findMany({
        where,
        orderBy: buildVmOrderBy(q),
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        omit: { rawData: true },
      }),
    ]);
    res.json({ data, pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) } });
  });

  router.get('/facets', async (_req, res) => {
    const [providers, powerStates, lifecycles, regions, clusters, owners] = await Promise.all([
      prisma.virtualMachine.groupBy({ by: ['provider'], _count: { _all: true }, orderBy: { provider: 'asc' } }),
      prisma.virtualMachine.groupBy({ by: ['powerState'], _count: { _all: true }, orderBy: { powerState: 'asc' } }),
      prisma.virtualMachine.groupBy({ by: ['lifecycle'], _count: { _all: true }, orderBy: { lifecycle: 'asc' } }),
      prisma.virtualMachine.findMany({ where: { region: { not: null } }, distinct: ['region'], select: { region: true }, orderBy: { region: 'asc' } }),
      prisma.virtualMachine.findMany({ where: { cluster: { not: null } }, distinct: ['cluster'], select: { cluster: true }, orderBy: { cluster: 'asc' } }),
      prisma.virtualMachine.findMany({ where: { owner: { not: null } }, distinct: ['owner'], select: { owner: true }, orderBy: { owner: 'asc' } }),
    ]);
    res.json({
      providers: providers.map((p) => ({ value: p.provider, count: p._count._all })),
      powerStates: powerStates.map((p) => ({ value: p.powerState, count: p._count._all })),
      lifecycles: lifecycles.map((l) => ({ value: l.lifecycle, count: l._count._all })),
      regions: regions.map((r) => r.region),
      clusters: clusters.map((c) => c.cluster),
      owners: owners.map((o) => o.owner),
    });
  });

  router.get('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const vm = await prisma.virtualMachine.findUnique({
      where: { id },
      include: { syncStates: true, syncEvents: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!vm) throw new NotFoundError(`VM ${id} not found`);
    res.json(vm);
  });

  return router;
}
