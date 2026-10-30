/**
 * Central error handling.
 *
 * Express 5 automatically forwards errors thrown in async route handlers here,
 * so routes can simply `throw new NotFoundError(...)` – no try/catch boilerplate.
 *
 * Order matters in app.ts: notFoundHandler goes after all routes, errorHandler last.
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, type ErrorResponseBody } from '../lib/errors.js';

/** Unknown route -> consistent JSON 404 (instead of Express's default HTML page). */
export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ErrorResponseBody = {
    error: { code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.path}`, requestId: String(req.id) },
  };
  res.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const requestId = String(req.id);

  // 1. Known, intentional errors thrown by our own code.
  if (err instanceof AppError) {
    if (err.statusCode >= 500) req.log.error({ err }, err.message);
    const body: ErrorResponseBody = {
      error: { code: err.code, message: err.message, details: err.details, requestId },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // 2. Zod validation errors (from request body/query parsing).
  if (err instanceof ZodError) {
    const body: ErrorResponseBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId,
      },
    };
    res.status(400).json(body);
    return;
  }

  // 3. Malformed JSON body (raised by express.json()).
  if (isBodyParseError(err)) {
    const body: ErrorResponseBody = {
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON', requestId },
    };
    res.status(400).json(body);
    return;
  }

  // 4. Anything else is a bug: log full details, return a generic message.
  req.log.error({ err }, 'Unhandled error');
  const body: ErrorResponseBody = {
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId },
  };
  res.status(500).json(body);
};

function isBodyParseError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type?: unknown }).type === 'entity.parse.failed'
  );
}
