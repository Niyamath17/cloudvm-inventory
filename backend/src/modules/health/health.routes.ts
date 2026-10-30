/**
 * GET /api/v1/health
 *
 * Reports whether the API is usable:
 *   - 200 + status "ok"       -> API up, PostgreSQL reachable
 *   - 503 + status "degraded" -> API up, PostgreSQL NOT reachable
 *
 * The NetBox block only reports the CONFIGURED mode in M0. Real reachability
 * checks against NetBox's /api/status/ endpoint arrive with the NetBox module (M4).
 * In simulation mode the response says so explicitly – it never claims a real
 * NetBox connection.
 */
import { Router } from 'express';
import type { DatabaseChecker } from '../../lib/database.js';
import type { Env } from '../../config/env.js';

export interface HealthDeps {
  checkDatabase: DatabaseChecker;
  env: Pick<Env, 'NODE_ENV' | 'NETBOX_MODE' | 'NETBOX_URL'>;
  version: string;
  startedAt: Date;
}

export function createHealthRouter(deps: HealthDeps): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const database = await deps.checkDatabase();
    const healthy = database.status === 'up';

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      service: 'cloudvm-backend',
      version: deps.version,
      environment: deps.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - deps.startedAt.getTime()) / 1000),
      checks: {
        database,
        netbox:
          deps.env.NETBOX_MODE === 'simulation'
            ? {
                mode: 'SIMULATION',
                label: 'Local simulation – no real NetBox instance is contacted',
              }
            : {
                mode: 'LIVE',
                url: deps.env.NETBOX_URL,
                label: 'Live NetBox configured – connectivity check not implemented until M4',
              },
      },
    });
  });

  return router;
}
