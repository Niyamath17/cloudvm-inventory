/**
 * M4 – NetBox synchronization in SIMULATION mode against the TEST database (cloudvm_test).
 * The simulated gateway is wrapped in a spy to count calls and inject failures.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';
import { CollectionService } from '../../src/modules/collection/collection.service.js';
import {
  NetBoxAuthError,
  NetBoxValidationError,
  type ClusterSpec,
  type NbVmWrite,
  type NetBoxGateway,
} from '../../src/modules/netbox/NetBoxGateway.js';
import { SimulatedNetBoxGateway } from '../../src/modules/netbox/simulated.gateway.js';
import { AWS_SAMPLE_FILE, AwsMockAdapter } from '../../src/modules/providers/mock/aws.mock-adapter.js';
import { mapAwsVm } from '../../src/modules/normalization/mappers/aws.mapper.js';
import { createMockProviders, defineProvider } from '../../src/modules/providers/registry.js';
import { SyncInProgressError, SyncService } from '../../src/modules/sync/sync.service.js';
import { createTestPrisma, resetTestDb, testDatabaseUrl } from '../helpers/test-db.js';
import { tamperedSample } from '../unit/normalization/fixtures.js';

const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

/** Counts every gateway call and can make chosen operations fail. */
class SpyGateway implements NetBoxGateway {
  readonly target = 'SIMULATION' as const;
  readonly unsupportedFields: ReadonlyArray<keyof NbVmWrite>;
  calls = 0;
  failSerial: string | null = null;
  failAll: Error | null = null;
  constructor(private readonly inner: SimulatedNetBoxGateway) {
    this.unsupportedFields = inner.unsupportedFields;
  }
  private hit() {
    this.calls += 1;
    if (this.failAll) throw this.failAll;
  }
  async prepare(c: ClusterSpec[]) { this.hit(); return this.inner.prepare(c); }
  async getVm(id: number) { this.hit(); return this.inner.getVm(id); }
  async findBySerial(s: string) { this.hit(); return this.inner.findBySerial(s); }
  async findByName(n: string, c: string) { this.hit(); return this.inner.findByName(n, c); }
  async createVm(vm: NbVmWrite) {
    this.hit();
    if (vm.serial === this.failSerial) throw new NetBoxValidationError('memory: Ensure this value is less than 2147483647 (simulated)', 400);
    return this.inner.createVm(vm);
  }
  async updateVm(id: number, p: Partial<NbVmWrite>) { this.hit(); return this.inner.updateVm(id, p); }
}

