/**
 * Normalization engine – runs a provider's mapper over a collected batch.
 *
 * Pipeline per record:
 *   raw shape invalid (adapter)  -> invalid[stage=raw]
 *   mapper throws / says invalid -> invalid[stage=mapping]
 *   mapper says skipped          -> skipped
 *   output fails NormalizedVm    -> invalid[stage=validation]
 *   same externalId seen twice   -> invalid[stage=duplicate] (first one wins)
 *   otherwise                    -> vms[] with fingerprint
 *
 * One bad record never stops the batch. Nothing here touches the database (M3).
 */
import { normalizedVmSchema } from '../../domain/normalized-vm.js';
import type { CollectionBatch } from '../providers/ProviderAdapter.js';
import { fingerprint } from './fingerprint.js';
import type { NormalizationResult, VmMapper } from './types.js';

export function normalizeBatch<TRaw>(batch: CollectionBatch<TRaw>, mapper: VmMapper<TRaw>): NormalizationResult {
  const result: NormalizationResult = {
    provider: batch.provider,
    dataSource: batch.dataSource,
    sourceLabel: batch.sourceLabel,
    collectedAt: batch.collectedAt,
    vms: [],
    skipped: [],
    invalid: batch.rejected.map((r) => ({ ref: r.ref, stage: 'raw' as const, errors: r.errors })),
  };
  const seen = new Set<string>();

  for (const raw of batch.records) {
    let outcome;
    try {
      outcome = mapper(raw);
    } catch (err) {
      result.invalid.push({ ref: null, stage: 'mapping', errors: [err instanceof Error ? err.message : String(err)] });
      continue;
    }

    if (outcome.kind === 'skipped') {
      result.skipped.push({ ref: outcome.ref, reason: outcome.reason });
      continue;
    }
    if (outcome.kind === 'invalid') {
      result.invalid.push({ ref: outcome.ref, stage: 'mapping', errors: outcome.errors });
      continue;
    }

    const parsed = normalizedVmSchema.safeParse({
      ...outcome.vm,
      dataSource: batch.dataSource,
      discoveredAt: batch.collectedAt,
    });
    if (!parsed.success) {
      result.invalid.push({
        ref: outcome.vm.externalId,
        stage: 'validation',
        errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      continue;
    }

    if (seen.has(parsed.data.externalId)) {
      result.invalid.push({ ref: parsed.data.externalId, stage: 'duplicate', errors: ['same externalId appeared twice in one batch; first record kept'] });
      continue;
    }
    seen.add(parsed.data.externalId);
    result.vms.push({ vm: parsed.data, fingerprint: fingerprint(parsed.data), warnings: outcome.warnings });
  }
  return result;
}
