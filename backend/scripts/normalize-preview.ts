/**
 * `npx tsx scripts/normalize-preview.ts` – runs all five MOCK adapters through the
 * normalization engine and prints a summary. Reads sample files only; writes nothing
 * (no database access – persistence is M3).
 */
import { createMockProviders } from '../src/modules/providers/registry.js';

const providers = createMockProviders();
let vms = 0;
let skipped = 0;
let invalid = 0;

console.log('⚠️  MOCK DATA – sample files, not real provider APIs\n');
for (const p of providers) {
  const r = await p.collectAndNormalize();
  vms += r.vms.length;
  skipped += r.skipped.length;
  invalid += r.invalid.length;
  console.log(`${r.provider.padEnd(8)} ${r.dataSource}  vms=${r.vms.length}  skipped=${r.skipped.length}  invalid=${r.invalid.length}  (${r.sourceLabel})`);
  for (const v of r.vms) {
    const vm = v.vm;
    console.log(
      `   ${vm.name.padEnd(22)} ${vm.externalId.padEnd(62)} ${vm.lifecycle.padEnd(14)} ${vm.powerState.padEnd(9)} ` +
        `cpu=${vm.cpuCores ?? '?'} mem=${vm.memoryMb ?? '?'}MiB disk=${vm.diskGb ?? '?'}GiB owner=${vm.owner ?? '-'} host=${vm.hostname ?? '-'}` +
        (v.warnings.length ? `  ⚠ ${v.warnings.length}` : ''),
    );
  }
  for (const s of r.skipped) console.log(`   SKIPPED ${s.ref}: ${s.reason}`);
  for (const i of r.invalid) console.log(`   INVALID [${i.stage}] ${i.ref ?? '?'}: ${i.errors.join('; ')}`);
}
console.log(`\nTOTAL vms=${vms} skipped=${skipped} invalid=${invalid} (from 60 MOCK entries)`);
