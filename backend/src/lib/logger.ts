/**
 * Structured logging with Pino.
 *
 * - Production / Docker: one JSON object per line on stdout (machine-readable,
 *   ready for Loki/ELK/CloudWatch).
 * - Development: piped through `pino-pretty` for human-readable colored output.
 *
 * Usage: `logger.info({ runId }, 'collection started')` – put data in the
 * first argument object, keep the message short and constant. That makes logs
 * searchable by field instead of by string matching.
 */
import { pino, type Logger } from 'pino';
import type { Env } from '../config/env.js';

export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  const usePretty = env.NODE_ENV === 'development';

  return pino({
    level: env.LOG_LEVEL,
    base: { service: 'cloudvm-backend' },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Never let secrets leak into logs, even if someone logs a whole request/config object.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.NETBOX_TOKEN',
        '*.DATABASE_URL',
        '*.password',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
    ...(usePretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,service' },
          },
        }
      : {}),
  });
}

export type { Logger };
