import { AuthenticationError, type EventClock, type IdGenerator } from '@fides/domain';
import { and, eq, isNull, lt, ne } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../../database/db.types';
import { generateToken, sha256Hex } from '../../../shared/crypto/secrets';
import { AuditAction, AuditResource } from '../../audit/application/audit-actions';
import { AuditService } from '../../audit/application/audit.service';
import { admins, adminSessions, type AdminRole } from '../infra/admin.schema';

/** Distinct from the customer `fat_` prefix: the two never share a namespace. */
export const ADMIN_TOKEN_PREFIX = 'ast';

/** Skip idle-deadline writes when the row was touched more recently than this. */
export const ADMIN_LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;

/** Back-office session lifetimes (ADR-0025); env-overridable. */
export interface AdminSessionConfig {
  /** Sliding idle window: the session dies without activity inside it. */
  readonly idleTtlMs: number;
  /** Hard cap on session age regardless of activity. */
  readonly absoluteTtlMs: number;
}

export const DEFAULT_ADMIN_SESSION_CONFIG: AdminSessionConfig = {
  idleTtlMs: 30 * 60 * 1000,
  absoluteTtlMs: 8 * 60 * 60 * 1000,
};

/** The authenticated back-office operator attached to a request by the guard. */
export interface AdminPrincipal {
  readonly adminId: string;
  readonly sessionId: string;
  readonly role: AdminRole;
  readonly email: string;
}

export interface IssuedAdminSession {
  readonly sessionId: string;
  readonly adminId: string;
  readonly token: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

/**
 * Back-office sessions (ADR-0025). One opaque 256-bit token per session, stored
 * only as a SHA-256 hash and validated against the row on every request, so
 * revocation is immediate — the ADR-0020 pattern, on a separate table.
 *
 * Unlike the customer session there is no refresh token: at a 30-minute idle
 * window the sliding `idleExpiresAt` (capped by `absoluteExpiresAt`) is the
 * whole lifetime policy, and rotation would buy nothing.
 */
export class AdminSessionService {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly clock: EventClock,
    private readonly audit: AuditService,
    private readonly config: AdminSessionConfig = DEFAULT_ADMIN_SESSION_CONFIG,
  ) {}

