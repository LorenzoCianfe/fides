import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** The ADR-0011 back-office roles; exactly one per admin in Phase 1 (ADR-0025). */
export const adminRoleEnum = pgEnum('admin_role', [
  'super_admin',
  'compliance_officer',
  'fraud_analyst',
  'support_agent',
  'auditor',
]);

export const adminStatusEnum = pgEnum('admin_status', ['active', 'disabled']);

/**
 * A back-office operator (ADR-0025). A deliberately separate entity from
 * customer `users`: admin and customer authentication share no table, no guard,
 * and no token namespace, so no customer-facing authorization path can yield
 * back-office access.
 *
 * Authentication is password + TOTP, unlike the passkey-only customer stack —
 * the WebAuthn relying party is coupled to `users`/`credentials`, so reusing it
 * would mean giving admins customer rows. The password is a self-describing
 * scrypt string (`scrypt$N$r$p$salt$hash`) so parameters can be raised without a
 * migration.
 */
export const admins = pgTable(
  'admins',
  {
    id: uuid('id').primaryKey(),
    /** Login identifier; stored lower-cased and unique. */
    email: text('email').notNull(),
    role: adminRoleEnum('role').notNull(),
    status: adminStatusEnum('status').notNull().default('active'),
    /** scrypt$N$r$p$salt$hash — never a bare digest. */
    passwordHash: text('password_hash').notNull(),
    /**
     * Base32 TOTP secret, held as an AES-256-GCM envelope (ADR-0028). It is the
     * one secret in the system that cannot be hashed — RFC 6238 recomputes codes
     * from the secret itself — so it is encrypted instead, with the admin id as
     * additional authenticated data so a ciphertext cannot be grafted onto
     * another row. NULL until the admin enrols at first login.
     *
     * Reads still tolerate a bare base32 value: rows written before ADR-0028
     * are plaintext, and are re-sealed in place the next time they verify.
     */
    totpSecret: text('totp_secret'),
    totpEnrolledAt: timestamp('totp_enrolled_at', { withTimezone: true }),
    /**
     * The last accepted TOTP time step. A code is rejected unless its step is
     * strictly greater, so a code observed in transit cannot be replayed even
     * inside its acceptance window.
     */
    lastTotpStep: bigint('last_totp_step', { mode: 'number' }),
    /**
     * Consecutive failed authentication attempts across *both* factors
     * (ADR-0029), reset to zero by any successful sign-in. Incremented in its
     * own transaction, because the TOTP step deliberately rolls its transaction
     * back on a wrong code so a typo does not also spend the login challenge —
     * an increment written inside that transaction would roll back with it.
     */
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    /** Set when the threshold is reached; authentication fails until it passes. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailUniq: uniqueIndex('admins_email_uniq').on(table.email),
  }),
);

/**
 * A back-office session (ADR-0025): one opaque 256-bit token, stored only as a
 * SHA-256 hash so revocation is immediate (the ADR-0020 pattern). Unlike the
 * customer session there is no refresh token — at a 30-minute idle window the
 * sliding `idleExpiresAt`, capped by `absoluteExpiresAt`, is the whole policy.
 */
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id),
    tokenHash: text('token_hash').notNull(),
    /** Slid forward on each validated request, never past `absoluteExpiresAt`. */
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
    /** Hard cap regardless of activity. */
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (table) => ({
    tokenHashUniq: uniqueIndex('admin_sessions_token_hash_uniq').on(table.tokenHash),
    adminIdx: index('admin_sessions_admin_idx').on(table.adminId),
  }),
);

/**
 * The intermediate token minted between the two login factors (ADR-0025): the
 * password succeeded, but no session exists until TOTP is verified. Short-lived
 * and single-use, stored hashed like every other bearer secret. While the admin
 * is unenrolled this token may also be exchanged exactly once for a freshly
 * generated secret — `secretIssuedAt` records that it was.
 */
export const adminLoginChallenges = pgTable(
  'admin_login_challenges',
  {
    id: uuid('id').primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    /** Set when this challenge handed out an enrolment secret (once only). */
    secretIssuedAt: timestamp('secret_issued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUniq: uniqueIndex('admin_login_challenges_hash_uniq').on(table.tokenHash),
    adminIdx: index('admin_login_challenges_admin_idx').on(table.adminId),
  }),
);

export const pendingAdminActionStatusEnum = pgEnum('pending_admin_action_status', [
  'pending',
  'approved',
  'rejected',
]);

/**
 * The four-eyes (maker-checker) queue (ADR-0011, ADR-0025). Deliberately
 * generic — a type discriminator over a jsonb payload — with exactly one type
 * registered in Phase 1 (`admin_funding`), because the shape already fits the
 * Phase 2/3 high-risk actions (suspension, reversal, limit override) at no extra
 * cost today.
 *
 * Approval executes the action inside the same transaction that transitions the
 * row out of `pending`, conditionally on it still being pending, so a concurrent
 * double-approval cannot execute twice and a failed execution rolls the approval
 * back. `resultRef` points at whatever the execution produced (for funding, the
 * journal entry id). Expiry is by `expiresAt`, not a status: an expired pending
 * request simply cannot be approved.
 *
 * Segregation of duties is enforced primarily in the permission matrix (no role
 * holds both halves); the CHECK constraint is the last line of defence against a
 * self-approval that got past both the matrix and the service.
 */
export const pendingAdminActions = pgTable(
  'pending_admin_actions',
  {
    id: uuid('id').primaryKey(),
    /** Registered action type, e.g. `admin_funding`. */
    type: text('type').notNull(),
    status: pendingAdminActionStatusEnum('status').notNull().default('pending'),
    /** Type-specific, validated request parameters. */
    payload: jsonb('payload').notNull(),
    makerId: uuid('maker_id')
      .notNull()
      .references(() => admins.id),
    makerReason: text('maker_reason'),
    checkerId: uuid('checker_id').references(() => admins.id),
    decisionReason: text('decision_reason'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** What the execution produced, e.g. the posted journal entry id. */
    resultRef: text('result_ref'),
    correlationId: text('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('pending_admin_actions_status_idx').on(table.status, table.createdAt),
    makerIdx: index('pending_admin_actions_maker_idx').on(table.makerId),
    sodCheck: check(
      'pending_admin_actions_sod_check',
      sql`${table.checkerId} IS NULL OR ${table.checkerId} <> ${table.makerId}`,
    ),
  }),
);

export type AdminRow = typeof admins.$inferSelect;
export type AdminRole = (typeof adminRoleEnum.enumValues)[number];
export type AdminSessionRow = typeof adminSessions.$inferSelect;
export type AdminLoginChallengeRow = typeof adminLoginChallenges.$inferSelect;
export type PendingAdminActionRow = typeof pendingAdminActions.$inferSelect;
export type PendingAdminActionStatus = (typeof pendingAdminActionStatusEnum.enumValues)[number];
