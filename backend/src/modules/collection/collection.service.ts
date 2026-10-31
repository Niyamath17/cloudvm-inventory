/**
 * Collection orchestrator.
 *
 *   start(trigger)  -> acquires the lock, creates a RUNNING CollectionRun, returns its id
 *                      immediately, and processes providers in the background.
 *   run(trigger)    -> same, but waits for completion (tests, scheduler in M6).
 *
 * Per provider (sequentially, so one provider's DB transaction never competes with another's):
 *   collectAndNormalize()  throws  -> ProviderRunResult FAILED, NOTHING written or decommissioned
 *   planReconciliation()           -> which accounts may be reconciled (see reconciliation.ts)
 *   writeProviderBatch()           -> one transaction: create / update / heartbeat / decommission
 *   ProviderRunResult              -> SUCCESS | PARTIAL (invalid records) | FAILED
 *
 * Run status: SUCCESS (all providers SUCCESS), FAILED (all FAILED), otherwise PARTIAL.
 *
 * Locking: only one collection at a time.
 *   1. In-process lock (this is a single-process modular monolith) – rejects a second
 *      start immediately, no race.
 *   2. Database guard – a RUNNING CollectionRun younger than STALE_AFTER_MS also blocks
 *      (protects against a second backend process). Older RUNNING rows are left over from
 *      a crash and are closed as FAILED instead of blocking forever.
 *   A multi-instance deployment would replace (1) with a PostgreSQL advisory lock.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Logger } from '../../lib/logger.js';
import { ConflictError } from '../../lib/errors.js';
import type { RegisteredProvider } from '../providers/registry.js';
import { writeProviderBatch } from '../inventory/inventory.writer.js';
import { planReconciliation } from './reconciliation.js';

export const STALE_AFTER_MS = 15 * 60 * 1000;
const MAX_STORED_ERRORS = 200;

export class CollectionInProgressError extends ConflictError {
  constructor(runId?: string) {
    super('A collection is already running', runId ? { runId } : undefined);
  }
}

export type Trigger = 'MANUAL' | 'SCHEDULED';

interface RunError {
  provider: string;
  ref?: string | null;
  stage?: string;
  message: string;
}

export class CollectionService {
  private running: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly providers: RegisteredProvider[],
    private readonly logger: Logger,
  ) {}

  /** True while a collection is being processed by this process. */
  get isRunning(): boolean {
    return this.running !== null;
  }

  /** Starts a collection and returns its run id without waiting for it to finish. */
  async start(trigger: Trigger): Promise<{ runId: string; done: Promise<void> }> {
    if (this.running) throw new CollectionInProgressError();
    // Claim the in-process lock synchronously, before any await, so two calls cannot both pass.
    let release!: () => void;
    this.running = new Promise<void>((resolve) => (release = resolve));

    try {
      await this.closeStaleRuns();
      const active = await this.prisma.collectionRun.findFirst({ where: { status: 'RUNNING' } });
      if (active) throw new CollectionInProgressError(active.id);

      const run = await this.prisma.collectionRun.create({ data: { trigger, status: 'RUNNING' } });
      const done = this.process(run.id)
        .catch((err: unknown) => this.failRun(run.id, err))
        .finally(() => {
          this.running = null;
          release();
        });
      return { runId: run.id, done };
    } catch (err) {
      this.running = null;
      release();
      throw err;
    }
  }

  /** Starts a collection and waits for it to finish. */
  async run(trigger: Trigger): Promise<string> {
    const { runId, done } = await this.start(trigger);
    await done;
    return runId;
  }

  /** Unexpected failure (e.g. database lost mid-run): close the run as FAILED instead of leaving it RUNNING. */
  private async failRun(runId: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error({ runId, err }, 'Collection run aborted');
    await this.prisma.collectionRun
      .update({ where: { id: runId }, data: { status: 'FAILED', finishedAt: new Date(), errors: [{ provider: '-', message }] } })
      .catch((e: unknown) => this.logger.error({ runId, err: e }, 'Could not mark run as FAILED'));
  }

  private async closeStaleRuns(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    const { count } = await this.prisma.collectionRun.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      data: { status: 'FAILED', finishedAt: new Date(), errors: [{ provider: '-', message: 'run abandoned (process stopped before completion)' }] },
    });
    if (count) this.logger.warn({ count }, 'Closed stale RUNNING collection runs');
  }

  private async process(runId: string): Promise<void> {
    const log = this.logger.child({ runId });
    const totals = { discovered: 0, created: 0, updated: 0, unchanged: 0, decommissioned: 0, invalid: 0 };
    const errors: RunError[] = [];
    const statuses: Array<'SUCCESS' | 'PARTIAL' | 'FAILED'> = [];
    log.info({ providers: this.providers.map((p) => `${p.provider}(${p.dataSource})`) }, 'Collection started');

    for (const provider of this.providers) {
      const started = Date.now();
      let status: 'SUCCESS' | 'PARTIAL' | 'FAILED' = 'FAILED';
      let vmCount = 0;
      let invalidCount = 0;
      let message: string | null = null;

      try {
        const result = await provider.collectAndNormalize();
        const plan = planReconciliation(result);
        const counts = await writeProviderBatch(this.prisma, result, plan.reconcile);

        status = plan.status;
        vmCount = result.vms.length;
        invalidCount = result.invalid.length;
        totals.discovered += vmCount;
        totals.created += counts.created;
        totals.updated += counts.updated;
        totals.unchanged += counts.unchanged;
        totals.decommissioned += counts.decommissioned;
        totals.invalid += invalidCount;

        for (const inv of result.invalid) {
          errors.push({ provider: provider.provider, ref: inv.ref, stage: inv.stage, message: inv.errors.join('; ') });
        }
        for (const a of result.accounts.filter((x) => x.status === 'FAILED')) {
          errors.push({ provider: provider.provider, ref: a.account, stage: 'account', message: a.error ?? 'account query failed' });
        }
        if (plan.skipped.length) {
          message = `decommission check skipped – ${plan.skipped.map((s) => `${s.account}: ${s.reason}`).join('; ')}`;
        }
        log.info({ provider: provider.provider, status, ...counts, invalid: invalidCount, skipped: result.skipped.length, reconciled: plan.reconcile, notReconciled: plan.skipped }, 'Provider collected');
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
        errors.push({ provider: provider.provider, message });
        log.error({ provider: provider.provider, err }, 'Provider collection failed – nothing written for this provider');
      }

      statuses.push(status);
      await this.prisma.providerRunResult.create({
        data: {
          runId,
          provider: provider.provider,
          dataSource: provider.dataSource,
          status,
          vmCount,
          invalidCount,
          durationMs: Date.now() - started,
          error: message,
        },
      });
    }

    const runStatus = statuses.every((s) => s === 'SUCCESS') ? 'SUCCESS' : statuses.every((s) => s === 'FAILED') ? 'FAILED' : 'PARTIAL';
    await this.prisma.collectionRun.update({
      where: { id: runId },
      data: {
        status: runStatus,
        finishedAt: new Date(),
        discoveredCount: totals.discovered,
        createdCount: totals.created,
        updatedCount: totals.updated,
        unchangedCount: totals.unchanged,
        decommissionedCount: totals.decommissioned,
        invalidCount: totals.invalid,
        errors: errors.slice(0, MAX_STORED_ERRORS) as unknown as Prisma.InputJsonValue,
      },
    });
    log.info({ status: runStatus, ...totals }, 'Collection finished');
  }
}
