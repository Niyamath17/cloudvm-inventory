/**
 * M4 – sync + NetBox API over the TEST database (SIMULATION mode).
 */
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { CollectionService } from '../../src/modules/collection/collection.service.js';
import { SimulatedNetBoxGateway } from '../../src/modules/netbox/simulated.gateway.js';
import { createMockProviders } from '../../src/modules/providers/registry.js';
import { SyncService } from '../../src/modules/sync/sync.service.js';
import { createTestPrisma, resetTestDb, testDatabaseUrl } from '../helpers/test-db.js';

const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

describe.skipIf(!testDatabaseUrl())('sync / netbox API (SIMULATION, test database)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof createApp>;
  let sync: SyncService;
  let syncRunId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetTestDb(prisma);
    const providers = createMockProviders();
    const collections = new CollectionService(prisma, providers, logger);
    const netbox = new SimulatedNetBoxGateway(prisma);
    sync = new SyncService(prisma, netbox, logger);
    app = createApp({
      logger,
      corsOrigin: '*',
      health: { checkDatabase: async () => ({ status: 'up', latencyMs: 1 }), env: { NODE_ENV: 'test', NETBOX_MODE: 'simulation', NETBOX_URL: undefined }, version: 't', startedAt: new Date() },
      modules: { prisma, providers, collections, sync, netbox },
    });
    await collections.run('MANUAL');
    const res = await request(app).post('/api/v1/sync').expect(202);
    expect(res.body).toMatchObject({ status: 'RUNNING', target: 'SIMULATION', label: expect.stringMatching(/no real NetBox/) });
    syncRunId = res.body.syncRunId;
    for (let i = 0; i < 100 && sync.isRunning; i++) await new Promise((r) => setTimeout(r, 50));
  });
  afterAll(() => prisma.$disconnect());

  it('GET /sync/runs/:id returns the completed SIMULATION run with events', async () => {
    const r = await request(app).get(`/api/v1/sync/runs/${syncRunId}`).expect(200);
    expect(r.body).toMatchObject({ target: 'SIMULATION', status: 'SUCCESS', createdCount: 57, skippedCount: 1 });
    expect(r.body.events).toHaveLength(57);
    expect(r.body.label).toMatch(/SIMULATION/);
  });

  it('POST /sync while a sync is running -> 409', async () => {
    const first = sync.start();
    const res = await request(app).post('/api/v1/sync');
    expect(res.status).toBe(409);
    await (await first).done;
  });

  it('GET /sync/runs lists runs', async () => {
    const r = await request(app).get('/api/v1/sync/runs').expect(200);
    expect(r.body.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /netbox/status reports SIMULATION, never a real NetBox', async () => {
    const r = await request(app).get('/api/v1/netbox/status').expect(200);
    expect(r.body).toMatchObject({ mode: 'SIMULATION', target: 'SIMULATION', simulatedRecords: 57 });
    expect(r.body).not.toHaveProperty('reachable');
  });

  it('GET /netbox/simulated-vms lists the simulated records', async () => {
    const r = await request(app).get('/api/v1/netbox/simulated-vms').expect(200);
    expect(r.body.pagination.total).toBe(57);
    expect(r.body.label).toMatch(/SIMULATION/);
  });

  it('GET /dashboard/summary shows the last sync, flagged as simulated', async () => {
    const r = await request(app).get('/api/v1/dashboard/summary').expect(200);
    expect(r.body.lastSync).toMatchObject({ target: 'SIMULATION', simulated: true, status: 'SUCCESS' });
  });

  it('unknown sync run -> 404, malformed id -> 400', async () => {
    await request(app).get('/api/v1/sync/runs/00000000-0000-4000-8000-000000000000').expect(404);
    await request(app).get('/api/v1/sync/runs/nope').expect(400);
  });
});
