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

export interface AppDeps {
  logger: Logger;
  corsOrigin: string;
  health: HealthDeps;
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
  // M2+: api.use('/vms', ...), api.use('/collections', ...), api.use('/sync', ...), ...
  app.use('/api/v1', api);

  // --- Fallbacks (must be last) ---------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
