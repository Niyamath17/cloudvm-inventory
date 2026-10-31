/**
 * Dedicated TEST database for M3+ integration tests.
 *
 * URL = DATABASE_URL with "_test" appended to the database name (cloudvm -> cloudvm_test),
 * created and migrated by scripts/verify-m3.sh. Tests TRUNCATE it freely, so the
 * development database (cloudvm) is never touched. Truncation refuses to run against a
 * database whose name does not end in "_test".
 */
import { config as loadDotenv } from 'dotenv';
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../src/lib/prisma.js';

loadDotenv({ quiet: true });

export function testDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  const u = new URL(url);
  u.pathname = `${u.pathname.replace(/\/$/, '')}_test`;
  return u.toString();
}

export function createTestPrisma(): PrismaClient {
  const url = testDatabaseUrl();
  if (!url) throw new Error('DATABASE_URL not set');
  return createPrismaClient(url);
}

const TABLES = [
  'drift_items', 'drift_reports', 'sync_events', 'sync_runs', 'vm_sync_states',
  'provider_run_results', 'collection_runs', 'simulated_netbox_vms', 'virtual_machines',
];

export async function resetTestDb(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  const db = rows[0]?.db ?? '';
  if (!db.endsWith('_test')) throw new Error(`Refusing to truncate non-test database "${db}"`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}