  /**
   * Issue a session for an admin who has satisfied BOTH factors. Takes the
   * caller's executor so it commits atomically with the login challenge's
   * consumption and its audit record.
   */
  async issueSession(
    executor: DbExecutor,
    adminId: string,
    correlationId?: string,
  ): Promise<IssuedAdminSession> {
    const now = this.clock.now();
    const token = generateToken(ADMIN_TOKEN_PREFIX);
    const absoluteExpiresAt = new Date(now.getTime() + this.config.absoluteTtlMs);
    const idleExpiresAt = this.cappedDeadline(now, this.config.idleTtlMs, absoluteExpiresAt);
    const sessionId = this.ids.next();

    await executor.insert(adminSessions).values({
      id: sessionId,
      adminId,
      tokenHash: sha256Hex(token),
      idleExpiresAt,
      absoluteExpiresAt,
      createdAt: now,
      lastUsedAt: now,
    });
    // Both factors are satisfied, so this is the one place authentication
    // completes — and therefore the only correct place to clear the ADR-0029
    // lockout counter. Clearing it at the password step instead would let an
    // attacker who knows the password reset the counter at will and grind the
    // second factor indefinitely.
    await executor
      .update(admins)
      .set({ lastLoginAt: now, updatedAt: now, failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(admins.id, adminId));

    await this.audit.append(executor, {
      actorType: 'admin',
      actorId: adminId,
      action: AuditAction.AdminSessionIssued,
      resourceType: AuditResource.AdminSession,
      resourceId: sessionId,
      correlationId: correlationId ?? null,
      metadata: { absoluteExpiresAtMs: absoluteExpiresAt.getTime().toString() },
    });

    return { sessionId, adminId, token, idleExpiresAt, absoluteExpiresAt };
  }

  /**
   * Resolve an opaque admin token to its principal, sliding the idle deadline
   * forward. Rejects unknown, revoked, idle-dead, and absolute-dead sessions,
   * and cuts off disabled admins immediately.
   */
  async validateToken(token: string): Promise<AdminPrincipal> {
    const now = this.clock.now();
    const [row] = await this.db
      .select({
        session: adminSessions,
        role: admins.role,
        email: admins.email,
        status: admins.status,
      })
      .from(adminSessions)
      .innerJoin(admins, eq(admins.id, adminSessions.adminId))
      .where(eq(adminSessions.tokenHash, sha256Hex(token)))
      .limit(1);

    if (!row) throw new AuthenticationError('Invalid admin token');
    const { session } = row;
    if (session.revokedAt !== null) throw new AuthenticationError('Admin session revoked');
    if (session.idleExpiresAt.getTime() <= now.getTime()) {
      throw new AuthenticationError('Admin session expired through inactivity');
    }
    if (session.absoluteExpiresAt.getTime() <= now.getTime()) {
      throw new AuthenticationError('Admin session expired');
    }
    if (row.status === 'disabled') throw new AuthenticationError('Admin account disabled');

    // Slide the idle deadline, throttled like the customer session's lastUsedAt:
    // the deadline is then at most one interval stale against a 30-minute window.
    if (now.getTime() - session.lastUsedAt.getTime() >= ADMIN_LAST_USED_WRITE_INTERVAL_MS) {
      await this.db
        .update(adminSessions)
        .set({
          lastUsedAt: now,
          idleExpiresAt: this.cappedDeadline(now, this.config.idleTtlMs, session.absoluteExpiresAt),
        })
        .where(and(eq(adminSessions.id, session.id), lt(adminSessions.lastUsedAt, now)));
    }

    return {
      adminId: session.adminId,
      sessionId: session.id,
      role: row.role,
      email: row.email,
    };
  }

  /** Revoke a session immediately. Idempotent; audited only on a real revocation. */
  async revokeSession(
    sessionId: string,
    options: {
      readonly adminId?: string;
      readonly reason?: string;
      readonly correlationId?: string;
    } = {},
  ): Promise<void> {
    const now = this.clock.now();
    const reason = options.reason ?? 'logout';
    await this.db.transaction(async (tx) => {
      const conditions = [eq(adminSessions.id, sessionId), isNull(adminSessions.revokedAt)];
      if (options.adminId !== undefined) {
        conditions.push(eq(adminSessions.adminId, options.adminId));
      }
      const revoked = await tx
        .update(adminSessions)
        .set({ revokedAt: now, revokedReason: reason })
        .where(and(...conditions))
        .returning({ id: adminSessions.id, adminId: adminSessions.adminId });
      if (revoked.length === 0) return;

      await this.audit.append(tx, {
        actorType: 'admin',
        actorId: revoked[0]!.adminId,
        action: AuditAction.AdminSessionRevoked,
        resourceType: AuditResource.AdminSession,
        resourceId: sessionId,
        before: { revoked: false },
        after: { revoked: true, reason },
        correlationId: options.correlationId ?? null,
      });
    });
  }

  /**
   * Revoke every live session an admin holds, optionally sparing one (ADR-0030).
   *
   * Takes the caller's executor because both callers need it to commit with the
   * credential change that motivated it: a password rotation whose old sessions
   * survive, or a second-factor reset whose old sessions survive, would leave
   * the very access the change was meant to cut off.
   *
   * `exceptSessionId` spares the caller's own session on a self-service change,
   * so routine rotation does not sign the operator out of the request they are
   * making. A reset performed *on* an admin spares nothing.
   *
   * Returns how many were revoked, and audits each one individually — the
   * resource of a revocation is the session, and collapsing them would lose
   * which sessions actually existed at the time.
   */
  async revokeAllForAdmin(
    executor: DbExecutor,
    adminId: string,
    options: {
      readonly exceptSessionId?: string;
      readonly reason: string;
      readonly correlationId?: string;
      /** Whose act this was; the target admin when they revoked their own. */
      readonly actorId?: string;
    },
  ): Promise<number> {
    const now = this.clock.now();
    const conditions = [eq(adminSessions.adminId, adminId), isNull(adminSessions.revokedAt)];
    if (options.exceptSessionId !== undefined) {
      conditions.push(ne(adminSessions.id, options.exceptSessionId));
    }

    const revoked = await executor
      .update(adminSessions)
      .set({ revokedAt: now, revokedReason: options.reason })
      .where(and(...conditions))
      .returning({ id: adminSessions.id });

    for (const session of revoked) {
      await this.audit.append(executor, {
        actorType: 'admin',
        actorId: options.actorId ?? adminId,
        action: AuditAction.AdminSessionRevoked,
        resourceType: AuditResource.AdminSession,
        resourceId: session.id,
        before: { revoked: false },
        after: { revoked: true, reason: options.reason, adminId },
        correlationId: options.correlationId ?? null,
      });
    }

    return revoked.length;
  }

  private cappedDeadline(now: Date, ttlMs: number, absolute: Date): Date {
    return new Date(Math.min(now.getTime() + ttlMs, absolute.getTime()));
  }
}
