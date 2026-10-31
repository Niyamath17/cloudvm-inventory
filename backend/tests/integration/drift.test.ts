/**
 * M5 – drift detection against the SIMULATED NetBox (test database).
 * Introduce deliberate differences, detect them, remediate via sync, verify they are gone.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';
import { CollectionService } from '../../src/modules/collection/collection.service.js';
import { DriftService } from '../../src/modules/drift/drift.service.js';
import { SimulatedNetBoxGateway } from '../../src/modules/netbox/simulated.gateway.js';
import { createMockProviders } from '../../src/modules/providers/registry.js';
import { SyncService } from '../../src/modules/sync/sync.service.js';
import { createTestPrisma, resetTestDb, testDatabaseUrl } from '../helpers/test-db.js';

const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });
const S = {
  web01: 'aws:123456789012/ap-south-1/i-0a1b2c3d4e5f60001',
  analytics: 'gcp:cloudvm-demo-project/4417300000000000005',
  gitlab: 'proxmox:pve-dc1/101',
  oracle: 'vmware:vcsa01.corp.example.com/50000004-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
  web02: 'aws:123456789012/ap-south-1/i-0a1b2c3d4e5f60002',
};

describe.skipIf(!testDatabaseUrl())('drift detection – SIMULATION (test database)', () => {
  let prisma: PrismaClient;
  let sync: SyncService;
  let drift: DriftService;
  const report = (id: string) => prisma.driftReport.findUniqueOrThrow({ where: { id }, include: { items: true } });

  /** The five deliberate differences used by the demo. */
  async function introduceDrift() {
    await prisma.simulatedNetboxVm.updateMany({ where: { serial: S.web01 }, data: { memory: 1024 } }); // RESOURCE
    await prisma.simulatedNetboxVm.updateMany({ where: { serial: S.analytics }, data: { status: 'offline' } }); // POWER
    await prisma.simulatedNetboxVm.deleteMany({ where: { serial: S.gitlab } }); // MISSING
    await prisma.simulatedNetboxVm.create({ data: { name: 'legacy-vm-x', clusterName: 'AWS/ap-south-1a', status: 'active', serial: 'aws:123456789012/ap-south-1/i-deadbeef00000000' } }); // ORPHAN
    await prisma.simulatedNetboxVm.create({ data: { name: 'oracle-db-01-copy', clusterName: 'VMWARE/Prod-Cluster-01', status: 'active', serial: S.oracle } }); // DUPLICATE
  }

  beforeAll(() => {
    prisma = createTestPrisma();
  });
  beforeEach(async () => {
    await resetTestDb(prisma);
    const gw = new SimulatedNetBoxGateway(prisma);
    sync = new SyncService(prisma, gw, logger);
    drift = new DriftService(prisma, gw, logger);
    await new CollectionService(prisma, createMockProviders(), logger).run('MANUAL');
  });
  afterAll(() => prisma.$disconnect());

  it('before any sync: 57 ACTIVE VMs are MISSING_IN_NETBOX (terminated one is not drift)', async () => {
    const r = await report(await drift.generate());
    expect(r).toMatchObject({ target: 'SIMULATION', totalItems: 57 });
    expect(r.items.every((i) => i.type === 'MISSING_IN_NETBOX')).toBe(true);
  });

  it('after a clean sync: zero findings', async () => {
    await sync.run();
    const r = await report(await drift.generate());
    expect(r).toMatchObject({ target: 'SIMULATION', totalItems: 0 });
    expect(r.summary).toMatchObject({ comparedLocal: 58, comparedRemote: 57 });
  });

  it('detects the five deliberate differences with type, severity and VM links', async () => {
    await sync.run();
    await introduceDrift();
    const r = await report(await drift.generate());
    const by = (type: string) => r.items.filter((i) => i.type === type);

    expect(r.totalItems).toBe(5);
    expect(r.summary).toMatchObject({
      byType: { MISSING_IN_NETBOX: 1, ORPHAN_IN_NETBOX: 1, RESOURCE_MISMATCH: 1, POWER_STATE_MISMATCH: 1, DUPLICATE: 1 },
      bySeverity: { INFO: 0, WARNING: 4, CRITICAL: 1 },
    });
    expect(by('RESOURCE_MISMATCH')[0]).toMatchObject({ name: 'web-01', field: 'memory', expected: '4096', actual: '1024', severity: 'WARNING' });
    expect(by('POWER_STATE_MISMATCH')[0]).toMatchObject({ name: 'analytics-db-01', expected: 'active', actual: 'offline' });
    expect(by('MISSING_IN_NETBOX')[0]).toMatchObject({ name: 'gitlab-01', remoteId: null });
    expect(by('ORPHAN_IN_NETBOX')[0]).toMatchObject({ name: 'legacy-vm-x', vmId: null, severity: 'WARNING' });
    expect(by('DUPLICATE')[0]).toMatchObject({ name: 'oracle-db-01', severity: 'CRITICAL' });
    for (const t of ['RESOURCE_MISMATCH', 'POWER_STATE_MISMATCH', 'MISSING_IN_NETBOX', 'DUPLICATE']) expect(by(t)[0]?.vmId).toBeTruthy();
  });

  it('remediate + sync fixes MISSING/RESOURCE/POWER; orphan and duplicate stay until removed manually', async () => {
    await sync.run();
    await introduceDrift();
    const r1 = await drift.generate();

    expect(await drift.remediate(r1)).toEqual({ markedForResync: 3, manualActionRequired: 2 });
    const s = await prisma.syncRun.findUniqueOrThrow({ where: { id: await sync.run() } });
    expect(s).toMatchObject({ target: 'SIMULATION', updatedCount: 2, createdCount: 1, failedCount: 0 });

    const r2 = await report(await drift.generate());
    expect(r2.items.map((i) => i.type).sort()).toEqual(['DUPLICATE', 'ORPHAN_IN_NETBOX']);
    expect(await prisma.simulatedNetboxVm.count({ where: { name: 'legacy-vm-x' } })).toBe(1); // never auto-deleted

    // operator decision: remove the orphan and the duplicate copy
    await prisma.simulatedNetboxVm.deleteMany({ where: { name: { in: ['legacy-vm-x', 'oracle-db-01-copy'] } } });
    expect((await report(await drift.generate())).totalItems).toBe(0);
  });

  it('a VM decommissioned in the cloud but still "active" in NetBox is CRITICAL until synced', async () => {
    await sync.run();
    await prisma.virtualMachine.updateMany({
      where: { externalId: '123456789012/ap-south-1/i-0a1b2c3d4e5f60002' },
      data: { lifecycle: 'DECOMMISSIONED', decommissionReason: 'MISSING_FROM_PROVIDER', decommissionedAt: new Date(), powerState: 'UNKNOWN', fingerprint: 'changed' },
    });
    const r = await report(await drift.generate());
    expect(r.items).toEqual([expect.objectContaining({ type: 'POWER_STATE_MISMATCH', severity: 'CRITICAL', expected: 'decommissioning', actual: 'active' })]);
    await sync.run(); // fingerprint changed -> DECOMMISSION
    expect((await prisma.simulatedNetboxVm.findFirstOrThrow({ where: { serial: S.web02 } })).status).toBe('decommissioning');
    expect((await report(await drift.generate())).totalItems).toBe(0);
  });

  it('reports are persisted with items and can be listed', async () => {
    await drift.generate();
    await drift.generate();
    expect(await prisma.driftReport.count({ where: { target: 'SIMULATION' } })).toBe(2);
    expect(await prisma.driftItem.count()).toBe(114);
  });
});
