import { z } from 'zod';

/** DI token for the validated environment configuration. */
export const ENV = Symbol('ENV');

export const envSchema = z
  .object({
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
    /**
     * `Secure` attribute on session cookies (ADR-0027). Defaults on; turn it off
     * only for plain-HTTP local development. Browsers treat `http://localhost` as
     * a secure context, so the default works there too.
     */
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    /**
     * `SameSite` attribute on session cookies. `strict` requires the web client
     * and the API to be same-site — different ports or subdomains are fine,
     * different registrable domains are not. A cross-site deployment needs
     * `none`, which browsers only honour together with `Secure`.
     */
    COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
    /**
     * Native passkey app association (ADR-0027). When set, the API serves the
     * `.well-known` documents that bind the WebAuthn relying party to the mobile
     * apps — so whichever HTTPS origin fronts the API (production or a local
     * tunnel) publishes valid association files without extra hosting.
     */
    IOS_APP_ID: z.string().min(1).optional(),
    ANDROID_PACKAGE_NAME: z.string().min(1).optional(),
    /** Comma-separated SHA-256 signing-certificate fingerprints of the Android app. */
    ANDROID_CERT_FINGERPRINTS: z
      .string()
      .optional()
      .transform((value) =>
        value === undefined
          ? undefined
          : value
              .split(',')
              .map((fingerprint) => fingerprint.trim())
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
    /**
     * Field-level encryption keyring (ADR-0028), as comma-separated
     * `keyId:base64Key` pairs of 32 bytes each. The first pair is the primary
     * and encrypts new values; the rest stay usable so a key can be rotated
     * without a migration, since every ciphertext names the key that sealed it.
     *
     * Deliberately **required with no default**: a default would be a published
     * key, and falling back to plaintext when unset would be exactly the silent
     * security downgrade tenet 6 of `security.md` forbids. Generate one with
     * `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
     */
    ENCRYPTION_KEYS: z.string().min(1),
    /**
     * Ed25519 signing keyring for audit anchors (ADR-0031), as comma-separated
     * `keyId:base64Pkcs8` pairs. The first is the primary and signs new anchors;
     * the rest stay usable so anchors published under a rotated-out key remain
     * verifiable, since every signature names the key that made it.
     *
     * **Required with no default, for the same reason as `ENCRYPTION_KEYS`.** A
     * default would be a published key — and here that is worse than useless,
     * because a published key lets anyone forge an anchor for a truncated chain.
     * Making it optional would be the other failure: the system would appear to
     * anchor and would not, which is precisely the silent downgrade
     * `security.md` tenet 6 forbids. Generate one with
     * `node -e "console.log(require('crypto').generateKeyPairSync('ed25519').privateKey.export({format:'der',type:'pkcs8'}).toString('base64'))"`.
     */
    AUDIT_ANCHOR_KEYS: z.string().min(1),
    /**
     * How often the chain head is signed and published. This is the truncation
     * window: records appended since the last anchor can still be deleted
     * undetectably, so the interval is the guarantee's resolution rather than a
     * performance knob.
     */
    AUDIT_ANCHOR_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
    /**
     * Consecutive failed admin authentication attempts before the account locks
     * (ADR-0029). Counts both factors: a wrong password and a wrong TOTP code
     * advance the same counter, because an attacker past the password step is
     * further along, not safer.
     */
    ADMIN_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
    /** How long an admin account stays locked once the threshold is reached. */
    ADMIN_LOCKOUT_DURATION_MS: z.coerce.number().int().positive().default(900_000),
  })
  .superRefine((env, ctx) => {
    // Browsers silently drop `SameSite=None` cookies that are not `Secure`, so
    // this combination would fail at runtime as a mystery logged-out client.
    if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SAMESITE=none requires COOKIE_SECURE=true; browsers reject the pair.',
      });
    }
    // A half-configured Android association would publish a document that
    // silently fails passkey verification on device.
    if (Boolean(env.ANDROID_PACKAGE_NAME) !== Boolean(env.ANDROID_CERT_FINGERPRINTS?.length)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANDROID_CERT_FINGERPRINTS'],
        message: 'ANDROID_PACKAGE_NAME and ANDROID_CERT_FINGERPRINTS must be set together.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parse and validate the environment. Throws a ZodError on invalid config. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
