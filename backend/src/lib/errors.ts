/**
 * Application error types.
 *
 * Throw these from services/routes; the central error middleware turns them
 * into a consistent JSON response:
 *
 *   { "error": { "code": "NOT_FOUND", "message": "...", "details": ... } }
 *
 * Anything that is NOT an AppError is treated as an unexpected bug: it is
 * logged with its stack and returned as a generic 500 (no internals leaked).
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(404, 'NOT_FOUND', message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable', details?: unknown) {
    super(503, 'SERVICE_UNAVAILABLE', message, details);
  }
}

export interface ErrorResponseBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}
