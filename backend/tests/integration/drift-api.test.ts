/** M5 – drift API over the TEST database (SIMULATION). */
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { CollectionService } from '../../src/modules/collection/collection.service.js';
import { DriftService } from '../../src/modules/drift/drift.service.js';
import { SimulatedNetBoxGateway } from '../../src/modules/netbox/simulated.gateway.js';
import { createMockProviders } from '../../src/modules/providers/registry.js';
import { SyncService } from '../../src/modules/sync/sync.service.js';
import { createTestPrisma, resetTestDb, testDatabaseUrl } from '../helpers/test-db.js';

const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

describe.skipIf(!testDatabaseUrl())('drift API (SIMULATION, test database)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof createApp>;
  let reportId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetTestDb(prisma);
    const providers = createMockProviders();
    const collections = new CollectionService(prisma, providers, logger);
    const netbox = new SimulatedNetBoxGateway(prisma);
    const sync = new SyncService(prisma, netbox, logger);
    const drift = new DriftService(prisma, netbox, logger);
    app = createApp({
      logger,
      corsOrigin: '*',
      health: { checkDatabase: async () => ({ status: 'up', latencyMs: 1 }), env: { NODE_ENV: 'test', NETBOX_MODE: 'simulation', NETBOX_URL: undefined }, version: 't', startedAt: new Date() },
      modules: { prisma, providers, collections, sync, netbox, drift },
    });
    await collections.run('MANUAL');
    await sync.run();
    await prisma.simulatedNetboxVm.updateMany({ where: { serial: 'gcp:cloudvm-demo-project/4417300000000000005' }, data: { status: 'offline' } });
    await prisma.simulatedNetboxVm.create({ data: { name: 'manual-vm', clusterName: 'X', status: 'active' } });
  });
  afterAll(() => prisma.$disconnect());

  it('GET /drift/reports/latest -> 404 before any report', async () => {
    await request(app).get('/api/v1/drift/reports/latest').expect(404);
  });

  it('POST /drift/reports -> 201 with SIMULATION label and summary', async () => {
    const r = await request(app).post('/api/v1/drift/reports').expect(201);
    reportId = r.body.id;
    expect(r.body).toMatchObject({ target: 'SIMULATION', totalItems: 2, label: expect.stringMatching(/not a real NetBox/) });
    expect(r.body.summary.byType).toMatchObject({ POWER_STATE_MISMATCH: 1, ORPHAN_IN_NETBOX: 1 });
  });

  it('GET /drift/reports/:id returns items; filters by type and severity', async () => {
    const all = await request(app).get(`/api/v1/drift/reports/${reportId}`).expect(200);
    expect(all.body.items).toHaveLength(2);
    const orphan = await request(app).get(`/api/v1/drift/reports/${reportId}?type=ORPHAN_IN_NETBOX`).expect(200);
    expect(orphan.body.items).toEqual([expect.objectContaining({ name: 'manual-vm', severity: 'INFO' })]);
    const warn = await request(app).get(`/api/v1/drift/reports/${reportId}?severity=WARNING`).expect(200);
    expect(warn.body.items).toEqual([expect.objectContaining({ name: 'analytics-db-01' })]);
    await request(app).get(`/api/v1/drift/reports/${reportId}?type=BOGUS`).expect(400);
  });

  it('GET /drift/reports and /latest', async () => {
    const list = await request(app).get('/api/v1/drift/reports').expect(200);
    expect(list.body.pagination.total).toBe(1);
    expect(list.body.data[0]).not.toHaveProperty('items');
    expect((await request(app).get('/api/v1/drift/reports/latest').expect(200)).body.id).toBe(reportId);
  });

  it('POST /drift/reports/:id/remediate then /sync fixes the power-state drift', async () => {
    const r = await request(app).post(`/api/v1/drift/reports/${reportId}/remediate`).expect(200);
    expect(r.body).toMatchObject({ markedForResync: 1, manualActionRequired: 1 });
    const started = await request(app).post('/api/v1/sync').expect(202);
    for (let i = 0; i < 100; i++) {
      const run = await request(app).get(`/api/v1/sync/runs/${started.body.syncRunId}`);
      if (run.body.status !== 'RUNNING') break;
      await new Promise((res) => setTimeout(res, 50));
    }
    const again = await request(app).post('/api/v1/drift/reports').expect(201);
    expect(again.body.summary.byType).toMatchObject({ POWER_STATE_MISMATCH: 0, ORPHAN_IN_NETBOX: 1 });
  });

  it('unknown report -> 404, malformed id -> 400', async () => {
    await request(app).get('/api/v1/drift/reports/00000000-0000-4000-8000-000000000000').expect(404);
    await request(app).get('/api/v1/drift/reports/nope').expect(400);
    await request(app).post('/api/v1/drift/reports/00000000-0000-4000-8000-000000000000/remediate').expect(404);
  });
});
