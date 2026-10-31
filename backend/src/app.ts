/**
 * Express application factory.
 *
 * `createApp(deps)` builds the app from injected dependencies but does NOT
 * listen on a port. That separation lets tests mount the real app with
 * fake dependencies (e.g. a database checker that reports "down") via supertest.
 */
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from './lib/logger.js';
import { createRequestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createHealthRouter, type HealthDeps } from './modules/health/health.routes.js';
import type { PrismaClient } from '@prisma/client';
import { createCollectionRouter } from './modules/collection/collection.routes.js';
import type { CollectionService } from './modules/collection/collection.service.js';
import { createDashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { createInventoryRouter } from './modules/inventory/inventory.routes.js';
import { createProvidersRouter } from './modules/providers/providers.routes.js';
import type { RegisteredProvider } from './modules/providers/registry.js';
import type { NetBoxGateway } from './modules/netbox/NetBoxGateway.js';
import { createNetBoxRouter, createSyncRouter } from './modules/sync/sync.routes.js';
import type { SyncService } from './modules/sync/sync.service.js';
import { createDriftRouter } from './modules/drift/drift.routes.js';
import type { DriftService } from './modules/drift/drift.service.js';

export interface AppDeps {
  logger: Logger;
  corsOrigin: string;
  health: HealthDeps;
  /** Inventory/collection modules (M3). Optional so the health-only tests can build a minimal app. */
  modules?: {
    prisma: PrismaClient;
    providers: RegisteredProvider[];
    collections: CollectionService;
    /** NetBox sync (M4). Optional so M3 tests can build the app without it. */
    sync?: SyncService;
    netbox?: NetBoxGateway;
    /** Drift reporting (M5). Optional so M3/M4 tests can build the app without it. */
    drift?: DriftService;
  };
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: deps.corsOrigin.split(',').map((o) => o.trim()) }));
  app.use(express.json({ limit: '1mb' }));
  app.use(createRequestLogger(deps.logger));

  // --- API v1 routes -------------------------------------------------------
  const api = express.Router();
  api.use('/health', createHealthRouter(deps.health));
  if (deps.modules) {
    const { prisma, providers, collections } = deps.modules;
    api.use('/vms', createInventoryRouter(prisma));
    api.use('/collections', createCollectionRouter(prisma, collections));
    api.use('/providers', createProvidersRouter(prisma, providers));
    api.use('/dashboard', createDashboardRouter(prisma));
    if (deps.modules.sync && deps.modules.netbox) {
      api.use('/sync', createSyncRouter(prisma, deps.modules.sync));
      api.use('/netbox', createNetBoxRouter(prisma, deps.modules.netbox));
    }
    if (deps.modules.drift) api.use('/drift', createDriftRouter(prisma, deps.modules.drift));
  }
  app.use('/api/v1', api);

  // --- Fallbacks (must be last) ---------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
