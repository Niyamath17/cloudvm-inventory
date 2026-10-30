/**
 * Environment configuration.
 *
 * All configuration comes from environment variables (12-factor style) and is
 * validated ONCE at startup with Zod. If something is missing or malformed the
 * process exits immediately with a readable message, instead of failing later
 * in some random code path.
 *
 * Secrets (DATABASE_URL password, NETBOX_TOKEN) are never hard-coded – they come
 * from `.env` locally and from real environment variables in Docker/CI.
 */
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Loads backend/.env into process.env (does nothing if the file is absent,
// e.g. inside Docker where variables are injected by docker-compose).
loadDotenv({ quiet: true });

/** Treat `VAR=` (empty string in .env) the same as "not set". */
const optionalString = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),

    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine((v) => v.startsWith('postgresql://') || v.startsWith('postgres://'), {
        message: 'DATABASE_URL must be a postgresql:// connection string',
      }),

    // --- NetBox ---------------------------------------------------------
    // `simulation` = clearly-labelled local stand-in (no real NetBox calls).
    // `live`       = real NetBox REST API; requires URL + token.
    NETBOX_MODE: z.enum(['simulation', 'live']).default('simulation'),
    NETBOX_URL: optionalString(z.url()),
    NETBOX_TOKEN: optionalString(z.string()),
    // NetBox < 4.5 uses "Token <t>"; NetBox >= 4.5 v2 tokens use "Bearer nbt_<key>.<token>".
    NETBOX_AUTH_SCHEME: z.enum(['Token', 'Bearer']).default('Token'),

    // --- Scheduler (used from M6) ----------------------------------------
    SCHEDULER_ENABLED: booleanFromString.default(false),
    COLLECTION_CRON: z.string().default('*/15 * * * *'),
  })
  .superRefine((env, ctx) => {
    if (env.NETBOX_MODE === 'live') {
      if (!env.NETBOX_URL) {
        ctx.addIssue({ code: 'custom', path: ['NETBOX_URL'], message: 'required when NETBOX_MODE=live' });
      }
      if (!env.NETBOX_TOKEN) {
        ctx.addIssue({ code: 'custom', path: ['NETBOX_TOKEN'], message: 'required when NETBOX_MODE=live' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parse an env-like object. Exported separately so tests can call it with fixtures. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazily-parsed, process-wide configuration. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
