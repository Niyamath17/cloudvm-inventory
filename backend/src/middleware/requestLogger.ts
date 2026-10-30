/**
 * HTTP request logging (pino-http).
 *
 * Every request gets a request ID (re-uses an incoming `x-request-id` header if a
 * proxy set one) which is echoed back in the response header and included in
 * error responses – handy for correlating a UI error with a log line.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pinoHttp } from 'pino-http';
import type { Logger } from '../lib/logger.js';

export function createRequestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Health checks are polled frequently (Docker, UI); log them at debug to avoid noise.
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      if (req.url?.startsWith('/api/v1/health')) return 'debug';
      return 'info';
    },
    serializers: {
      req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  });
}
