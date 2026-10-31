/**
 * Shared helpers for MOCK adapters: read a sample file, enforce the MOCK label,
 * and validate records one by one.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { z } from 'zod';
import { mockMetaSchema } from '../raw/meta.js';
import type { AccountOutcome, RejectedRawRecord } from '../ProviderAdapter.js';
import type { ProviderName } from '../../../domain/normalized-vm.js';

/** backend/sample-data, resolved from this file's location (works from src/ and dist/). */
export const DEFAULT_SAMPLE_DIR = resolve(import.meta.dirname, '../../../../sample-data');

export class SampleFileError extends Error {}

/** Reads a sample file and refuses it unless `_meta.mock === true` for the expected provider. */
export async function readMockSample(dir: string, file: string, provider: ProviderName): Promise<Record<string, unknown>> {
  const path = join(dir, file);
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    throw new SampleFileError(`Cannot read MOCK sample ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof json !== 'object' || json === null) throw new SampleFileError(`${file} is not a JSON object`);

  const meta = mockMetaSchema.safeParse((json as { _meta?: unknown })._meta);
  if (!meta.success) {
    throw new SampleFileError(`${file} is not labelled as MOCK data (_meta invalid) – refusing to load it`);
  }
  if (meta.data.provider !== provider) {
    throw new SampleFileError(`${file} is labelled for ${meta.data.provider}, expected ${provider}`);
  }
  return json as Record<string, unknown>;
}

/** Validates each item independently: good ones are returned, bad ones become RejectedRawRecords. */
export function validateEach<T>(
  items: unknown[],
  schema: z.ZodType<T>,
  refOf: (item: unknown) => string | null,
): { valid: T[]; rejected: RejectedRawRecord[] } {
  const valid: T[] = [];
  const rejected: RejectedRawRecord[] = [];
  for (const item of items) {
    const parsed = schema.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
    else rejected.push({ ref: refOf(item), errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(record)'}: ${i.message}`) });
  }
  return { valid, rejected };
}

/** Safe property read for building a reference from an unvalidated record. */
export function readString(obj: unknown, ...path: string[]): string | null {
  let cur: unknown = obj;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'string' || typeof cur === 'number' ? String(cur) : null;
}

export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * MOCK stand-in for an adapter's configured account list.
 *
 * A LIVE adapter knows up front which accounts it is configured to query and whether
 * each query succeeded. MOCK files declare that list in a top-level "accounts" array:
 *   [{ "id": "123456789012" }, { "id": "999999999999", "error": "AccessDenied (simulated)" }]
 * Accounts that appear in the data but are not declared are added as COMPLETE.
 */
export function resolveAccounts(declared: unknown, seenInData: Iterable<string>): AccountOutcome[] {
  const outcomes = new Map<string, AccountOutcome>();
  for (const entry of asArray(declared)) {
    const id = readString(entry, 'id')?.trim();
    if (!id) continue;
    const error = readString(entry, 'error');
    outcomes.set(id, error ? { account: id, status: 'FAILED', error } : { account: id, status: 'COMPLETE' });
  }
  for (const id of seenInData) if (!outcomes.has(id)) outcomes.set(id, { account: id, status: 'COMPLETE' });
  return [...outcomes.values()].sort((a, b) => a.account.localeCompare(b.account));
}

export const failedSet = (accounts: AccountOutcome[]): Set<string> =>
  new Set(accounts.filter((a) => a.status === 'FAILED').map((a) => a.account));
