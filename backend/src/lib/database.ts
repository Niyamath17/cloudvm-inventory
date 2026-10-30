/**
 * Database connectivity check.
 *
 * Runs `SELECT 1` plus `SELECT version()` with a timeout and reports latency.
 * Used by:
 *   - startup (log whether Postgres is reachable),
 *   - GET /api/v1/health,
 *   - `npm run db:check` (scripts/check-db.ts).
 *
 * It never throws – it returns a result object, so callers can decide how to react.
 */
import type { PrismaClient } from '@prisma/client';

export interface DatabaseHealth {
  status: 'up' | 'down';
  latencyMs: number;
  serverVersion?: string;
  error?: string;
}

/** Abstraction so the health route can be tested without a real database. */
export type DatabaseChecker = () => Promise<DatabaseHealth>;

export function createDatabaseChecker(prisma: PrismaClient, timeoutMs = 3000): DatabaseChecker {
  return async () => {
    const started = performance.now();
    try {
      const rows = await withTimeout(
        prisma.$queryRaw<Array<{ version: string }>>`SELECT version() AS version`,
        timeoutMs,
      );
      // "PostgreSQL 16.4 on x86_64-pc-linux-musl, ..." -> "PostgreSQL 16.4"
      const full = rows[0]?.version ?? 'unknown';
      return {
        status: 'up',
        latencyMs: Math.round(performance.now() - started),
        serverVersion: full.split(' on ')[0] ?? full,
      };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Math.round(performance.now() - started),
        error: summariseDbError(err),
      };
    }
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Database check timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Prisma errors are multi-line and can include the connection string host; keep the first useful line. */
function summariseDbError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lines = message.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? 'Unknown database error';
}