describe.skipIf(!testDatabaseUrl())('NetBox sync – SIMULATION (test database)', () => {
  let prisma: PrismaClient;
  let spy: SpyGateway;
  let sync: SyncService;
  const runOf = (id: string) => prisma.syncRun.findUniqueOrThrow({ where: { id }, include: { events: true } });
  const collect = (providers = createMockProviders()) => new CollectionService(prisma, providers, logger).run('MANUAL');
  const simBySerial = (serial: string) => prisma.simulatedNetboxVm.findMany({ where: { serial } });

  beforeAll(() => {
    prisma = createTestPrisma();
  });
  beforeEach(async () => {
    await resetTestDb(prisma);
    spy = new SpyGateway(new SimulatedNetBoxGateway(prisma));
    sync = new SyncService(prisma, spy, logger);
    await collect();
  });
  afterAll(() => prisma.$disconnect());

  it('first sync: 57 created, the never-synced terminated VM skipped, target SIMULATION', async () => {
    const run = await runOf(await sync.run());
    expect(run).toMatchObject({ target: 'SIMULATION', status: 'SUCCESS', createdCount: 57, skippedCount: 1, updatedCount: 0, failedCount: 0, duplicateCount: 0 });
    expect(await prisma.simulatedNetboxVm.count()).toBe(57);
    expect(await prisma.vmSyncState.count({ where: { target: 'SIMULATION', state: 'SYNCED' } })).toBe(57); // terminated VM never gets a state
    expect(await prisma.vmSyncState.count({ where: { target: 'NETBOX' } })).toBe(0); // never confused with real NetBox
    expect(run.events.filter((e) => e.action === 'CREATE' && e.success)).toHaveLength(57);
  });

  it('records use NetBox fields: serial, cluster, MiB memory, disk in MB, status, MOCK tags', async () => {
    await sync.run();
    const [rec] = await simBySerial('aws:123456789012/ap-south-1/i-0a1b2c3d4e5f60004'); // payments-svc-01
    expect(rec).toMatchObject({ name: 'payments-svc-01', clusterName: 'AWS/ap-south-1a', status: 'active', vcpus: 4, memory: 16384, disk: 280 * 1024, tags: ['cloudvm-managed', 'cloudvm-mock'] });
    expect((await simBySerial('aws:123456789012/ap-south-1/i-0a1b2c3d4e5f60005'))[0]?.status).toBe('offline'); // stopped
  });

  it('two VMware VMs named "app-server" in one cluster are both created (second disambiguated)', async () => {
    await sync.run();
    const apps = await prisma.simulatedNetboxVm.findMany({ where: { clusterName: 'VMWARE/Prod-Cluster-01', name: { startsWith: 'app-server' } }, orderBy: { name: 'asc' } });
    expect(apps.map((a) => a.name)).toEqual(['app-server', 'app-server (50000003)']);
  });

  it('second sync of unchanged data: 58 skipped, ZERO gateway calls, no writes', async () => {
    await sync.run();
    const before = await prisma.simulatedNetboxVm.findMany({ orderBy: { id: 'asc' } });
    spy.calls = 0;
    const run = await runOf(await sync.run());
    expect(run).toMatchObject({ status: 'SUCCESS', createdCount: 0, updatedCount: 0, decommissionedCount: 0, skippedCount: 58 });
    expect(spy.calls).toBe(1); // prepare() only, with zero clusters – no VM reads or writes
    expect(run.events).toHaveLength(0);
    expect(await prisma.simulatedNetboxVm.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('a changed VM is updated with only the changed fields recorded in the diff', async () => {
    await sync.run();
    const aws = await tamperedSample(AWS_SAMPLE_FILE, (j) => (j.Reservations[0].Instances[0].InstanceType = 'm5.xlarge')); // web-01
    await collect(createMockProviders().map((p) => (p.provider === 'AWS' ? defineProvider(new AwsMockAdapter(aws), mapAwsVm) : p)));
    const run = await runOf(await sync.run());
    expect(run).toMatchObject({ updatedCount: 1, skippedCount: 57, createdCount: 0 });
    const ev = run.events.find((e) => e.action === 'UPDATE');
    expect(ev?.diff).toEqual({ vcpus: { from: 2, to: 4 }, memory: { from: 4096, to: 16384 } }); // comments not stored by the simulation
    expect((await simBySerial('aws:123456789012/ap-south-1/i-0a1b2c3d4e5f60001'))[0]).toMatchObject({ vcpus: 4, memory: 16384 });
  });

  it('decommission -> status "decommissioning" (record kept); reactivation -> "active"', async () => {
    await sync.run();
    const serial = 'aws:123456789012/ap-south-1/i-0a1b2c3d4e5f60002'; // web-02
    const aws = await tamperedSample(AWS_SAMPLE_FILE, (j) => j.Reservations.splice(1, 1));
    await collect(createMockProviders().map((p) => (p.provider === 'AWS' ? defineProvider(new AwsMockAdapter(aws), mapAwsVm) : p)));

    const r1 = await runOf(await sync.run());
    expect(r1).toMatchObject({ decommissionedCount: 1, skippedCount: 57 });
    expect(await simBySerial(serial)).toEqual([expect.objectContaining({ status: 'decommissioning' })]);

    await collect(); // back again
    const r2 = await runOf(await sync.run());
    expect(r2.updatedCount).toBe(1);
    expect(await simBySerial(serial)).toEqual([expect.objectContaining({ status: 'active' })]);
    expect(await prisma.simulatedNetboxVm.count()).toBe(57); // never deleted, never duplicated
  });

  it('two NetBox records with our serial -> DUPLICATE, nothing written', async () => {
    const serial = 'gcp:cloudvm-demo-project/4417300000000000001';
    await prisma.simulatedNetboxVm.createMany({
      data: [
        { name: 'ml-train-01', clusterName: 'manual-a', status: 'active', serial },
        { name: 'ml-train-01-old', clusterName: 'manual-b', status: 'active', serial },
      ],
    });
    const run = await runOf(await sync.run());
    expect(run).toMatchObject({ status: 'PARTIAL', duplicateCount: 1, createdCount: 56 });
    expect(await simBySerial(serial)).toHaveLength(2);
    const vm = await prisma.virtualMachine.findFirstOrThrow({ where: { name: 'ml-train-01' }, include: { syncStates: true } });
    expect(vm.syncStates[0]).toMatchObject({ state: 'DUPLICATE', target: 'SIMULATION' });
  });

  it('an existing NetBox record without serial but same name+cluster is adopted, not duplicated', async () => {
    await prisma.simulatedNetboxVm.create({ data: { name: 'dns-01', clusterName: 'PROXMOX/pve-dc1', status: 'offline' } });
    await sync.run();
    const recs = await prisma.simulatedNetboxVm.findMany({ where: { clusterName: 'PROXMOX/pve-dc1', name: 'dns-01' } });
    expect(recs).toEqual([expect.objectContaining({ serial: 'proxmox:pve-dc1/100', status: 'active' })]);
  });

  it('stale stored id (record deleted in NetBox) -> re-created on the next change', async () => {
    await sync.run();
    const serial = 'proxmox:pve-dc1/101';
    await prisma.simulatedNetboxVm.deleteMany({ where: { serial } }); // FK SetNull clears VmSyncState.simulatedVmId
    await prisma.vmSyncState.updateMany({ where: { vm: { externalId: 'pve-dc1/101' } }, data: { syncedFingerprint: 'stale' } });
    const run = await runOf(await sync.run());
    expect(run.createdCount).toBe(1);
    expect(await simBySerial(serial)).toHaveLength(1);
  });

  it('one failing VM -> PARTIAL; only that VM is retried on the next sync', async () => {
    spy.failSerial = 'azure:00000000-aaaa-4bbb-8ccc-000000000001/6f1c9a3e-0000-4000-8000-000000000001';
    const r1 = await runOf(await sync.run());
    expect(r1).toMatchObject({ status: 'PARTIAL', failedCount: 1, createdCount: 56 });
    const failed = r1.events.find((e) => !e.success);
    expect(failed).toMatchObject({ vmName: 'crm-app-01', httpStatus: 400, error: expect.stringMatching(/simulated/) });

    spy.failSerial = null;
    const r2 = await runOf(await sync.run());
    expect(r2).toMatchObject({ status: 'SUCCESS', createdCount: 1, skippedCount: 57 });
  });

  it('authentication failure aborts the run: FAILED, no state or record written', async () => {
    spy.failAll = new NetBoxAuthError('HTTP 403 Invalid token (simulated)', 403);
    const run = await runOf(await sync.run());
    expect(run).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/403/) });
    expect(await prisma.vmSyncState.count()).toBe(0);
    expect(await prisma.simulatedNetboxVm.count()).toBe(0);
    expect(sync.isRunning).toBe(false);
  });

  it('concurrent syncs: one runs, the other is rejected', async () => {
    const results = await Promise.allSettled([sync.run(), sync.run()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(SyncInProgressError);
    expect(await prisma.syncRun.count()).toBe(1);
  });
});
