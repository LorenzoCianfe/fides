import { z } from 'zod';

/** DI token for the validated environment configuration. */
export const ENV = Symbol('ENV');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  APP_NAME: z.string().min(1).default('Fides'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  /** WebAuthn relying-party ID: the effective domain of the clients. */
  WEBAUTHN_RP_ID: z.string().min(1).default('localhost'),
  /** Comma-separated list of origins accepted in WebAuthn ceremonies. */
  WEBAUTHN_ORIGINS: z
    .string()
    .default('http://localhost:3001')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /** Session token lifetimes (ADR-0020); defaults match DEFAULT_SESSION_CONFIG. */
  SESSION_ACCESS_TTL_MS: z.coerce.number().int().positive().optional(),
  SESSION_REFRESH_IDLE_TTL_MS: z.coerce.number().int().positive().optional(),
  SESSION_ABSOLUTE_TTL_MS: z.coerce.number().int().positive().optional(),
  /** Browser origins allowed by CORS; falls back to WEBAUTHN_ORIGINS when unset. */
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : value
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
    ),
  /** Kill-switch for auth-endpoint rate limiting (ADR-0021). */
  THROTTLE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Kill-switch for in-process schedulers (outbox dispatch, cleanup sweeper). */
  SCHEDULERS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** How often the outbox dispatcher drains pending events. */
  OUTBOX_DISPATCH_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  /** How often dead security rows are swept (retention per ADR-0021). */
  CLEANUP_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  /**
   * Maximum minor units a single admin funding operation may credit (ADR-0025).
   * A blast-radius limit, not a feature switch: the operation is authorized by
   * role, four-eyes, and audit rather than by configuration.
   */
  ADMIN_FUNDING_MAX_MINOR: z.coerce.number().int().positive().default(1_000_000),
  /**
   * The first `super_admin`, seeded at startup and only when no admin exists at
   * all (ADR-0025) — so configuration cannot add or reset an admin once the back
   * office is live. The seeded admin has no second factor and must enrol one at
   * first login before any session is issued.
   */
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).optional(),
  /** Back-office session lifetimes: 30-minute sliding idle, 8-hour absolute cap. */
  ADMIN_SESSION_IDLE_TTL_MS: z.coerce.number().int().positive().optional(),
  ADMIN_SESSION_ABSOLUTE_TTL_MS: z.coerce.number().int().positive().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Parse and validate the environment. Throws a ZodError on invalid config. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
