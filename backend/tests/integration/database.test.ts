/**
 * Real PostgreSQL connectivity test.
 *
 * Requires the Docker Postgres container (`docker compose up -d postgres`).
 * Skipped automatically when DATABASE_URL is not set, so unit tests still run
 * on a machine without Docker.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { createDatabaseChecker } from '../../src/lib/database.js';
import { createPrismaClient } from '../../src/lib/prisma.js';

loadDotenv({ quiet: true });
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('PostgreSQL connectivity (real database)', () => {
  const prisma = createPrismaClient(url ?? '');
  afterAll(() => prisma.$disconnect());

  it('connects and reports the server version', async () => {
    const result = await createDatabaseChecker(prisma)();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe('up');
    expect(result.serverVersion).toMatch(/^PostgreSQL 16/);
  });

  it('reports "down" (without throwing) for an unreachable database', async () => {
    const bad = createPrismaClient('postgresql://cloudvm:wrong@127.0.0.1:1/nope');
    const result = await createDatabaseChecker(bad, 2000)();
    await bad.$disconnect();
    expect(result.status).toBe('down');
    expect(result.error).toBeTruthy();
  });
});
