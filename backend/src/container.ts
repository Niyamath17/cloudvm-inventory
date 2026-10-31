/**
 * Composition root ("poor man's dependency injection").
 *
 * This is the ONLY place that creates concrete implementations and wires them
 * together. Modules receive what they need through function/constructor
 * parameters instead of importing singletons. Benefits:
 *   - tests can pass fakes (see tests/integration/health.test.ts),
 *   - swapping implementations (e.g. simulated vs live NetBox gateway in M4,
 *     mock vs live provider adapters later) is a one-line change here.
 */
import { createRequire } from 'node:module';
import { getEnv, type Env } from './config/env.js';
import { createDatabaseChecker, type DatabaseChecker } from './lib/database.js';
import { createLogger, type Logger } from './lib/logger.js';
import { createPrismaClient, type PrismaClient } from './lib/prisma.js';
import { CollectionService } from './modules/collection/collection.service.js';
import { createMockProviders, type RegisteredProvider } from './modules/providers/registry.js';
import { HttpNetBoxGateway } from './modules/netbox/http.gateway.js';
import type { NetBoxGateway } from './modules/netbox/NetBoxGateway.js';
import { SimulatedNetBoxGateway } from './modules/netbox/simulated.gateway.js';
import { SyncService } from './modules/sync/sync.service.js';
import { DriftService } from './modules/drift/drift.service.js';
import type { NetBoxReader } from './modules/netbox/NetBoxReader.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export interface Container {
  env: Env;
  logger: Logger;
  prisma: PrismaClient;
  checkDatabase: DatabaseChecker;
  /** All five providers – MOCK adapters only in this prototype. */
  providers: RegisteredProvider[];
  collections: CollectionService;
  /** SIMULATION (default) or LIVE NetBox, chosen by NETBOX_MODE. */
  netbox: NetBoxGateway;
  sync: SyncService;
  drift: DriftService;
  version: string;
  startedAt: Date;
}

export function buildContainer(): Container {
  const env = getEnv();
  const logger = createLogger(env);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const providers = createMockProviders();
  const netbox: NetBoxGateway & NetBoxReader =
    env.NETBOX_MODE === 'live' && env.NETBOX_URL && env.NETBOX_TOKEN
      ? new HttpNetBoxGateway({ baseUrl: env.NETBOX_URL, token: env.NETBOX_TOKEN, authScheme: env.NETBOX_AUTH_SCHEME })
      : new SimulatedNetBoxGateway(prisma);

  return {
    env,
    logger,
    prisma,
    checkDatabase: createDatabaseChecker(prisma),
    providers,
    collections: new CollectionService(prisma, providers, logger),
    netbox,
    sync: new SyncService(prisma, netbox, logger),
    drift: new DriftService(prisma, netbox, logger),
    version,
    startedAt: new Date(),
  };
}
