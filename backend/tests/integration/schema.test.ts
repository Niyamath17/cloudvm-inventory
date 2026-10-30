/**
 * M1 – database constraints (real PostgreSQL).
 *
 * Proves the rules the rest of the system relies on are enforced BY THE DATABASE:
 *   - one VM row per (provider, externalId); same externalId under another provider is fine
 *   - lifecycle CHECK: DECOMMISSIONED always has a timestamp + reason, ACTIVE has neither
 *   - target CHECK: a NETBOX sync row can never hold a simulated ID and vice versa
 *   - a simulated ID must point to an existing simulated record (FK)
 *   - one sync-state row per VM per target; one local VM per real NetBox ID
 *   - provider collected at most once per run; cascade / set-null behaviour of history
 *   - simulated NetBox mirrors NetBox's (cluster, name) uniqueness; serial is not unique
 *
 * Requires the `init` migration WITH prisma/sql/init_check_constraints.sql applied.
 * Rows use the "m1test-" prefix and are removed in afterAll.
 */
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIdentity } from '../../src/domain/identity.js';
import { createPrismaClient } from '../../src/lib/prisma.js';

loadDotenv({ quiet: true });
const url = process.env.DATABASE_URL;
const P = 'm1test-';

describe.skipIf(!url)('Prisma schema constraints (real database)', () => {
  const prisma = createPrismaClient(url ?? '');

  const vmData = (identity = buildIdentity.aws(`${P}acct`, 'ap-south-1', 'i-001')) => ({
    ...identity,
    name: `${P}vm`,
    dataSource: 'MOCK' as const,
    rawData: { test: true },
    fingerprint: 'test',
    lastDiscoveredAt: new Date(),
  });

  const cleanup = async () => {
    await prisma.syncRun.deleteMany({ where: { error: { startsWith: P } } });
    await prisma.collectionRun.deleteMany({ where: { errors: { equals: [P] } } });
    await prisma.virtualMachine.deleteMany({ where: { account: { startsWith: P } } }); // cascades vm_sync_states
    await prisma.simulatedNetboxVm.deleteMany({ where: { name: { startsWith: P } } });
  };

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('VM identity', () => {
    it('rejects a second VM with the same (provider, externalId)', async () => {
      await prisma.virtualMachine.create({ data: vmData() });
      await expect(prisma.virtualMachine.create({ data: vmData() })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('allows the same native ID in another AWS account', async () => {
      const vm = await prisma.virtualMachine.create({ data: vmData(buildIdentity.aws(`${P}acct-2`, 'ap-south-1', 'i-001')) });
      expect(vm.nativeId).toBe('i-001');
    });

    it('allows the same Proxmox VMID in two clusters', async () => {
      await prisma.virtualMachine.create({ data: vmData(buildIdentity.proxmox(`${P}pve-dc1`, 100)) });
      const lab = await prisma.virtualMachine.create({ data: vmData(buildIdentity.proxmox(`${P}pve-lab`, 100)) });
      expect(lab.externalId).toBe(`${P}pve-lab/100`);
    });

    it('applies safe defaults to a new VM', async () => {
      const vm = await prisma.virtualMachine.create({ data: vmData(buildIdentity.gcp(`${P}proj`, '42')) });
      expect(vm).toMatchObject({ lifecycle: 'ACTIVE', powerState: 'UNKNOWN', decommissionedAt: null, decommissionReason: null });
      expect(vm.ipAddresses).toEqual([]);
      expect(vm.tags).toEqual({});
    });
  });

  describe('lifecycle CHECK constraint', () => {
    it('accepts a decommissioned VM with timestamp and reason (AWS terminated)', async () => {
      const vm = await prisma.virtualMachine.create({
        data: {
          ...vmData(buildIdentity.aws(`${P}acct`, 'eu-west-1', 'i-terminated')),
          lifecycle: 'DECOMMISSIONED',
          decommissionedAt: new Date(),
          decommissionReason: 'PROVIDER_TERMINATED',
          rawPowerState: 'terminated',
        },
      });
      expect(vm.powerState).toBe('UNKNOWN');
    });

    it('rejects DECOMMISSIONED without a reason', async () => {
      await expect(
        prisma.virtualMachine.create({
          data: { ...vmData(buildIdentity.aws(`${P}acct`, 'eu-west-1', 'i-bad1')), lifecycle: 'DECOMMISSIONED', decommissionedAt: new Date() },
        }),
      ).rejects.toThrow(/virtual_machines_lifecycle_check/);
    });

    it('rejects ACTIVE with a decommission timestamp', async () => {
      await expect(
        prisma.virtualMachine.create({
          data: { ...vmData(buildIdentity.aws(`${P}acct`, 'eu-west-1', 'i-bad2')), decommissionedAt: new Date() },
        }),
      ).rejects.toThrow(/virtual_machines_lifecycle_check/);
    });
  });

  describe('sync state: real NetBox and simulation kept apart', () => {
    it('stores one state row per target and enforces the target/ID CHECK', async () => {
      const vm = await prisma.virtualMachine.create({ data: vmData(buildIdentity.azure(`${P}sub`, 'vm-1')) });
      const sim = await prisma.simulatedNetboxVm.create({ data: { name: `${P}sim-1`, clusterName: `${P}c`, status: 'active' } });

      await prisma.vmSyncState.create({ data: { vmId: vm.id, target: 'SIMULATION', simulatedVmId: sim.id } });
      await prisma.vmSyncState.create({ data: { vmId: vm.id, target: 'NETBOX', netboxId: 987654 } });

      // second row for the same (vm, target)
      await expect(prisma.vmSyncState.create({ data: { vmId: vm.id, target: 'NETBOX' } })).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    it('rejects a NETBOX row carrying a simulated ID', async () => {
      const vm = await prisma.virtualMachine.create({ data: vmData(buildIdentity.azure(`${P}sub`, 'vm-2')) });
      const sim = await prisma.simulatedNetboxVm.create({ data: { name: `${P}sim-2`, clusterName: `${P}c`, status: 'active' } });
      await expect(
        prisma.vmSyncState.create({ data: { vmId: vm.id, target: 'NETBOX', simulatedVmId: sim.id } }),
      ).rejects.toThrow(/vm_sync_states_target_id_check/);
    });

    it('rejects a SIMULATION row carrying a real NetBox ID', async () => {
      const vm = await prisma.virtualMachine.create({ data: vmData(buildIdentity.azure(`${P}sub`, 'vm-3')) });
      await expect(
        prisma.vmSyncState.create({ data: { vmId: vm.id, target: 'SIMULATION', netboxId: 5 } }),
      ).rejects.toThrow(/vm_sync_states_target_id_check/);
    });

    it('rejects a simulated ID that does not exist (foreign key)', async () => {
      const vm = await prisma.virtualMachine.create({ data: vmData(buildIdentity.azure(`${P}sub`, 'vm-4')) });
      await expect(
        prisma.vmSyncState.create({ data: { vmId: vm.id, target: 'SIMULATION', simulatedVmId: 2_000_000_000 } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('allows a real NetBox ID to belong to only one local VM', async () => {
      const a = await prisma.virtualMachine.create({ data: vmData(buildIdentity.azure(`${P}sub`, 'vm-5')) });
      const b = await prisma.virtualMachine.create({ data: vmData(buildIdentity.azure(`${P}sub`, 'vm-6')) });
      await prisma.vmSyncState.create({ data: { vmId: a.id, target: 'NETBOX', netboxId: 123123 } });
      await expect(
        prisma.vmSyncState.create({ data: { vmId: b.id, target: 'NETBOX', netboxId: 123123 } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('clears the link (not the state row) when a simulated record is deleted', async () => {
      const vm = await prisma.virtualMachine.create({ data: vmData(buildIdentity.azure(`${P}sub`, 'vm-7')) });
      const sim = await prisma.simulatedNetboxVm.create({ data: { name: `${P}sim-7`, clusterName: `${P}c`, status: 'active' } });
      const state = await prisma.vmSyncState.create({ data: { vmId: vm.id, target: 'SIMULATION', simulatedVmId: sim.id } });
      await prisma.simulatedNetboxVm.delete({ where: { id: sim.id } });
      expect((await prisma.vmSyncState.findUniqueOrThrow({ where: { id: state.id } })).simulatedVmId).toBeNull();
    });
  });

  describe('history tables', () => {
    it('allows each provider once per run; cascades results, keeps the sync run', async () => {
      const run = await prisma.collectionRun.create({ data: { trigger: 'MANUAL', errors: [P] } });
      const result = { runId: run.id, provider: 'AWS' as const, dataSource: 'MOCK' as const, status: 'SUCCESS' as const };
      await prisma.providerRunResult.create({ data: result });
      await expect(prisma.providerRunResult.create({ data: result })).rejects.toMatchObject({ code: 'P2002' });

      const sync = await prisma.syncRun.create({ data: { target: 'SIMULATION', collectionRunId: run.id, error: `${P}sync` } });
      await prisma.collectionRun.delete({ where: { id: run.id } });
      expect(await prisma.providerRunResult.count({ where: { runId: run.id } })).toBe(0);
      expect((await prisma.syncRun.findUniqueOrThrow({ where: { id: sync.id } })).collectionRunId).toBeNull();
    });

    it('keeps sync history when a VM row is deleted', async () => {
      const vm = await prisma.virtualMachine.create({ data: vmData(buildIdentity.gcp(`${P}proj`, '99')) });
      const sync = await prisma.syncRun.create({ data: { target: 'SIMULATION', error: `${P}history` } });
      const event = await prisma.syncEvent.create({
        data: { syncRunId: sync.id, vmId: vm.id, vmName: vm.name, action: 'CREATE', success: true },
      });
      await prisma.virtualMachine.delete({ where: { id: vm.id } });
      const after = await prisma.syncEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(after.vmId).toBeNull();
      expect(after.vmName).toBe(`${P}vm`);
    });
  });

  describe('simulated NetBox table', () => {
    it('enforces unique (clusterName, name) but allows duplicate serials, like NetBox', async () => {
      const base = { clusterName: `${P}cluster`, status: 'active', serial: `aws:${P}dup` };
      await prisma.simulatedNetboxVm.create({ data: { ...base, name: `${P}web-01` } });
      await expect(prisma.simulatedNetboxVm.create({ data: { ...base, name: `${P}web-01` } })).rejects.toMatchObject({
        code: 'P2002',
      });
      const second = await prisma.simulatedNetboxVm.create({ data: { ...base, name: `${P}web-01-copy` } });
      expect(second.serial).toBe(base.serial);
    });
  });
});
