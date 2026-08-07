import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  type EventClock,
  type IdGenerator,
} from '@fides/domain';
import { randomBytes } from 'node:crypto';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../../database/db.types';
import {
  isEncrypted,
  totpSecretContext,
  type EncryptionPort,
} from '../../../shared/crypto/encryption';
import { hashPassword, verifyPassword } from '../../../shared/crypto/password';
import { generateToken, sha256Hex } from '../../../shared/crypto/secrets';
import {
  DEFAULT_TOTP_CONFIG,
  buildOtpAuthUri,
  generateTotpSecret,
  verifyTotp,
  type TotpConfig,
} from '../../../shared/crypto/totp';
import { AuditAction, AuditResource } from '../../audit/application/audit-actions';
import { AuditService } from '../../audit/application/audit.service';
import { adminLoginChallenges, admins, type AdminRow, type AdminRole } from '../infra/admin.schema';
import {
  AdminSessionService,
  type AdminPrincipal,
  type IssuedAdminSession,
} from './admin-session.service';

/** A back-office operator as the roster exposes them; no secret material. */
export interface AdminSummary {
  readonly id: string;
  readonly email: string;
  readonly role: AdminRole;
  readonly status: 'active' | 'disabled';
  readonly mfaEnrolled: boolean;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
}

function toSummary(row: AdminRow): AdminSummary {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    mfaEnrolled: row.totpEnrolledAt !== null,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

export const ADMIN_LOGIN_CHALLENGE_PREFIX = 'alc';

/** How long the post-password, pre-TOTP challenge stays usable. */
export const ADMIN_LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** The minimum length accepted for the bootstrap password. */
export const ADMIN_MIN_PASSWORD_LENGTH = 12;

export interface AdminIdentityConfig {
  /** Seeded on first boot only, and only when no admin exists at all. */
  readonly bootstrapEmail?: string;
  readonly bootstrapPassword?: string;
  /** Issuer shown in the authenticator app. */
  readonly issuer: string;
  readonly loginChallengeTtlMs: number;
  readonly totp: TotpConfig;
  /** Consecutive failures across both factors before the account locks. */
  readonly lockoutThreshold: number;
  readonly lockoutDurationMs: number;
}

/** Which factor rejected an attempt; recorded on the denial (ADR-0029). */
export type AdminAuthFactor = 'password' | 'totp';

export interface AdminLoginChallenge {
  readonly challengeToken: string;
  /** False when the admin has not yet activated a second factor. */
  readonly mfaEnrolled: boolean;
  readonly expiresAt: Date;
}

export interface AdminMfaEnrolment {
  /** Base32 secret; returned exactly once, at enrolment. */
  readonly secret: string;
  readonly otpauthUri: string;
}

export interface AdminSeedResult {
  readonly seeded: boolean;
  readonly adminId: string | null;
}

/**
 * Back-office identity (ADR-0025): bootstrap seeding, and the two-factor login
 * whose factors are a scrypt-hashed password and an RFC 6238 TOTP code.
 *
 * Login is deliberately two-step. The password alone yields only a short-lived,
 * single-use challenge — never a session — so no back-office session can exist
 * on one factor. While the admin is unenrolled that challenge may also be
 * exchanged, once, for a freshly generated secret, which is how the seeded
 * super_admin enrols without its secret ever passing through configuration.
 */
export class AdminIdentityService {
  /** Lazily-made hash used to equalize timing for unknown or disabled admins. */
  private decoyHash: string | undefined;

  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly clock: EventClock,
    private readonly audit: AuditService,
    private readonly sessions: AdminSessionService,
    private readonly encryption: EncryptionPort,
    private readonly config: AdminIdentityConfig,
  ) {}

  /**
   * Reject an attempt against a locked account (ADR-0029).
   *
   * The error is the same generic `Invalid credentials` every other failure
   * raises: telling a caller "this account is locked" confirms the address
   * exists and hands an attacker a progress signal, which would give back the
   * enumeration resistance `login` goes out of its way to maintain.
   */
  private assertNotLocked(admin: Pick<AdminRow, 'lockedUntil'>, now: Date): void {
    if (admin.lockedUntil && admin.lockedUntil > now) {
      throw new AuthenticationError('Invalid credentials');
    }
  }

  /**
   * Count a failed attempt and record the denial, in a transaction of its own.
   *
   * Separate by necessity, not preference. ADR-0024 writes every audit record
   * inside its action's transaction so neither can exist without the other; a
   * denial has no such transaction — `verifyMfa` deliberately rolls its own back
   * so a mistyped code does not also spend the login challenge, which would
   * take an increment and an audit record down with it. So this runs afterwards,
   * on its own, and is the documented exception to that rule.
   *
   * Never throws into the caller's failure path: an authentication rejection
   * must reach the client even if recording it does not.
   */
  private async recordFailedAttempt(
    adminId: string,
    factor: AdminAuthFactor,
    correlationId?: string,
    /** Which flow rejected the factor; `sign_in` unless stated otherwise. */
    operation: 'sign_in' | 'password_change' = 'sign_in',
  ): Promise<void> {
    const now = this.clock.now();
    try {
      await this.db.transaction(async (tx) => {
        const [admin] = await tx
          .select()
          .from(admins)
          .where(eq(admins.id, adminId))
          .limit(1)
          .for('update');
        if (!admin) return;

        const attempts = admin.failedLoginAttempts + 1;
        const locking = attempts >= this.config.lockoutThreshold;
        const lockedUntil = locking
          ? new Date(now.getTime() + this.config.lockoutDurationMs)
          : admin.lockedUntil;

        await tx
          .update(admins)
          // Zeroed when locking: the lock itself is the penalty, and carrying
          // the count past it would re-lock on the first failure afterwards.
          .set({ failedLoginAttempts: locking ? 0 : attempts, lockedUntil, updatedAt: now })
          .where(eq(admins.id, admin.id));

        await this.audit.append(tx, {
          actorType: 'admin',
          actorId: admin.id,
          action: AuditAction.AdminAuthDenied,
          resourceType: AuditResource.Admin,
          resourceId: admin.id,
          correlationId: correlationId ?? null,
          metadata: { factor, operation, consecutiveFailures: attempts.toString() },
        });

        if (locking) {
          await this.audit.append(tx, {
            actorType: 'admin',
            actorId: admin.id,
            action: AuditAction.AdminLocked,
            resourceType: AuditResource.Admin,
            resourceId: admin.id,
            before: { locked: false },
            after: { locked: true, untilMs: lockedUntil!.getTime().toString() },
            correlationId: correlationId ?? null,
          });
        }
      });
    } catch {
      // Recording is best-effort by design. Losing a denial record is bad;
      // turning a rejected login into a 500 — and telling the caller their
      // attempt was interesting — would be worse.
    }
  }

  /**
   * The stored TOTP secret in usable form.
   *
   * Tolerates a bare base32 value because rows written before ADR-0028 hold
   * plaintext. The envelope is self-describing, so the two are unambiguous.
   * `verifyMfa` re-seals a plaintext row on its next successful verification,
   * and this tolerance can be dropped once no such rows remain.
   */
  private readTotpSecret(admin: Pick<AdminRow, 'id' | 'totpSecret'>): string {
    const stored = admin.totpSecret!;
    return isEncrypted(stored)
      ? this.encryption.decrypt(stored, totpSecretContext(admin.id))
      : stored;
  }

  /**
   * Create the first `super_admin` from configuration, and only when the table
   * is empty — so configuration cannot be used to add or reset an admin once
   * the back office is live. Idempotent and safe to run on every boot.
   */
  async seedFirstAdmin(): Promise<AdminSeedResult> {
    const email = this.config.bootstrapEmail?.trim().toLowerCase();
    const password = this.config.bootstrapPassword;
    if (!email || !password) return { seeded: false, adminId: null };
    if (password.length < ADMIN_MIN_PASSWORD_LENGTH) {
      // A weak root credential is a configuration fault, not a runtime state to
      // limp along in: fail fast rather than seed it.
      throw new ValidationError(
        `ADMIN_BOOTSTRAP_PASSWORD must be at least ${ADMIN_MIN_PASSWORD_LENGTH} characters`,
      );
    }

    const passwordHash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select({ count: sql<number>`count(*)::int` }).from(admins);
      if ((existing?.count ?? 0) > 0) return { seeded: false, adminId: null };

      const adminId = this.ids.next();
      const inserted = await tx
        .insert(admins)
        .values({ id: adminId, email, role: 'super_admin', passwordHash })
        .onConflictDoNothing({ target: admins.email })
        .returning({ id: admins.id });
      // A concurrent boot won the race; nothing to seed or audit.
      if (inserted.length === 0) return { seeded: false, adminId: null };

      await this.audit.append(tx, {
        actorType: 'system',
        actorId: null,
        action: AuditAction.AdminSeeded,
        resourceType: AuditResource.Admin,
        resourceId: adminId,
        after: { role: 'super_admin', bootstrap: true },
      });
      return { seeded: true, adminId };
    });
  }

  /**
   * First factor. Returns a single-use challenge, never a session. Failures are
   * uniform and constant-time across unknown, disabled, and wrong-password
   * admins, so the response distinguishes none of them.
   */
  async login(
    email: string,
    password: string,
    correlationId?: string,
  ): Promise<AdminLoginChallenge> {
    const normalized = email.trim().toLowerCase();
    const [admin] = await this.db
      .select()
      .from(admins)
      .where(eq(admins.email, normalized))
      .limit(1);

    if (!admin || admin.status === 'disabled') {
      await this.decoyVerify(password);
      // Nothing is recorded for an unknown address: there is no admin to
      // reference, and the address itself is PII the trail must not hold
      // (ADR-0024). Volume from unknown addresses is the throttle's job.
      throw new AuthenticationError('Invalid credentials');
    }

    this.assertNotLocked(admin, this.clock.now());

    if (!(await verifyPassword(password, admin.passwordHash))) {
      await this.recordFailedAttempt(admin.id, 'password', correlationId);
      throw new AuthenticationError('Invalid credentials');
    }

    const now = this.clock.now();
    const challengeToken = generateToken(ADMIN_LOGIN_CHALLENGE_PREFIX);
    const expiresAt = new Date(now.getTime() + this.config.loginChallengeTtlMs);
    await this.db.insert(adminLoginChallenges).values({
      id: this.ids.next(),
      adminId: admin.id,
      tokenHash: sha256Hex(challengeToken),
      expiresAt,
      createdAt: now,
    });

    return { challengeToken, mfaEnrolled: admin.totpEnrolledAt !== null, expiresAt };
  }

  /**
   * Hand out a TOTP secret for an admin that has none, against a live challenge
   * and once per challenge. The secret is stored but not activated: it becomes
   * the second factor only when a code minted from it verifies.
   */
  async beginMfaEnrolment(challengeToken: string): Promise<AdminMfaEnrolment> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [challenge] = await tx
        .select()
        .from(adminLoginChallenges)
        .where(
          and(
            eq(adminLoginChallenges.tokenHash, sha256Hex(challengeToken)),
            isNull(adminLoginChallenges.consumedAt),
            gt(adminLoginChallenges.expiresAt, now),
          ),
        )
        .limit(1)
        .for('update');
      if (!challenge) throw new AuthenticationError('Invalid or expired login challenge');
      if (challenge.secretIssuedAt !== null) {
        throw new ValidationError('An enrolment secret was already issued for this login');
      }

      const [admin] = await tx
        .select()
        .from(admins)
        .where(eq(admins.id, challenge.adminId))
        .limit(1)
        .for('update');
      if (!admin) throw new AuthenticationError('Invalid or expired login challenge');
      if (admin.totpEnrolledAt !== null) {
        throw new ValidationError('A second factor is already enrolled for this admin');
      }

      // A fresh secret per enrolment attempt: restarting the flow invalidates
      // any secret handed out earlier but never activated.
      const secret = generateTotpSecret();
      await tx
        .update(admins)
        // Sealed before it is stored (ADR-0028), bound to this admin's id, so a
        // database read yields no usable second factor and a database write
        // cannot move this secret onto another operator's row.
        .set({
          totpSecret: this.encryption.encrypt(secret, totpSecretContext(admin.id)),
          updatedAt: now,
        })
        .where(eq(admins.id, admin.id));
      await tx
        .update(adminLoginChallenges)
        .set({ secretIssuedAt: now })
        .where(eq(adminLoginChallenges.id, challenge.id));

      return {
        secret,
        otpauthUri: buildOtpAuthUri({
          issuer: this.config.issuer,
          account: admin.email,
          secretBase32: secret,
          config: this.config.totp,
        }),
      };
    });
  }

  /**
   * Second factor. Consumes the challenge, verifies the code (activating a
   * pending enrolment on first success), advances the replay guard, and issues
   * the session — all in one transaction.
   *
   * A wrong code rolls the whole transaction back, so the challenge survives a
   * typo rather than forcing the password step again. Throttling bounds guessing
   * within the 5-minute challenge window; the ADR-0029 lockout bounds it across
   * windows, and is counted *outside* this transaction precisely because the
   * rollback that protects the challenge would otherwise discard the count.
   */
  async verifyMfa(
    challengeToken: string,
    code: string,
    correlationId?: string,
  ): Promise<IssuedAdminSession> {
    const now = this.clock.now();

    // Resolved before the transaction so a rejected code can still be counted
    // against the right admin once the transaction has rolled back. Advisory
    // only — the authoritative consumption happens under lock below.
    const [pending] = await this.db
      .select({ adminId: adminLoginChallenges.adminId, lockedUntil: admins.lockedUntil })
      .from(adminLoginChallenges)
      .innerJoin(admins, eq(admins.id, adminLoginChallenges.adminId))
      .where(
        and(
          eq(adminLoginChallenges.tokenHash, sha256Hex(challengeToken)),
          isNull(adminLoginChallenges.consumedAt),
          gt(adminLoginChallenges.expiresAt, now),
        ),
      )
      .limit(1);
    if (pending) this.assertNotLocked(pending, now);

    let codeRejected = false;
    try {
      return await this.verifyMfaInTransaction(challengeToken, code, now, correlationId, () => {
        codeRejected = true;
      });
    } finally {
      // Only a rejected *code* counts. A stale or already-consumed challenge is
      // not a guess at the second factor, and counting it would let anyone
      // holding a spent token lock an operator out.
      if (codeRejected && pending) {
        await this.recordFailedAttempt(pending.adminId, 'totp', correlationId);
      }
    }
  }

  private async verifyMfaInTransaction(
    challengeToken: string,
    code: string,
    now: Date,
    correlationId: string | undefined,
    onCodeRejected: () => void,
  ): Promise<IssuedAdminSession> {
    return this.db.transaction(async (tx) => {
      const consumed = await tx
        .update(adminLoginChallenges)
        .set({ consumedAt: now })
        .where(
          and(
            eq(adminLoginChallenges.tokenHash, sha256Hex(challengeToken)),
            isNull(adminLoginChallenges.consumedAt),
            gt(adminLoginChallenges.expiresAt, now),
          ),
        )
        .returning({ adminId: adminLoginChallenges.adminId });
      if (consumed.length === 0) {
        throw new AuthenticationError('Invalid or expired login challenge');
      }

      // Locked so two requests carrying the same code cannot both pass the
      // replay guard by reading the same `lastTotpStep`.
      const [admin] = await tx
        .select()
        .from(admins)
        .where(eq(admins.id, consumed[0]!.adminId))
        .limit(1)
        .for('update');
      if (!admin || admin.status === 'disabled') {
        throw new AuthenticationError('Invalid credentials');
      }
      if (!admin.totpSecret) {
        throw new AuthenticationError('A second factor must be enrolled before signing in');
      }

      const secret = this.readTotpSecret(admin);
      const verification = verifyTotp(
        secret,
        code,
        now.getTime(),
        this.config.totp,
        admin.lastTotpStep,
      );
      if (!verification.valid) {
        onCodeRejected();
        throw new AuthenticationError('Invalid verification code');
      }

      const activating = admin.totpEnrolledAt === null;
      // A pre-ADR-0028 row is re-sealed here, on the one path that has just
      // proven the plaintext is the real secret. Doing it on read instead would
      // re-encrypt on a *failed* attempt too, and doing it in a migration was
      // impossible — SQL cannot reach the keyring.
      const resealing = !isEncrypted(admin.totpSecret);
      await tx
        .update(admins)
        .set({
          lastTotpStep: verification.step,
          updatedAt: now,
          ...(activating ? { totpEnrolledAt: now } : {}),
          ...(resealing
            ? { totpSecret: this.encryption.encrypt(secret, totpSecretContext(admin.id)) }
            : {}),
        })
        .where(eq(admins.id, admin.id));

      if (activating) {
        await this.audit.append(tx, {
          actorType: 'admin',
          actorId: admin.id,
          action: AuditAction.AdminMfaEnrolled,
          resourceType: AuditResource.Admin,
          resourceId: admin.id,
          before: { mfaEnrolled: false },
          after: { mfaEnrolled: true, method: 'totp' },
          correlationId: correlationId ?? null,
        });
      }

      return this.sessions.issueSession(tx, admin.id, correlationId);
    });
  }

  /**
   * Rotate the authenticated admin's own password (ADR-0030).
   *
   * Both factors are re-proven: the current password, and a *fresh* TOTP code.
   * The password alone would mean a stolen session is enough to take the account
   * over permanently, which is the one outcome a second factor exists to prevent.
   * The code advances `lastTotpStep` exactly as a sign-in does — otherwise a code
   * spent here would still be replayable at the login step.
   *
   * Every other session the admin holds is revoked. A password change is the
   * lever an operator reaches for when they believe they are compromised, and it
   * is worth nothing if the attacker's session outlives it; the caller's own
   * session is spared so routine rotation is not also a sign-out.
   */
  async changePassword(
    admin: AdminPrincipal,
    input: {
      readonly currentPassword: string;
      readonly newPassword: string;
      readonly totpCode: string;
    },
    correlationId?: string,
  ): Promise<{ readonly revokedSessions: number }> {
    if (input.newPassword.length < ADMIN_MIN_PASSWORD_LENGTH) {
      throw new ValidationError(
        `An admin password must be at least ${ADMIN_MIN_PASSWORD_LENGTH} characters`,
      );
    }
    if (input.newPassword === input.currentPassword) {
      throw new ValidationError('The new password must differ from the current one');
    }

    const [current] = await this.db
      .select()
      .from(admins)
      .where(eq(admins.id, admin.adminId))
      .limit(1);
    if (!current) throw new AuthenticationError('Admin not found');
    this.assertNotLocked(current, this.clock.now());

    // Both scrypt operations run outside any transaction: at production
    // parameters each costs ~100 ms, and holding the admin row locked for that
    // long would serialize every request the operator makes.
    if (!(await verifyPassword(input.currentPassword, current.passwordHash))) {
      await this.recordFailedAttempt(admin.adminId, 'password', correlationId, 'password_change');
      throw new AuthenticationError('Invalid credentials');
    }
    const newPasswordHash = await hashPassword(input.newPassword);

    let codeRejected = false;
    try {
      return await this.db.transaction(async (tx) => {
        const now = this.clock.now();
        // Locked for the replay guard: two requests carrying the same code must
        // not both read the same `lastTotpStep` and both pass.
        const [locked] = await tx
          .select()
          .from(admins)
          .where(eq(admins.id, admin.adminId))
          .limit(1)
          .for('update');
        if (!locked) throw new AuthenticationError('Admin not found');
        // The password was verified against an unlocked read. If it has changed
        // since, this request is deciding against a credential that no longer
        // exists — a compare-and-set is cheap and makes the check honest.
        if (locked.passwordHash !== current.passwordHash) {
          throw new AuthenticationError('Invalid credentials');
        }
        if (!locked.totpSecret || locked.totpEnrolledAt === null) {
          throw new AuthenticationError('A second factor must be enrolled to change the password');
        }

        const secret = this.readTotpSecret(locked);
        const verification = verifyTotp(
          secret,
          input.totpCode,
          now.getTime(),
          this.config.totp,
          locked.lastTotpStep,
        );
        if (!verification.valid) {
          codeRejected = true;
          throw new AuthenticationError('Invalid verification code');
        }

        await tx
          .update(admins)
          .set({
            passwordHash: newPasswordHash,
            lastTotpStep: verification.step,
            // Both factors have just been satisfied, so this is the second and
            // only other place the ADR-0029 counter may legitimately clear.
            failedLoginAttempts: 0,
            lockedUntil: null,
            updatedAt: now,
            // Re-seal a pre-ADR-0028 plaintext secret on the same "the code
            // verified, so the stored value is genuinely the secret" condition
            // `verifyMfa` uses.
            ...(isEncrypted(locked.totpSecret)
              ? {}
              : { totpSecret: this.encryption.encrypt(secret, totpSecretContext(locked.id)) }),
          })
          .where(eq(admins.id, locked.id));

        const revokedSessions = await this.sessions.revokeAllForAdmin(tx, locked.id, {
          exceptSessionId: admin.sessionId,
          reason: 'password_changed',
          ...(correlationId !== undefined ? { correlationId } : {}),
        });

        await this.audit.append(tx, {
          actorType: 'admin',
          actorId: locked.id,
          action: AuditAction.AdminPasswordChanged,
          resourceType: AuditResource.Admin,
          resourceId: locked.id,
          correlationId: correlationId ?? null,
          metadata: { revokedSessions: revokedSessions.toString() },
        });

        return { revokedSessions };
      });
    } finally {
      // Counted outside the transaction for the ADR-0029 reason: the throw above
      // rolls it back, and an increment written inside would roll back with it.
      if (codeRejected) {
        await this.recordFailedAttempt(admin.adminId, 'totp', correlationId, 'password_change');
      }
    }
  }

  /**
   * Clear an admin's second factor so they enrol a new one at next login
   * (ADR-0030). Runs inside the approving four-eyes transaction — never on its
   * own authority — so the reset and the decision that authorized it commit
   * together.
   *
   * Three things are cleared beyond the secret itself, each for its own reason.
   * `totpEnrolledAt` because `beginMfaEnrolment` refuses an already-enrolled
   * admin, so the row must look unenrolled for recovery to work at all.
   * `lastTotpStep` because a stale step from the old secret would reject codes
   * from the new one until wall-clock time caught up. And the ADR-0029 lockout,
   * because an operator whose authenticator is lost has usually been failing the
   * second factor into a lock — leaving it set would recover the credential and
   * still deny the login.
   */
  async resetTotp(
    executor: DbExecutor,
    input: {
      readonly targetAdminId: string;
      readonly actorId: string;
      readonly correlationId?: string;
    },
    now: Date,
  ): Promise<{ readonly revokedSessions: number; readonly target: AdminRow }> {
    const [target] = await executor
      .select()
      .from(admins)
      .where(eq(admins.id, input.targetAdminId))
      .limit(1)
      .for('update');
    if (!target) throw new NotFoundError('Admin not found', { adminId: input.targetAdminId });

    await executor
      .update(admins)
      .set({
        totpSecret: null,
        totpEnrolledAt: null,
        lastTotpStep: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(admins.id, target.id));

    // A factor being reset is a factor that may be in the wrong hands. Any
    // session standing on it has to go, including — unlike the self-service
    // password change — the target's own.
    const revokedSessions = await this.sessions.revokeAllForAdmin(executor, target.id, {
      reason: 'totp_reset',
      actorId: input.actorId,
      ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    });

    await this.audit.append(executor, {
      actorType: 'admin',
      actorId: input.actorId,
      action: AuditAction.AdminMfaReset,
      resourceType: AuditResource.Admin,
      resourceId: target.id,
      before: { mfaEnrolled: target.totpEnrolledAt !== null },
      after: { mfaEnrolled: false },
      correlationId: input.correlationId ?? null,
      metadata: { revokedSessions: revokedSessions.toString() },
    });

    return { revokedSessions, target };
  }

  /**
   * Staff the back office (`admins.manage`, super_admin only). Four-eyes is
   * only a real control if a second, differently-roled operator can exist, so
   * this is the capability that makes the maker-checker split operable rather
   * than a test fixture.
   *
   * The new admin starts with a password and no second factor, exactly like the
   * seeded one: they enrol at first login and no session is issued before they do.
   */
  async createAdmin(
    actor: AdminPrincipal,
    input: { readonly email: string; readonly role: AdminRole; readonly password: string },
    correlationId?: string,
  ): Promise<AdminSummary> {
    if (input.password.length < ADMIN_MIN_PASSWORD_LENGTH) {
      throw new ValidationError(
        `An admin password must be at least ${ADMIN_MIN_PASSWORD_LENGTH} characters`,
      );
    }
    const email = input.email.trim().toLowerCase();
    const passwordHash = await hashPassword(input.password);
    const now = this.clock.now();
    const id = this.ids.next();

    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(admins)
        .values({
          id,
          email,
          role: input.role,
          passwordHash,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: admins.email })
        .returning();
      if (inserted.length === 0) {
        throw new ConflictError('An admin with that email already exists', { email });
      }

      await this.audit.append(tx, {
        actorType: 'admin',
        actorId: actor.adminId,
        action: AuditAction.AdminCreated,
        resourceType: AuditResource.Admin,
        resourceId: id,
        after: { role: input.role, status: 'active', mfaEnrolled: false },
        correlationId: correlationId ?? null,
      });

      return toSummary(inserted[0]!);
    });
  }

  /** The back-office roster. Never exposes password or TOTP material. */
  async listAdmins(): Promise<AdminSummary[]> {
    const rows = await this.db.select().from(admins).orderBy(asc(admins.createdAt));
    return rows.map(toSummary);
  }

  /**
   * Disable or re-enable an operator. Disabling is immediate: `validateToken`
   * rejects a disabled admin's live sessions on their next request, so this is
   * the offboarding lever, not a cosmetic flag.
   */
  async setAdminStatus(
    actor: AdminPrincipal,
    adminId: string,
    status: 'active' | 'disabled',
    correlationId?: string,
  ): Promise<AdminSummary> {
    if (adminId === actor.adminId && status === 'disabled') {
      throw new ValidationError('An admin cannot disable their own account');
    }
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(admins)
        .where(eq(admins.id, adminId))
        .limit(1)
        .for('update');
      if (!existing) throw new NotFoundError('Admin not found', { adminId });
      if (existing.status === status) return toSummary(existing);

      const [row] = await tx
        .update(admins)
        .set({ status, updatedAt: now })
        .where(eq(admins.id, adminId))
        .returning();

      await this.audit.append(tx, {
        actorType: 'admin',
        actorId: actor.adminId,
        action: AuditAction.AdminStatusChanged,
        resourceType: AuditResource.Admin,
        resourceId: adminId,
        before: { status: existing.status },
        after: { status },
        correlationId: correlationId ?? null,
      });

      return toSummary(row!);
    });
  }

  /** The admin's own profile, for `GET /v1/admin/me`. */
  async getAdmin(adminId: string): Promise<{
    readonly id: string;
    readonly email: string;
    readonly role: AdminRole;
    readonly mfaEnrolled: boolean;
    readonly lastLoginAt: Date | null;
  }> {
    const [admin] = await this.db.select().from(admins).where(eq(admins.id, adminId)).limit(1);
    if (!admin) throw new AuthenticationError('Admin not found');
    return {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      mfaEnrolled: admin.totpEnrolledAt !== null,
      lastLoginAt: admin.lastLoginAt,
    };
  }

  /**
   * Burn the same scrypt work as a real verification for an unknown or disabled
   * admin, so the response time does not distinguish them.
   */
  private async decoyVerify(password: string): Promise<void> {
    this.decoyHash ??= await hashPassword(randomBytes(32).toString('hex'));
    await verifyPassword(password, this.decoyHash);
  }
}

export const DEFAULT_ADMIN_TOTP_CONFIG = DEFAULT_TOTP_CONFIG;
