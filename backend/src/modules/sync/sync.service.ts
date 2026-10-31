/**
 * Sync engine: pushes the inventory to the configured NetBox target.
 *
 * Per VM (sequentially):
 *   preDecide     unchanged since last sync -> SKIP with ZERO gateway calls (idempotent re-runs)
 *                 decommissioned and never synced -> SKIP (dead VMs are not created)
 *   match         1. stored remote id (must exist and carry our serial)
 *                 2. lookup by serial (0 / 1 / many)
 *                 3. lookup by name in the cluster – adopted only if that record has no serial
 *   decide        DUPLICATE (many) | CREATE (none) | UPDATE / DECOMMISSION (changed fields only) | SKIP
 *   record        VmSyncState for (vm, target) + SyncEvent for every non-skip outcome
 *
 * Errors: auth -> abort run (FAILED, remaining VMs untouched); name conflict -> retry once with a
 * disambiguated name; validation/transient -> that VM FAILED (retried next sync); stale id -> re-match.
 * The target (NETBOX / SIMULATION) is recorded on every run and state – a simulated sync is never
 * reported as a real NetBox sync.
 */
import type { PrismaClient, VirtualMachine, VmSyncState } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { netboxSerial } from '../../domain/identity.js';
import { ConflictError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { clusterFor, diffWrite, disambiguatedName, toNetBoxWrite, type FieldDiff } from '../netbox/mapping.js';
import { NetBoxAuthError, NetBoxNameConflictError, type NbVm, type NetBoxGateway } from '../netbox/NetBoxGateway.js';
import { decide, preDecide } from './plan.js';

export const SYNC_STALE_AFTER_MS = 15 * 60 * 1000;

export class SyncInProgressError extends ConflictError {
  constructor(runId?: string) {
    super('A synchronization is already running', runId ? { runId } : undefined);
  }
}

type Counts = { created: number; updated: number; decommissioned: number; skipped: number; failed: number; duplicate: number };
type VmWithState = VirtualMachine & { syncStates: VmSyncState[] };

export class SyncService {
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: NetBoxGateway,
    private readonly logger: Logger,
  ) {}

  get target() {
    return this.gateway.target;
  }
  get isRunning() {
    return this.running;
  }

  async start(collectionRunId?: string): Promise<{ syncRunId: string; done: Promise<void> }> {
    if (this.running) throw new SyncInProgressError();
    this.running = true; // claimed synchronously – a concurrent call is rejected above
    try {
      await this.prisma.syncRun.updateMany({
        where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - SYNC_STALE_AFTER_MS) } },
        data: { status: 'FAILED', finishedAt: new Date(), error: 'run abandoned (process stopped before completion)' },
      });
      const active = await this.prisma.syncRun.findFirst({ where: { status: 'RUNNING' } });
      if (active) throw new SyncInProgressError(active.id);
      const run = await this.prisma.syncRun.create({ data: { target: this.gateway.target, status: 'RUNNING', collectionRunId } });
      const done = this.process(run.id)
        .catch((err: unknown) => this.finish(run.id, 'FAILED', null, err instanceof Error ? err.message : String(err)))
        .finally(() => {
          this.running = false;
        });
      return { syncRunId: run.id, done };
    } catch (err) {
      this.running = false;
      throw err;
    }
  }

  async run(collectionRunId?: string): Promise<string> {
    const { syncRunId, done } = await this.start(collectionRunId);
    await done;
    return syncRunId;
  }

  private remoteIdOf(state: VmSyncState | undefined): number | null {
    if (!state) return null;
    return this.gateway.target === 'NETBOX' ? state.netboxId : state.simulatedVmId;
  }

  private async process(runId: string): Promise<void> {
    const target = this.gateway.target;
    const log = this.logger.child({ syncRunId: runId, target });
    const counts: Counts = { created: 0, updated: 0, decommissioned: 0, skipped: 0, failed: 0, duplicate: 0 };

    const vms: VmWithState[] = await this.prisma.virtualMachine.findMany({
      include: { syncStates: { where: { target } } },
      orderBy: [{ provider: 'asc' }, { externalId: 'asc' }],
    });
    log.info({ vms: vms.length }, 'Sync started');

    // Clusters are needed only for VMs that may be written.
    const toSync = vms.filter((vm) => preDecide(vm, this.stateLike(vm.syncStates[0])).kind === 'SYNC');
    const clusters = new Map(toSync.map((vm) => [clusterFor(vm).name, clusterFor(vm)]));
    try {
      await this.gateway.prepare([...clusters.values()]);
    } catch (err) {
      if (err instanceof NetBoxAuthError) return this.finish(runId, 'FAILED', counts, err.message);
      throw err;
    }

    for (const vm of vms) {
      const state = vm.syncStates[0];
      const pre = preDecide(vm, this.stateLike(state));
      if (pre.kind === 'SKIP') {
        counts.skipped += 1;
        continue;
      }
      try {
        await this.syncOne(runId, vm, state, counts);
      } catch (err) {
        if (err instanceof NetBoxAuthError) {
          log.error({ err: err.message }, 'NetBox authentication failed – aborting sync run');
          return this.finish(runId, 'FAILED', counts, err.message);
        }
        counts.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        await this.saveState(vm, { state: 'FAILED', lastError: message });
        await this.event(runId, vm, 'UPDATE', false, null, null, message, err);
        log.warn({ vm: vm.externalId, err: message }, 'VM sync failed');
      }
    }

    const status = counts.failed === 0 && counts.duplicate === 0 ? 'SUCCESS' : 'PARTIAL';
    await this.finish(runId, status, counts, null);
    log.info({ status, ...counts }, 'Sync finished');
  }

  private stateLike(state: VmSyncState | undefined) {
    return state ? { state: state.state, syncedFingerprint: state.syncedFingerprint, remoteId: this.remoteIdOf(state) } : null;
  }

  private async syncOne(runId: string, vm: VmWithState, state: VmSyncState | undefined, counts: Counts): Promise<void> {
    const desired = toNetBoxWrite(vm);
    const serial = netboxSerial(vm);

    // ── match ──────────────────────────────────────────────────────────────
    let match: NbVm | null = null;
    let matches = 0;
    const storedId = this.remoteIdOf(state);
    if (storedId !== null) {
      const r = await this.gateway.getVm(storedId);
      if (r && r.serial === serial) {
        match = r;
        matches = 1;
      }
    }
    if (!match) {
      const bySerial = await this.gateway.findBySerial(serial);
      matches = bySerial.length;
      match = bySerial.length === 1 ? (bySerial[0] ?? null) : null;
      if (matches === 0) {
        const byName = await this.gateway.findByName(desired.name, desired.cluster);
        if (byName && !byName.serial) {
          match = byName;
          matches = 1;
        }
      }
    }

    const { patch, diff } = match ? diffWrite(desired, match, vm, this.gateway.unsupportedFields) : { patch: {}, diff: {} as FieldDiff };
    const action = decide(vm, matches, Object.keys(patch).length > 0);

    // ── act ────────────────────────────────────────────────────────────────
    let remote: NbVm | null = match;
    switch (action) {
      case 'DUPLICATE':
        counts.duplicate += 1;
        await this.saveState(vm, { state: 'DUPLICATE', lastError: `${matches} NetBox records share serial ${serial}` });
        await this.event(runId, vm, 'SKIP', false, null, null, `DUPLICATE: ${matches} records with serial ${serial} – not written`);
        return;
      case 'CREATE':
        try {
          remote = await this.gateway.createVm(desired);
        } catch (err) {
          if (!(err instanceof NetBoxNameConflictError)) throw err;
          remote = await this.gateway.createVm({ ...desired, name: disambiguatedName(vm) });
        }
        counts.created += 1;
        break;
      case 'UPDATE':
      case 'DECOMMISSION':
        try {
          remote = await this.gateway.updateVm(match!.id, patch);
        } catch (err) {
          if (!(err instanceof NetBoxNameConflictError) || patch.name === undefined) throw err;
          const { name: _drop, ...rest } = patch;
          remote = await this.gateway.updateVm(match!.id, rest);
          delete diff.name;
        }
        if (action === 'DECOMMISSION') counts.decommissioned += 1;
        else counts.updated += 1;
        break;
      case 'SKIP':
        counts.skipped += 1; // matched and identical (adopted), or decommissioned with nothing remote
        break;
    }

    await this.saveState(vm, { state: 'SYNCED', remoteId: remote?.id ?? null, syncedFingerprint: vm.fingerprint, lastSyncedAt: new Date(), lastError: null });
    if (action !== 'SKIP') await this.event(runId, vm, action, true, remote?.id ?? null, Object.keys(diff).length ? diff : null, null);
  }

  private async saveState(
    vm: VirtualMachine,
    data: { state: VmSyncState['state']; remoteId?: number | null; syncedFingerprint?: string; lastSyncedAt?: Date; lastError: string | null },
  ): Promise<void> {
    const target = this.gateway.target;
    const ids =
      data.remoteId === undefined ? {} : target === 'NETBOX' ? { netboxId: data.remoteId, simulatedVmId: null } : { simulatedVmId: data.remoteId, netboxId: null };
    const fields = {
      state: data.state,
      lastError: data.lastError,
      ...ids,
      ...(data.syncedFingerprint !== undefined && { syncedFingerprint: data.syncedFingerprint }),
      ...(data.lastSyncedAt !== undefined && { lastSyncedAt: data.lastSyncedAt }),
    };
    await this.prisma.vmSyncState.upsert({
      where: { vmId_target: { vmId: vm.id, target } },
      create: { vmId: vm.id, target, ...fields },
      update: fields,
    });
  }

  private async event(
    runId: string,
    vm: VirtualMachine,
    action: 'CREATE' | 'UPDATE' | 'DECOMMISSION' | 'SKIP',
    success: boolean,
    remoteId: number | null,
    diff: FieldDiff | null,
    error: string | null,
    err?: unknown,
  ): Promise<void> {
    await this.prisma.syncEvent.create({
      data: {
        syncRunId: runId,
        vmId: vm.id,
        vmName: vm.name,
        action,
        success,
        remoteId,
        error,
        httpStatus: (err as { httpStatus?: number } | undefined)?.httpStatus ?? null,
        diff: diff ? (diff as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }

  private async finish(runId: string, status: 'SUCCESS' | 'PARTIAL' | 'FAILED', counts: Counts | null, error: string | null): Promise<void> {
    await this.prisma.syncRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        error,
        ...(counts && {
          createdCount: counts.created,
          updatedCount: counts.updated,
          decommissionedCount: counts.decommissioned,
          skippedCount: counts.skipped,
          failedCount: counts.failed,
          duplicateCount: counts.duplicate,
        }),
      },
    });
  }
}
