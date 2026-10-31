/**
 * Process entry point: build dependencies, verify the database, start HTTP
 * server, and shut down gracefully on Ctrl+C / `docker stop`.
 */
import { createApp } from './app.js';
import { buildContainer } from './container.js';

async function main(): Promise<void> {
  const c = buildContainer();
  const { env, logger } = c;

  logger.info(
    { nodeEnv: env.NODE_ENV, port: env.PORT, netboxMode: env.NETBOX_MODE.toUpperCase() },
    'Starting CloudVM backend',
  );
  if (env.NETBOX_MODE === 'simulation') {
    logger.warn('NetBox SIMULATION mode: no real NetBox instance will be contacted');
  }

  // Verify PostgreSQL at startup. We log loudly but keep running, so /health can
  // report "degraded" and the API recovers automatically once the DB is back.
  const db = await c.checkDatabase();
  if (db.status === 'up') {
    logger.info({ latencyMs: db.latencyMs, serverVersion: db.serverVersion }, 'PostgreSQL connection verified');
  } else {
    logger.error({ error: db.error }, 'PostgreSQL is NOT reachable – is `docker compose up -d postgres` running?');
  }

  const app = createApp({
    logger,
    corsOrigin: env.CORS_ORIGIN,
    health: { checkDatabase: c.checkDatabase, env, version: c.version, startedAt: c.startedAt },
    modules: { prisma: c.prisma, providers: c.providers, collections: c.collections, sync: c.sync, netbox: c.netbox },
  });

  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}/api/v1`);
  });

  // Graceful shutdown: stop accepting connections, then close the DB pool.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void c.prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref(); // force-exit if something hangs
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  // Most likely an invalid environment configuration (see config/env.ts).
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
