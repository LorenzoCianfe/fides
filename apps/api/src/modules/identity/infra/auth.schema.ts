import {
  bigint,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity.schema';

/**
 * A client-declared device (browser or mobile app instance). Rows are created
 * or matched when a session is issued; the metadata is untrusted until mobile
 * attestation (Slice 8) strengthens it. Sessions reference their device so the
 * user can recognise and revoke them.
 */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Human-readable label, e.g. "Chrome on Windows". */
    name: text('name').notNull(),
    /** Coarse platform: web | ios | android. */
    platform: text('platform').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('devices_user_idx').on(table.userId),
    identityUniq: uniqueIndex('devices_identity_uniq').on(table.userId, table.name, table.platform),
  }),
);

/**
 * A WebAuthn credential (passkey). `credentialId` and `publicKey` are stored
 * base64url-encoded as produced by the relying-party library; `counter` backs
 * clone detection. A user may hold multiple passkeys (ADR-0007).
 */
export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Base64url credential ID as asserted by the authenticator. */
    credentialId: text('credential_id').notNull(),
    /** Base64url COSE public key. */
    publicKey: text('public_key').notNull(),
    /** Signature counter for clone detection; many passkeys keep this at 0. */
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: jsonb('transports').$type<string[]>(),
    /** singleDevice | multiDevice (synced passkey). */
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull().default(false),
    /** Client-declared label for the authenticator. */
    deviceName: text('device_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => ({
    credentialIdUniq: uniqueIndex('credentials_credential_id_uniq').on(table.credentialId),
    userIdx: index('credentials_user_idx').on(table.userId),
  }),
);

/**
 * Server-side session (ADR-0020). The opaque access and refresh tokens are
 * stored only as SHA-256 hashes; the previous refresh hash enables reuse
 * detection after rotation. Revocation is immediate: every request validates
 * against this row.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    accessTokenHash: text('access_token_hash').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    /** Hash superseded by the last rotation; presenting it revokes the session. */
    previousRefreshTokenHash: text('previous_refresh_token_hash'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
    /** Idle deadline: the session dies if not refreshed before this instant. */
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
    /** Hard cap regardless of activity. */
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    /**
     * SHA-256 of the double-submit CSRF token, set only when the session is
     * carried by cookies (ADR-0027). NULL for bearer sessions: a bearer token
     * is not an ambient credential, so those requests have no CSRF exposure.
     * Rotated with the token pair, and revoked with the session by construction.
     */
    csrfTokenHash: text('csrf_token_hash'),
  },
  (table) => ({
    accessHashUniq: uniqueIndex('sessions_access_token_hash_uniq').on(table.accessTokenHash),
    refreshHashUniq: uniqueIndex('sessions_refresh_token_hash_uniq').on(table.refreshTokenHash),
    userIdx: index('sessions_user_idx').on(table.userId),
  }),
);

export const webauthnCeremonyEnum = pgEnum('webauthn_ceremony', [
  'registration',
  'authentication',
  'sca',
]);

/**
 * Short-lived, single-use WebAuthn challenges issued between option generation
 * and response verification. Only the SHA-256 of the challenge is stored: a
 * presented challenge is genuine iff its hash matches an unconsumed row.
 * `userId` is NULL for decoy authentication challenges (anti-enumeration).
 */
export const webauthnChallenges = pgTable(
  'webauthn_challenges',
  {
    id: uuid('id').primaryKey(),
    challengeHash: text('challenge_hash').notNull(),
    type: webauthnCeremonyEnum('type').notNull(),
    userId: uuid('user_id').references(() => users.id),
    /** Canonical action hash for `sca` ceremonies (dynamic linking, ADR-0021). */
    actionHash: text('action_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    challengeHashUniq: uniqueIndex('webauthn_challenges_hash_uniq').on(table.challengeHash),
  }),
);

/**
 * One-time enrolment tokens proving email control for the FIRST passkey
 * registration (issued by email verification, consumed by the ceremony).
 * Stored hashed, like every other bearer secret.
 */
export const enrolmentTokens = pgTable(
  'enrolment_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUniq: uniqueIndex('enrolment_tokens_hash_uniq').on(table.tokenHash),
    userIdx: index('enrolment_tokens_user_idx').on(table.userId),
  }),
);

/**
 * Single-use SCA grants (ADR-0021): a verified step-up assertion mints one,
 * bound to the user, the session, and the canonical hash of the action it
 * authorizes (dynamic linking). The money path consumes it atomically. Stored
 * hashed, like every other bearer secret. The session FK cascades on delete: a
 * grant is meaningless without its session, so when the sweeper purges a dead
 * session (promptly now, ADR-0024) any outstanding grant goes with it.
 */
export const scaGrants = pgTable(
  'sca_grants',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    /** Canonical SHA-256 of the action this grant authorizes. */
    actionHash: text('action_hash').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUniq: uniqueIndex('sca_grants_token_hash_uniq').on(table.tokenHash),
    userIdx: index('sca_grants_user_idx').on(table.userId),
  }),
);

export type DeviceRow = typeof devices.$inferSelect;
export type CredentialRow = typeof credentials.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type WebauthnChallengeRow = typeof webauthnChallenges.$inferSelect;
export type EnrolmentTokenRow = typeof enrolmentTokens.$inferSelect;
export type ScaGrantRow = typeof scaGrants.$inferSelect;
