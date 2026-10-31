/**
 * Collection API.
 *   POST /collections      start a MANUAL collection -> 202 { runId } (409 if one is running)
 *   GET  /collections      history, newest first (paginated)
 *   GET  /collections/:id  one run with per-provider results and errors
 */
import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import type { CollectionService } from './collection.service.js';

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const idParam = z.object({ id: z.uuid() });

export function createCollectionRouter(prisma: PrismaClient, collections: CollectionService): Router {
  const router = Router();

  router.post('/', async (_req, res) => {
    const { runId } = await collections.start('MANUAL'); // CollectionInProgressError -> 409
    res.status(202).json({ runId, status: 'RUNNING', dataSource: 'MOCK' });
  });

  router.get('/', async (req, res) => {
    const q = pageQuery.parse(req.query);
    const [total, data] = await Promise.all([
      prisma.collectionRun.count(),
      prisma.collectionRun.findMany({
        orderBy: { startedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { providerResults: { orderBy: { provider: 'asc' } } },
      }),
    ]);
    res.json({ data, pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) } });
  });

  router.get('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const run = await prisma.collectionRun.findUnique({
      where: { id },
      include: { providerResults: { orderBy: { provider: 'asc' } } },
    });
    if (!run) throw new NotFoundError(`Collection run ${id} not found`);
    res.json(run);
  });

  return router;
}
