/** Test helpers: copy a MOCK sample file to a temp dir and tamper with it (JSON is mutated freely, hence `any`). */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SAMPLE_DIR } from '../../../src/modules/providers/mock/sample-file.js';
import type { NormalizationResult, NormalizedRecord } from '../../../src/modules/normalization/types.js';

export async function tamperedSample(file: string, mutate: (json: any) => void): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cloudvm-'));
  const json = JSON.parse(await readFile(join(DEFAULT_SAMPLE_DIR, file), 'utf8'));
  mutate(json);
  await writeFile(join(dir, file), JSON.stringify(json));
  return dir;
}

export function byName(result: NormalizationResult, name: string): NormalizedRecord {
  const matches = result.vms.filter((v) => v.vm.name === name);
  if (matches.length !== 1) throw new Error(`expected exactly one VM named ${name}, found ${matches.length}`);
  return matches[0] as NormalizedRecord;
}
