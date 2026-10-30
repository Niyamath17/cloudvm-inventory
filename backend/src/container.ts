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

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export interface Container {
  env: Env;
  logger: Logger;
  prisma: PrismaClient;
  checkDatabase: DatabaseChecker;
  version: string;
  startedAt: Date;
}

export function buildContainer(): Container {
  const env = getEnv();
  const logger = createLogger(env);
  const prisma = createPrismaClient(env.DATABASE_URL);

  return {
    env,
    logger,
    prisma,
    checkDatabase: createDatabaseChecker(prisma),
    version,
    startedAt: new Date(),
  };
}
