/**
 * M3 – HTTP API over a real collection in the TEST database (cloudvm_test).
 */
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { CollectionService } from '../../src/modules/collection/collection.service.js';
import { createMockProviders } from '../../src/modules/providers/registry.js';
import { createTestPrisma, resetTestDb, testDatabaseUrl } from '../helpers/test-db.js';

const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

describe.skipIf(!testDatabaseUrl())('inventory / collection / dashboard API (test database)', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof createApp>;
  let runId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetTestDb(prisma);
    const providers = createMockProviders();
    const collections = new CollectionService(prisma, providers, logger);
    app = createApp({
      logger,
      corsOrigin: 'http://localhost:5173',
      health: { checkDatabase: async () => ({ status: 'up', latencyMs: 1 }), env: { NODE_ENV: 'test', NETBOX_MODE: 'simulation', NETBOX_URL: undefined }, version: 't', startedAt: new Date() },
      modules: { prisma, providers, collections },
    });

    // Start through the API, then wait for the background run to finish.
    const started = await request(app).post('/api/v1/collections').expect(202);
    runId = started.body.runId;
    expect(started.body).toMatchObject({ status: 'RUNNING', dataSource: 'MOCK' });
    for (let i = 0; i < 100; i++) {
      const r = await request(app).get(`/api/v1/collections/${runId}`);
      if (r.body.status !== 'RUNNING') break;
      await new Promise((res) => setTimeout(res, 100));
    }
  });
  afterAll(() => prisma.$disconnect());

  it('POST /collections returned a run that completed SUCCESS', async () => {
    const r = await request(app).get(`/api/v1/collections/${runId}`).expect(200);
    expect(r.body).toMatchObject({ status: 'SUCCESS', createdCount: 58 });
    expect(r.body.providerResults).toHaveLength(5);
  });

  it('a second POST while running returns 409 CONFLICT', async () => {
    const svc = new CollectionService(prisma, createMockProviders(), logger);
    const localApp = createApp({
      logger,
      corsOrigin: '*',
      health: { checkDatabase: async () => ({ status: 'up', latencyMs: 1 }), env: { NODE_ENV: 'test', NETBOX_MODE: 'simulation', NETBOX_URL: undefined }, version: 't', startedAt: new Date() },
      modules: { prisma, providers: createMockProviders(), collections: svc },
    });
    const first = svc.start('MANUAL');
    const res = await request(localApp).post('/api/v1/collections');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    await (await first).done;
  });

  it('GET /collections lists runs newest first', async () => {
    const r = await request(app).get('/api/v1/collections').expect(200);
    expect(r.body.pagination.total).toBeGreaterThanOrEqual(1);
    expect(r.body.data[0].providerResults).toBeDefined();
  });

  it('GET /vms paginates (default 25) and omits rawData', async () => {
    const p1 = await request(app).get('/api/v1/vms').expect(200);
    expect(p1.body.pagination).toEqual({ page: 1, pageSize: 25, total: 58, totalPages: 3 });
    expect(p1.body.data).toHaveLength(25);
    expect(p1.body.data[0]).not.toHaveProperty('rawData');
    const p3 = await request(app).get('/api/v1/vms?page=3').expect(200);
    expect(p3.body.data).toHaveLength(8);
  });

  it('filters by provider, lifecycle and power state', async () => {
    expect((await request(app).get('/api/v1/vms?provider=PROXMOX')).body.pagination.total).toBe(9);
    expect((await request(app).get('/api/v1/vms?provider=aws,gcp')).body.pagination.total).toBe(26);
    const dec = await request(app).get('/api/v1/vms?lifecycle=DECOMMISSIONED');
    expect(dec.body.data.map((v: { name: string }) => v.name)).toEqual(['legacy-report-01']);
    expect((await request(app).get('/api/v1/vms?powerState=SUSPENDED')).body.pagination.total).toBe(2);
  });

  it('searches by name, hostname and exact IP', async () => {
    expect((await request(app).get('/api/v1/vms?search=app-server')).body.pagination.total).toBe(2);
    const byIp = await request(app).get('/api/v1/vms?search=10.80.1.10');
    expect(byIp.body.data.map((v: { name: string }) => v.name)).toEqual(['dns-01']);
    expect((await request(app).get('/api/v1/vms?search=CORP.EXAMPLE.COM')).body.pagination.total).toBeGreaterThan(0);
  });

  it('sorts with NULLs last and a stable tie-breaker', async () => {
    const r = await request(app).get('/api/v1/vms?sortBy=memoryMb&sortOrder=desc&pageSize=3').expect(200);
    expect(r.body.data[0]).toMatchObject({ name: 'oracle-db-01', memoryMb: 65536 });
  });

  it('rejects invalid query parameters with 400', async () => {
    const r = await request(app).get('/api/v1/vms?provider=ORACLE&pageSize=1000').expect(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /vms/:id returns detail with rawData; unknown id 404; malformed id 400', async () => {
    const list = await request(app).get('/api/v1/vms?search=gitlab-01');
    const id = list.body.data[0].id;
    const detail = await request(app).get(`/api/v1/vms/${id}`).expect(200);
    expect(detail.body).toMatchObject({ externalId: 'pve-dc1/101', dataSource: 'MOCK' });
    expect(detail.body.rawData).toBeDefined();
    await request(app).get('/api/v1/vms/00000000-0000-4000-8000-000000000000').expect(404);
    await request(app).get('/api/v1/vms/not-a-uuid').expect(400);
  });

  it('GET /vms/facets returns filter values', async () => {
    const r = await request(app).get('/api/v1/vms/facets').expect(200);
    expect(r.body.providers).toEqual([
      { value: 'AWS', count: 14 },
      { value: 'AZURE', count: 12 },
      { value: 'GCP', count: 12 },
      { value: 'PROXMOX', count: 9 },
      { value: 'VMWARE', count: 11 },
    ]);
    expect(r.body.regions).toContain('ap-south-1');
    expect(r.body.owners).toContain('web-team');
  });

  it('GET /dashboard/summary counts power states for ACTIVE VMs only', async () => {
    const r = await request(app).get('/api/v1/dashboard/summary').expect(200);
    expect(r.body.dataSource).toBe('MOCK');
    expect(r.body.vms).toEqual({ total: 58, active: 57, running: 39, stopped: 13, suspended: 2, unknown: 3, decommissioned: 1 });
    expect(r.body.providers).toHaveLength(5);
    expect(r.body.resources.memoryMb).toBeGreaterThan(0);
    expect(r.body.lastCollection.status).toBe('SUCCESS');
    expect(r.body.lastSync).toBeNull();
  });

  it('GET /providers lists five MOCK adapters with their last result', async () => {
    const r = await request(app).get('/api/v1/providers').expect(200);
    expect(r.body.data).toHaveLength(5);
    for (const p of r.body.data) {
      expect(p.dataSource).toBe('MOCK');
      expect(p.label).toMatch(/MOCK/);
      expect(p.lastResult.status).toBe('SUCCESS');
    }
  });
});
