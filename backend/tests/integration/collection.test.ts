/**
 * M3 – collection, persistence, reconciliation and locking against a real PostgreSQL
 * TEST database (cloudvm_test, truncated between tests).
 *
 * Scenarios: first run, idempotent re-run (no row rewrites), data change, account-scoped
 * decommission, reactivation, failed provider, partial provider, scoping by account,
 * AWS terminated handling, concurrent runs, database guard and stale runs.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CollectionInProgressError, CollectionService, STALE_AFTER_MS } from '../../src/modules/collection/collection.service.js';
import { createLogger } from '../../src/lib/logger.js';
import { mapAwsVm } from '../../src/modules/normalization/mappers/aws.mapper.js';
import { mapAzureVm } from '../../src/modules/normalization/mappers/azure.mapper.js';
import { mapGcpVm } from '../../src/modules/normalization/mappers/gcp.mapper.js';
import { mapProxmoxVm } from '../../src/modules/normalization/mappers/proxmox.mapper.js';
import { mapVmwareVm } from '../../src/modules/normalization/mappers/vmware.mapper.js';
import { AWS_SAMPLE_FILE, AwsMockAdapter } from '../../src/modules/providers/mock/aws.mock-adapter.js';
import { AZURE_SAMPLE_FILE, AzureMockAdapter } from '../../src/modules/providers/mock/azure.mock-adapter.js';
import { GCP_SAMPLE_FILE, GcpMockAdapter } from '../../src/modules/providers/mock/gcp.mock-adapter.js';
import { PROXMOX_SAMPLE_FILE, ProxmoxMockAdapter } from '../../src/modules/providers/mock/proxmox.mock-adapter.js';
import { VMWARE_SAMPLE_FILE, VmwareMockAdapter } from '../../src/modules/providers/mock/vmware.mock-adapter.js';
import { defineProvider, type RegisteredProvider } from '../../src/modules/providers/registry.js';
import { createTestPrisma, resetTestDb, testDatabaseUrl } from '../helpers/test-db.js';
import { tamperedSample } from '../unit/normalization/fixtures.js';

const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

type Dirs = Partial<Record<'aws' | 'azure' | 'gcp' | 'proxmox' | 'vmware', string>>;
/** The five MOCK providers; any provider can point at a tampered copy of its sample file. */
const providers = (dirs: Dirs = {}): RegisteredProvider[] => [
  defineProvider(new AwsMockAdapter(dirs.aws), mapAwsVm),
  defineProvider(new AzureMockAdapter(dirs.azure), mapAzureVm),
  defineProvider(new GcpMockAdapter(dirs.gcp), mapGcpVm),
  defineProvider(new ProxmoxMockAdapter(dirs.proxmox), mapProxmoxVm),
  defineProvider(new VmwareMockAdapter(dirs.vmware), mapVmwareVm),
];
const failing = (provider: 'GCP'): RegisteredProvider => ({
  provider,
  dataSource: 'MOCK',
  collectAndNormalize: async () => {
    throw new Error(`${provider} source unreachable (simulated failure)`);
  },
});

