/**
 * Prisma client factory.
 *
 * One PrismaClient per process: it owns a connection pool, so creating many
 * instances would exhaust Postgres connections. The composition root
 * (container.ts) creates it once and passes it to whoever needs it.
 */
import { PrismaClient } from '@prisma/client';

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    // Prisma's own logs are routed to warn/error only; query logging is too noisy for M0.
    log: ['warn', 'error'],
  });
}

export type { PrismaClient };
