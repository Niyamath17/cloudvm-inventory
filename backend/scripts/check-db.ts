/**
 * `npm run db:check` – standalone PostgreSQL connectivity check.
 * Exits 0 if the database is reachable, 1 otherwise. Useful right after
 * `docker compose up -d postgres` and in CI.
 */
import { getEnv } from '../src/config/env.js';
import { createDatabaseChecker } from '../src/lib/database.js';
import { createPrismaClient } from '../src/lib/prisma.js';

const env = getEnv();
const prisma = createPrismaClient(env.DATABASE_URL);

const result = await createDatabaseChecker(prisma)();
await prisma.$disconnect();

if (result.status === 'up') {
  console.log(`✔ PostgreSQL reachable (${result.serverVersion}) in ${result.latencyMs} ms`);
  process.exit(0);
} else {
  console.error(`✘ PostgreSQL NOT reachable: ${result.error}`);
  process.exit(1);
}
