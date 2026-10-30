/**
 * API-level tests for the health endpoint and error handling.
 *
 * Uses supertest against the real Express app with an injected (fake)
 * database checker – no running server or database needed.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { DatabaseChecker } from '../../src/lib/database.js';
import { createLogger } from '../../src/lib/logger.js';

const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

function buildApp(checkDatabase: DatabaseChecker, netboxMode: 'simulation' | 'live' = 'simulation') {
  return createApp({
    logger,
    corsOrigin: 'http://localhost:5173',
    health: {
      checkDatabase,
      env: { NODE_ENV: 'test', NETBOX_MODE: netboxMode, NETBOX_URL: undefined },
      version: '0.0.0-test',
      startedAt: new Date(),
    },
  });
}

const dbUp: DatabaseChecker = async () => ({ status: 'up', latencyMs: 2, serverVersion: 'PostgreSQL 16.x' });
const dbDown: DatabaseChecker = async () => ({ status: 'down', latencyMs: 3000, error: 'connection refused' });

describe('GET /api/v1/health', () => {
  it('returns 200 "ok" when the database is up', async () => {
    const res = await request(buildApp(dbUp)).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database.status).toBe('up');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('returns 503 "degraded" when the database is down', async () => {
    const res = await request(buildApp(dbDown)).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.database.error).toBe('connection refused');
  });

  it('labels NetBox as SIMULATION and never claims a real connection', async () => {
    const res = await request(buildApp(dbUp)).get('/api/v1/health');
    expect(res.body.checks.netbox.mode).toBe('SIMULATION');
    expect(res.body.checks.netbox.label).toMatch(/simulation/i);
    expect(res.body.checks.netbox).not.toHaveProperty('reachable');
  });
});

describe('error handling', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(buildApp(dbUp)).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('returns 400 INVALID_JSON for a malformed JSON body', async () => {
    const res = await request(buildApp(dbUp))
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('propagates an incoming x-request-id header', async () => {
    const res = await request(buildApp(dbUp)).get('/api/v1/health').set('x-request-id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});
