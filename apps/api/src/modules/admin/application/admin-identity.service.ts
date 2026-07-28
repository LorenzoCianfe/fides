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
import type { Database } from '../../../database/db.types';
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
}

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
    private readonly config: AdminIdentityConfig,
  ) {}

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
  async login(email: string, password: string): Promise<AdminLoginChallenge> {
    const normalized = email.trim().toLowerCase();
    const [admin] = await this.db
      .select()
      .from(admins)
      .where(eq(admins.email, normalized))
      .limit(1);

    if (!admin || admin.status === 'disabled') {
      await this.decoyVerify(password);
      throw new AuthenticationError('Invalid credentials');
    }
    if (!(await verifyPassword(password, admin.passwordHash))) {
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
        .set({ totpSecret: secret, updatedAt: now })
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
   * typo rather than forcing the password step again. The route is throttled,
   * which is what bounds guessing against the 5-minute challenge window.
   */
  async verifyMfa(
    challengeToken: string,
    code: string,
    correlationId?: string,
  ): Promise<IssuedAdminSession> {
    const now = this.clock.now();
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

      const verification = verifyTotp(
        admin.totpSecret,
        code,
        now.getTime(),
        this.config.totp,
        admin.lastTotpStep,
      );
      if (!verification.valid) throw new AuthenticationError('Invalid verification code');

      const activating = admin.totpEnrolledAt === null;
      await tx
        .update(admins)
        .set({
          lastTotpStep: verification.step,
          updatedAt: now,
          ...(activating ? { totpEnrolledAt: now } : {}),
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
