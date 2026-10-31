/**
 * Sync + NetBox API.
 *   POST /sync                   start a sync to the configured target -> 202 { syncRunId, target } (409 if running)
 *   GET  /sync/runs              history (paginated)
 *   GET  /sync/runs/:id          one run with its events
 *   GET  /netbox/status          configured mode; live reachability only in live mode
 *   GET  /netbox/simulated-vms   SIMULATION records (simulation mode only)
 */
import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import type { HttpNetBoxGateway } from '../netbox/http.gateway.js';
import type { NetBoxGateway } from '../netbox/NetBoxGateway.js';
import type { SyncService } from './sync.service.js';

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const idParam = z.object({ id: z.uuid() });

const label = (target: string) =>
  target === 'SIMULATION' ? 'SIMULATION – local stand-in, no real NetBox instance is contacted' : 'LIVE NetBox REST API';

export function createSyncRouter(prisma: PrismaClient, sync: SyncService): Router {
  const router = Router();

  router.post('/', async (_req, res) => {
    const { syncRunId } = await sync.start(); // SyncInProgressError -> 409
    res.status(202).json({ syncRunId, status: 'RUNNING', target: sync.target, label: label(sync.target) });
  });

  router.get('/runs', async (req, res) => {
    const q = pageQuery.parse(req.query);
    const [total, data] = await Promise.all([
      prisma.syncRun.count(),
      prisma.syncRun.findMany({ orderBy: { startedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    res.json({ data, pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) } });
  });

  router.get('/runs/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const run = await prisma.syncRun.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: 'asc' } } } });
    if (!run) throw new NotFoundError(`Sync run ${id} not found`);
    res.json({ ...run, label: label(run.target) });
  });

  return router;
}

export function createNetBoxRouter(prisma: PrismaClient, gateway: NetBoxGateway): Router {
  const router = Router();

  router.get('/status', async (_req, res) => {
    if (gateway.target === 'SIMULATION') {
      res.json({ mode: 'SIMULATION', target: 'SIMULATION', label: label('SIMULATION'), simulatedRecords: await prisma.simulatedNetboxVm.count() });
      return;
    }
    try {
      const s = await (gateway as HttpNetBoxGateway).status();
      res.json({ mode: 'LIVE', target: 'NETBOX', label: label('NETBOX'), reachable: true, ...s });
    } catch (err) {
      res.status(503).json({ mode: 'LIVE', target: 'NETBOX', label: label('NETBOX'), reachable: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/simulated-vms', async (req, res) => {
    if (gateway.target !== 'SIMULATION') throw new NotFoundError('Simulated records exist only in SIMULATION mode');
    const q = pageQuery.extend({ pageSize: z.coerce.number().int().min(1).max(200).default(100) }).parse(req.query);
    const [total, data] = await Promise.all([
      prisma.simulatedNetboxVm.count(),
      prisma.simulatedNetboxVm.findMany({ orderBy: { id: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    res.json({ label: label('SIMULATION'), data, pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) } });
  });

  return router;
}
