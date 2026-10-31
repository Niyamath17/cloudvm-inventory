/**
 * Drift API.
 *   POST /drift/reports                generate a report now -> 201 { id, target, summary }
 *   GET  /drift/reports                history (paginated, no items)
 *   GET  /drift/reports/latest         newest report with items (?type=&severity=)
 *   GET  /drift/reports/:id            one report with items     (?type=&severity=)
 *   POST /drift/reports/:id/remediate  mark MISSING/RESOURCE/POWER drift for re-sync; then POST /sync
 */
import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import type { DriftService } from './drift.service.js';

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const itemQuery = z.object({
  type: z.enum(['MISSING_IN_NETBOX', 'ORPHAN_IN_NETBOX', 'RESOURCE_MISMATCH', 'POWER_STATE_MISMATCH', 'DUPLICATE']).optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
});
const idParam = z.object({ id: z.uuid() });

const label = (target: string) =>
  target === 'SIMULATION' ? 'SIMULATION – compared with the local NetBox stand-in, not a real NetBox' : 'LIVE NetBox';

export function createDriftRouter(prisma: PrismaClient, drift: DriftService): Router {
  const router = Router();

  const withItems = async (id: string | undefined, query: unknown) => {
    const q = itemQuery.parse(query);
    const report = id
      ? await prisma.driftReport.findUnique({ where: { id } })
      : await prisma.driftReport.findFirst({ orderBy: { generatedAt: 'desc' } });
    if (!report) throw new NotFoundError(id ? `Drift report ${id} not found` : 'No drift report yet');
    const items = await prisma.driftItem.findMany({
      where: { reportId: report.id, ...(q.type && { type: q.type }), ...(q.severity && { severity: q.severity }) },
      orderBy: [{ severity: 'desc' }, { type: 'asc' }, { name: 'asc' }],
    });
    return { ...report, label: label(report.target), items };
  };

  router.post('/reports', async (_req, res) => {
    const id = await drift.generate();
    const report = await prisma.driftReport.findUniqueOrThrow({ where: { id } });
    res.status(201).json({ ...report, label: label(report.target) });
  });

  router.get('/reports', async (req, res) => {
    const q = pageQuery.parse(req.query);
    const [total, data] = await Promise.all([
      prisma.driftReport.count(),
      prisma.driftReport.findMany({ orderBy: { generatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    res.json({ data: data.map((r) => ({ ...r, label: label(r.target) })), pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) } });
  });

  router.get('/reports/latest', async (req, res) => {
    res.json(await withItems(undefined, req.query));
  });

  router.get('/reports/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await withItems(id, req.query));
  });

  router.post('/reports/:id/remediate', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const result = await drift.remediate(id);
    res.json({
      ...result,
      next: 'POST /api/v1/sync to push corrections; ORPHAN and DUPLICATE findings need a manual decision (records are never deleted automatically)',
    });
  });

  return router;
}