describe.skipIf(!testDatabaseUrl())('collection + inventory persistence (test database)', () => {
  let prisma: PrismaClient;
  const service = (list: RegisteredProvider[] = providers()) => new CollectionService(prisma, list, logger);
  const runOf = (id: string) => prisma.collectionRun.findUniqueOrThrow({ where: { id }, include: { providerResults: true } });
  const vm = (provider: 'AWS' | 'AZURE' | 'PROXMOX' | 'GCP' | 'VMWARE', externalId: string) =>
    prisma.virtualMachine.findUniqueOrThrow({ where: { provider_externalId: { provider, externalId } } });
  const resultOf = (run: Awaited<ReturnType<typeof runOf>>, provider: string) => run.providerResults.find((r) => r.provider === provider);

  beforeAll(() => {
    prisma = createTestPrisma();
  });
  beforeEach(() => resetTestDb(prisma));
  afterAll(() => prisma.$disconnect());

  it('first run: 58 VMs created, 5 providers SUCCESS, run SUCCESS', async () => {
    const run = await runOf(await service().run('MANUAL'));
    expect(run).toMatchObject({ status: 'SUCCESS', trigger: 'MANUAL', discoveredCount: 58, createdCount: 58, updatedCount: 0, unchangedCount: 0, decommissionedCount: 0, invalidCount: 0 });
    expect(run.providerResults.map((r) => [r.provider, r.status, r.vmCount, r.dataSource]).sort()).toEqual([
      ['AWS', 'SUCCESS', 14, 'MOCK'],
      ['AZURE', 'SUCCESS', 12, 'MOCK'],
      ['GCP', 'SUCCESS', 12, 'MOCK'],
      ['PROXMOX', 'SUCCESS', 9, 'MOCK'],
      ['VMWARE', 'SUCCESS', 11, 'MOCK'],
    ]);
    expect(await prisma.virtualMachine.count()).toBe(58);
    expect(await prisma.virtualMachine.count({ where: { dataSource: 'MOCK' } })).toBe(58);
  });

  it('second identical run: 58 unchanged, no row rewritten (updatedAt untouched), heartbeat advanced', async () => {
    await service().run('MANUAL');
    const before = await prisma.virtualMachine.findMany({ orderBy: { id: 'asc' } });

    const run = await runOf(await service().run('MANUAL'));
    expect(run).toMatchObject({ status: 'SUCCESS', createdCount: 0, updatedCount: 0, unchangedCount: 58, decommissionedCount: 0 });

    const after = await prisma.virtualMachine.findMany({ orderBy: { id: 'asc' } });
    expect(after).toHaveLength(58);
    after.forEach((row, i) => {
      const prev = before[i]!;
      expect(row.updatedAt).toEqual(prev.updatedAt); // data row not rewritten
      expect(row.fingerprint).toBe(prev.fingerprint);
      expect(row.lastDiscoveredAt.getTime()).toBeGreaterThan(prev.lastDiscoveredAt.getTime()); // heartbeat
      expect(row.firstDiscoveredAt).toEqual(prev.firstDiscoveredAt);
    });
  });

  it('AWS terminated instance stays DECOMMISSIONED with its original timestamp', async () => {
    await service().run('MANUAL');
    const first = await vm('AWS', '123456789012/eu-west-1/i-0a1b2c3d4e5f60012');
    expect(first).toMatchObject({ lifecycle: 'DECOMMISSIONED', decommissionReason: 'PROVIDER_TERMINATED', powerState: 'UNKNOWN' });
    await service().run('MANUAL');
    expect((await vm('AWS', '123456789012/eu-west-1/i-0a1b2c3d4e5f60012')).decommissionedAt).toEqual(first.decommissionedAt);
  });

  it('a changed VM is updated, everything else unchanged', async () => {
    await service().run('MANUAL');
    const aws = await tamperedSample(AWS_SAMPLE_FILE, (j) => {
      j.Reservations[0].Instances[0].InstanceType = 'm5.xlarge'; // web-01: 2 -> 4 vCPU, 4096 -> 16384 MiB
    });
    const run = await runOf(await service(providers({ aws })).run('MANUAL'));
    expect(run).toMatchObject({ updatedCount: 1, unchangedCount: 57, createdCount: 0, decommissionedCount: 0 });
    expect(await vm('AWS', '123456789012/ap-south-1/i-0a1b2c3d4e5f60001')).toMatchObject({ cpuCores: 4, memoryMb: 16384 });
  });

  it('VM missing from a SUCCESSFUL collection -> DECOMMISSIONED (MISSING_FROM_PROVIDER); returns -> reactivated', async () => {
    await service().run('MANUAL');
    const web02 = '123456789012/ap-south-1/i-0a1b2c3d4e5f60002';
    const aws = await tamperedSample(AWS_SAMPLE_FILE, (j) => j.Reservations.splice(1, 1)); // remove web-02

    const r1 = await runOf(await service(providers({ aws })).run('MANUAL'));
    expect(r1).toMatchObject({ status: 'SUCCESS', decommissionedCount: 1, unchangedCount: 57 });
    const gone = await vm('AWS', web02);
    expect(gone).toMatchObject({ lifecycle: 'DECOMMISSIONED', decommissionReason: 'MISSING_FROM_PROVIDER', powerState: 'UNKNOWN', rawPowerState: 'running' });
    expect(gone.decommissionedAt).not.toBeNull();

    // the same missing VM is not "decommissioned" again on the next run
    const r2 = await runOf(await service(providers({ aws })).run('MANUAL'));
    expect(r2).toMatchObject({ decommissionedCount: 0, unchangedCount: 57 });

    // it comes back -> reactivated
    const r3 = await runOf(await service().run('MANUAL'));
    expect(r3).toMatchObject({ updatedCount: 1, unchangedCount: 57, decommissionedCount: 0 });
    expect(await vm('AWS', web02)).toMatchObject({ lifecycle: 'ACTIVE', decommissionReason: null, decommissionedAt: null, powerState: 'RUNNING' });
  });

  it('a FAILED provider writes nothing and decommissions nothing; other providers proceed', async () => {
    await service().run('MANUAL');
    const list = providers().map((p) => (p.provider === 'GCP' ? failing('GCP') : p));
    const run = await runOf(await service(list).run('MANUAL'));

    expect(run.status).toBe('PARTIAL');
    expect(resultOf(run, 'GCP')).toMatchObject({ status: 'FAILED', vmCount: 0, error: expect.stringMatching(/unreachable/) });
    expect(resultOf(run, 'AWS')?.status).toBe('SUCCESS');
    expect(run).toMatchObject({ unchangedCount: 46, decommissionedCount: 0 });
    expect(await prisma.virtualMachine.count({ where: { provider: 'GCP', lifecycle: 'ACTIVE' } })).toBe(12);
    expect(run.errors).toEqual([expect.objectContaining({ provider: 'GCP' })]);
  });

  it('first-ever run with a failed provider: that provider simply has no VMs yet', async () => {
    const list = providers().map((p) => (p.provider === 'GCP' ? failing('GCP') : p));
    const run = await runOf(await service(list).run('MANUAL'));
    expect(run).toMatchObject({ status: 'PARTIAL', createdCount: 46 });
    expect(await prisma.virtualMachine.count({ where: { provider: 'GCP' } })).toBe(0);
  });

  it('a PARTIAL provider (invalid record) upserts valid VMs but decommissions nothing', async () => {
    await service().run('MANUAL');
    const aws = await tamperedSample(AWS_SAMPLE_FILE, (j) => {
      j.Reservations[0].Instances[0].InstanceId = 'BROKEN'; // web-01 invalid (raw shape)
      j.Reservations.splice(1, 1); // web-02 gone
      j.Reservations[2].Instances[0].InstanceType = 'm5.large'; // payments-svc-01: a real change, still applied
    });
    const run = await runOf(await service(providers({ aws })).run('MANUAL'));

    expect(resultOf(run, 'AWS')).toMatchObject({ status: 'PARTIAL', vmCount: 12, invalidCount: 1, error: expect.stringMatching(/decommission check skipped/) });
    expect(run).toMatchObject({ status: 'PARTIAL', decommissionedCount: 0, updatedCount: 1, invalidCount: 1 });
    expect((await vm('AWS', '123456789012/ap-south-1/i-0a1b2c3d4e5f60001')).lifecycle).toBe('ACTIVE'); // invalid one untouched
    expect((await vm('AWS', '123456789012/ap-south-1/i-0a1b2c3d4e5f60002')).lifecycle).toBe('ACTIVE'); // missing one NOT decommissioned
  });

  it('reconciliation is scoped to the accounts actually collected (Proxmox clusters)', async () => {
    await service().run('MANUAL');
    const proxmox = await tamperedSample(PROXMOX_SAMPLE_FILE, (j) => {
      j.clusters.splice(1, 1); // pve-lab not collected this time
      j.clusters[0].data.splice(1, 1); // gitlab-01 (pve-dc1/101) gone from pve-dc1
    });
    const run = await runOf(await service(providers({ proxmox })).run('MANUAL'));

    expect(resultOf(run, 'PROXMOX')).toMatchObject({ status: 'SUCCESS', vmCount: 5 });
    expect(run.decommissionedCount).toBe(1);
    expect(await vm('PROXMOX', 'pve-dc1/101')).toMatchObject({ lifecycle: 'DECOMMISSIONED', decommissionReason: 'MISSING_FROM_PROVIDER' });
    expect(await prisma.virtualMachine.count({ where: { provider: 'PROXMOX', account: 'pve-lab', lifecycle: 'ACTIVE' } })).toBe(3);
  });

  it('two concurrent runs: exactly one runs, the other is rejected', async () => {
    const svc = service();
    const results = await Promise.allSettled([svc.run('MANUAL'), svc.run('MANUAL')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(CollectionInProgressError);
    expect(await prisma.collectionRun.count()).toBe(1);
    expect(await prisma.virtualMachine.count()).toBe(58);
    expect(svc.isRunning).toBe(false); // lock released
  });

  it('a RUNNING run in the database (another process) blocks a new run', async () => {
    await prisma.collectionRun.create({ data: { trigger: 'SCHEDULED', status: 'RUNNING' } });
    await expect(service().run('MANUAL')).rejects.toBeInstanceOf(CollectionInProgressError);
    expect(await prisma.collectionRun.count()).toBe(1);
  });

  it('a stale RUNNING run (crashed process) is closed as FAILED and does not block', async () => {
    const stale = await prisma.collectionRun.create({
      data: { trigger: 'SCHEDULED', status: 'RUNNING', startedAt: new Date(Date.now() - STALE_AFTER_MS - 60_000) },
    });
    const run = await runOf(await service().run('MANUAL'));
    expect(run.status).toBe('SUCCESS');
    expect((await runOf(stale.id)).status).toBe('FAILED');
  });

  it('the lock is released after a run in which every provider failed', async () => {
    const svc = service([failing('GCP')]);
    const run = await runOf(await svc.run('MANUAL'));
    expect(run.status).toBe('FAILED');
    expect(svc.isRunning).toBe(false);
    await expect(svc.run('MANUAL')).resolves.toBeTypeOf('string');
  });

  // ─── Account-level reconciliation regression tests (zero-VM accounts) ─────────────
  const active = (provider: 'AWS' | 'AZURE' | 'GCP' | 'PROXMOX' | 'VMWARE', account?: string) =>
    prisma.virtualMachine.count({ where: { provider, lifecycle: 'ACTIVE', ...(account ? { account } : {}) } });

  describe('account-level reconciliation', () => {
    it.each([
      ['AWS', 'aws', AWS_SAMPLE_FILE, (j: any) => (j.Reservations = []), 13], // 14 minus the already-terminated one
      ['AZURE', 'azure', AZURE_SAMPLE_FILE, (j: any) => (j.value = []), 12],
      ['GCP', 'gcp', GCP_SAMPLE_FILE, (j: any) => (j.items = {}), 12],
      ['VMWARE', 'vmware', VMWARE_SAMPLE_FILE, (j: any) => (j.vms = []), 11],
    ] as const)(
      '1. %s: a successfully queried account returning ZERO VMs decommissions its VMs',
      async (provider, key, file, mutate, expected) => {
        await service().run('MANUAL');
        const dir = await tamperedSample(file, mutate);
        const run = await runOf(await service(providers({ [key]: dir })).run('MANUAL'));

        expect(resultOf(run, provider)).toMatchObject({ status: 'SUCCESS', vmCount: 0 });
        expect(run).toMatchObject({ status: 'SUCCESS', decommissionedCount: expected, unchangedCount: 58 - (provider === 'AWS' ? 14 : expected) });
        expect(await active(provider)).toBe(0);
        const reasons = await prisma.virtualMachine.groupBy({ by: ['decommissionReason'], where: { provider }, _count: { _all: true } });
        expect(reasons.find((r) => r.decommissionReason === 'MISSING_FROM_PROVIDER')?._count._all).toBe(expected);
        expect(await prisma.virtualMachine.count({ where: { lifecycle: 'ACTIVE' } })).toBe(57 - expected); // other providers untouched
      },
    );

    it('1. PROXMOX: one cluster returning ZERO VMs decommissions only that cluster', async () => {
      await service().run('MANUAL');
      const proxmox = await tamperedSample(PROXMOX_SAMPLE_FILE, (j) => (j.clusters[1].data = []));
      const run = await runOf(await service(providers({ proxmox })).run('MANUAL'));
      expect(resultOf(run, 'PROXMOX')).toMatchObject({ status: 'SUCCESS', vmCount: 6 });
      expect(run.decommissionedCount).toBe(3);
      expect(await active('PROXMOX', 'pve-lab')).toBe(0);
      expect(await active('PROXMOX', 'pve-dc1')).toBe(6);
    });

    it('1b. zero-VM account that comes back is reactivated', async () => {
      await service().run('MANUAL');
      await service(providers({ vmware: await tamperedSample(VMWARE_SAMPLE_FILE, (j) => (j.vms = [])) })).run('MANUAL');
      expect(await active('VMWARE')).toBe(0);
      const run = await runOf(await service().run('MANUAL'));
      expect(run).toMatchObject({ updatedCount: 11, decommissionedCount: 0 });
      expect(await active('VMWARE')).toBe(11);
    });

    it('2. a FAILED account never decommissions its VMs (provider FAILED)', async () => {
      await service().run('MANUAL');
      const aws = await tamperedSample(AWS_SAMPLE_FILE, (j) => {
        j.accounts[0].error = 'AccessDenied (simulated)';
        j.Reservations = []; // even with no data, a failed query proves nothing
      });
      const run = await runOf(await service(providers({ aws })).run('MANUAL'));
      expect(resultOf(run, 'AWS')).toMatchObject({ status: 'FAILED', vmCount: 0, error: expect.stringMatching(/account query failed: AccessDenied/) });
      expect(run).toMatchObject({ status: 'PARTIAL', decommissionedCount: 0 });
      expect(await active('AWS')).toBe(13);
      expect(run.errors).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'AWS', stage: 'account', ref: '123456789012' })]));
    });

    it('2. a FAILED cluster is untouched while its healthy sibling is reconciled', async () => {
      await service().run('MANUAL');
      const proxmox = await tamperedSample(PROXMOX_SAMPLE_FILE, (j) => {
        j.clusters[1].error = 'connection timed out (simulated)'; // pve-lab failed
        j.clusters[0].data.splice(1, 1); // gitlab-01 removed from healthy pve-dc1
      });
      const run = await runOf(await service(providers({ proxmox })).run('MANUAL'));
      expect(resultOf(run, 'PROXMOX')).toMatchObject({ status: 'PARTIAL', vmCount: 5 });
      expect(run.decommissionedCount).toBe(1);
      expect(await vm('PROXMOX', 'pve-dc1/101')).toMatchObject({ lifecycle: 'DECOMMISSIONED', decommissionReason: 'MISSING_FROM_PROVIDER' });
      expect(await active('PROXMOX', 'pve-lab')).toBe(3);
    });

    it('2. a FAILED vCenter never decommissions its VMs', async () => {
      await service().run('MANUAL');
      const vmware = await tamperedSample(VMWARE_SAMPLE_FILE, (j) => (j.error = '503 vCenter unavailable (simulated)'));
      const run = await runOf(await service(providers({ vmware })).run('MANUAL'));
      expect(resultOf(run, 'VMWARE')?.status).toBe('FAILED');
      expect(await active('VMWARE')).toBe(11);
    });

    it('3. a PARTIAL account (invalid record) is not reconciled; a clean sibling account is', async () => {
      await service().run('MANUAL');
      const proxmox = await tamperedSample(PROXMOX_SAMPLE_FILE, (j) => {
        j.clusters[1].data[2].maxmem = 'lots'; // pve-lab/102 invalid
        j.clusters[1].data.splice(1, 1); // pve-lab/101 removed – must NOT be decommissioned
        j.clusters[0].data.splice(1, 1); // pve-dc1/101 removed – must be decommissioned
      });
      const run = await runOf(await service(providers({ proxmox })).run('MANUAL'));
      expect(resultOf(run, 'PROXMOX')).toMatchObject({ status: 'PARTIAL', invalidCount: 1, error: expect.stringMatching(/pve-lab: account returned invalid records/) });
      expect(run.decommissionedCount).toBe(1);
      expect((await vm('PROXMOX', 'pve-dc1/101')).lifecycle).toBe('DECOMMISSIONED');
      expect((await vm('PROXMOX', 'pve-lab/101')).lifecycle).toBe('ACTIVE');
      expect((await vm('PROXMOX', 'pve-lab/102')).lifecycle).toBe('ACTIVE');
    });

    it('3. a PARTIAL zero-VM-looking account (only invalid records) is not reconciled', async () => {
      await service().run('MANUAL');
      const gcp = await tamperedSample(GCP_SAMPLE_FILE, (j) => {
        for (const zone of Object.values(j.items) as any[]) for (const i of zone.instances) i.disks[0].diskSizeGb = 'lots';
      });
      const run = await runOf(await service(providers({ gcp })).run('MANUAL'));
      expect(resultOf(run, 'GCP')).toMatchObject({ status: 'PARTIAL', vmCount: 0, invalidCount: 12 });
      expect(await active('GCP')).toBe(12);
    });

    it('4. all five providers reconcile independently in one run', async () => {
      await service().run('MANUAL');
      const dirs = {
        aws: await tamperedSample(AWS_SAMPLE_FILE, (j) => (j.Reservations = [])), // zero VMs -> 13 decommissioned
        azure: await tamperedSample(AZURE_SAMPLE_FILE, (j) => (j.accounts[0].error = 'AuthorizationFailed (simulated)')), // failed
        gcp: await tamperedSample(GCP_SAMPLE_FILE, (j) => {
          j.items['zones/asia-south1-a'].instances[0].disks[0].diskSizeGb = 'lots'; // partial
          j.items['zones/europe-west1-c'].instances.splice(0, 1); // removed, but must NOT be decommissioned
        }),
        proxmox: await tamperedSample(PROXMOX_SAMPLE_FILE, (j) => {
          j.clusters[1].error = 'timeout (simulated)'; // pve-lab failed
          j.clusters[0].data = j.clusters[0].data.filter((d: any) => d.vmid !== 104); // old-crm-01 removed
        }),
        // vmware: unchanged sample
      };
      const run = await runOf(await service(providers(dirs)).run('MANUAL'));

      expect(Object.fromEntries(run.providerResults.map((r) => [r.provider, r.status]))).toEqual({
        AWS: 'SUCCESS',
        AZURE: 'FAILED',
        GCP: 'PARTIAL',
        PROXMOX: 'PARTIAL',
        VMWARE: 'SUCCESS',
      });
      expect(run.status).toBe('PARTIAL');
      expect(run.decommissionedCount).toBe(13 + 1);
      expect(await active('AWS')).toBe(0);
      expect(await active('AZURE')).toBe(12);
      expect(await active('GCP')).toBe(12);
      expect(await active('PROXMOX', 'pve-lab')).toBe(3);
      expect((await vm('PROXMOX', 'pve-dc1/104')).lifecycle).toBe('DECOMMISSIONED');
      expect(await active('PROXMOX', 'pve-dc1')).toBe(5);
      expect(await active('VMWARE')).toBe(11);
    });
  });
});
