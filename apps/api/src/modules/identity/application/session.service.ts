import {
  AuthenticationError,
  AuthorizationError,
  InternalError,
  type EventClock,
  type IdGenerator,
} from '@fides/domain';
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../../database/db.types';
import { csrfTokenMatches } from '../../../shared/crypto/csrf';
import { generateToken, sha256Hex } from '../../../shared/crypto/secrets';
import { AuditAction, AuditResource } from '../../audit/application/audit-actions';
import { AuditService } from '../../audit/application/audit.service';
import { devices, sessions } from '../infra/auth.schema';
import { users, type UserRow } from '../infra/identity.schema';

export const ACCESS_TOKEN_PREFIX = 'fat';
export const REFRESH_TOKEN_PREFIX = 'frt';

/** Skip `lastUsedAt` writes when the row was touched more recently than this. */
export const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;

/** Session lifetimes (ADR-0020); env-overridable via SESSION_*_TTL_MS. */
export interface SessionConfig {
  /** Opaque access-token lifetime. */
  readonly accessTtlMs: number;
  /** Idle window: the session dies if not refreshed within it. */
  readonly refreshIdleTtlMs: number;
  /** Hard cap on session age regardless of activity. */
  readonly absoluteTtlMs: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  accessTtlMs: 15 * 60 * 1000,
  refreshIdleTtlMs: 30 * 24 * 60 * 60 * 1000,
  absoluteTtlMs: 90 * 24 * 60 * 60 * 1000,
};

/** Client-declared device metadata; untrusted until mobile attestation (Slice 8). */
export interface DeviceDescriptor {
  readonly name: string;
  readonly platform: string;
}

export interface IssuedSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

/** One row of a user's session list; token hashes never leave the service. */
export interface SessionSummary {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly devicePlatform: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
}

/** The authenticated caller attached to a request by the auth guard. */
export interface Principal {
  readonly userId: string;
  readonly sessionId: string;
  readonly deviceId: string;
  readonly userStatus: UserRow['status'];
  /**
   * SHA-256 of this session's CSRF token, or null when the session is carried
   * by a bearer token (ADR-0027). The guard needs it to complete the
   * double-submit check without a second query.
   */
  readonly csrfTokenHash: string | null;
}

/**
 * Server-side sessions with opaque bearer tokens (ADR-0020).
 *
 * Tokens are 256-bit random values stored only as SHA-256 hashes. Every
 * request is validated against the session row, so revocation is immediate.
 * Refresh rotates both tokens; presenting a superseded refresh token is
 * treated as theft and revokes the whole session.
 */
export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly clock: EventClock,
    private readonly audit: AuditService,
    private readonly config: SessionConfig = DEFAULT_SESSION_CONFIG,
  ) {}

  /**
   * Create a session bound to a (matched-or-created) device row. Accepts the
   * caller's executor so ceremony services can issue atomically with their
   * own writes.
   */
  async issueSession(
    executor: DbExecutor,
    userId: string,
    device: DeviceDescriptor,
  ): Promise<IssuedSession> {
    const now = this.clock.now();
    const deviceId = await this.matchOrCreateDevice(executor, userId, device);

    const accessToken = generateToken(ACCESS_TOKEN_PREFIX);
    const refreshToken = generateToken(REFRESH_TOKEN_PREFIX);
    const absoluteExpiresAt = new Date(now.getTime() + this.config.absoluteTtlMs);
    const accessTokenExpiresAt = this.cappedDeadline(
      now,
      this.config.accessTtlMs,
      absoluteExpiresAt,
    );
    const refreshExpiresAt = this.cappedDeadline(
      now,
      this.config.refreshIdleTtlMs,
      absoluteExpiresAt,
    );

    const sessionId = this.ids.next();
    await executor.insert(sessions).values({
      id: sessionId,
      userId,
      deviceId,
      accessTokenHash: sha256Hex(accessToken),
      refreshTokenHash: sha256Hex(refreshToken),
      accessTokenExpiresAt,
      refreshExpiresAt,
      absoluteExpiresAt,
      createdAt: now,
      lastUsedAt: now,
    });

    return {
      sessionId,
      userId,
      deviceId,
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      refreshExpiresAt,
      absoluteExpiresAt,
    };
  }

  /**
   * Resolve an opaque access token to its principal. Rejects unknown, expired,
   * and revoked sessions, and cuts off suspended users immediately.
   */
  async validateAccessToken(accessToken: string): Promise<Principal> {
    const now = this.clock.now();
    const [row] = await this.db
      .select({ session: sessions, userStatus: users.status })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.accessTokenHash, sha256Hex(accessToken)))
      .limit(1);

    if (!row) throw new AuthenticationError('Invalid access token');
    const { session } = row;
    if (session.revokedAt !== null) throw new AuthenticationError('Session revoked');
    if (session.accessTokenExpiresAt.getTime() <= now.getTime()) {
      throw new AuthenticationError('Access token expired');
    }
    if (session.absoluteExpiresAt.getTime() <= now.getTime()) {
      throw new AuthenticationError('Session expired');
    }
    if (row.userStatus === 'suspended') throw new AuthorizationError('Account suspended');

    if (now.getTime() - session.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS) {
      await this.db
        .update(sessions)
        .set({ lastUsedAt: now })
        .where(and(eq(sessions.id, session.id), lt(sessions.lastUsedAt, now)));
    }

    return {
      userId: session.userId,
      sessionId: session.id,
      deviceId: session.deviceId,
      userStatus: row.userStatus,
      csrfTokenHash: session.csrfTokenHash,
    };
  }

  /**
   * Bind a CSRF token to a session, or clear it (ADR-0027).
   *
   * Kept separate from `issueSession` so the ceremony services that mint
   * sessions stay unaware of HTTP transport: the controller decides the
   * transport, and only a cookie-mode response pays for this write. A session
   * with no hash cannot authenticate by cookie at all, so the check fails
   * closed for anything issued in bearer mode.
   */
  async attachCsrfToken(sessionId: string, csrfTokenHash: string | null): Promise<void> {
    await this.db.update(sessions).set({ csrfTokenHash }).where(eq(sessions.id, sessionId));
  }

  /**
   * Rotate the token pair. The superseded refresh hash is retained so that its
   * reuse — the stolen-token signal — revokes the session on sight.
   *
   * `presentedCsrfToken` is supplied only when the refresh token arrived on a
   * cookie (ADR-0027). Refresh is deliberately outside `SessionAuthGuard` — it
   * runs on an expired access token — so the guard's CSRF check cannot cover
   * it, yet it is state-changing and cookie-driven. The check therefore runs
   * here, against the row already loaded `FOR UPDATE`, before anything rotates.
   */
  async refresh(
    refreshToken: string,
    correlationId?: string,
    presentedCsrfToken?: { readonly value: string | undefined },
  ): Promise<IssuedSession> {
    const hash = sha256Hex(refreshToken);

    // Reuse detection must OUTLIVE this transaction: throwing inside it would
    // roll the revocation back. The reuse branch therefore returns an outcome
    // and the error is raised only after the revocation has committed.
    type RefreshOutcome =
      | { readonly kind: 'rotated'; readonly session: IssuedSession }
      | { readonly kind: 'reuse'; readonly sessionId: string };

    const outcome = await this.db.transaction(async (tx): Promise<RefreshOutcome> => {
      const now = this.clock.now();
      const [session] = await tx
        .select()
        .from(sessions)
        .where(or(eq(sessions.refreshTokenHash, hash), eq(sessions.previousRefreshTokenHash, hash)))
        .limit(1)
        .for('update');

      if (!session) throw new AuthenticationError('Invalid refresh token');
      if (session.revokedAt !== null) throw new AuthenticationError('Session revoked');

      if (session.previousRefreshTokenHash === hash) {
        await tx
          .update(sessions)
          .set({ revokedAt: now, revokedReason: 'refresh_token_reuse' })
          .where(eq(sessions.id, session.id));
        // Record the stolen-token signal atomically with the revocation (ADR-0024).
        await this.audit.append(tx, {
          actorType: 'user',
          actorId: session.userId,
          action: AuditAction.SessionRefreshReuseRevoked,
          resourceType: AuditResource.Session,
          resourceId: session.id,
          before: { revoked: false },
          after: { revoked: true, reason: 'refresh_token_reuse' },
          correlationId: correlationId ?? null,
        });
        return { kind: 'reuse', sessionId: session.id };
      }
      // Ordered after reuse detection so a stolen token still trips the alarm,
      // but before any rotation: a cross-site caller must not be able to churn
      // a victim's tokens, which would strand the real client on a dead one.
      if (
        presentedCsrfToken &&
        !csrfTokenMatches(presentedCsrfToken.value, session.csrfTokenHash)
      ) {
        throw new AuthorizationError('Missing or invalid CSRF token');
      }

      if (
        session.refreshExpiresAt.getTime() <= now.getTime() ||
        session.absoluteExpiresAt.getTime() <= now.getTime()
      ) {
        throw new AuthenticationError('Session expired');
      }

      const accessToken = generateToken(ACCESS_TOKEN_PREFIX);
      const nextRefreshToken = generateToken(REFRESH_TOKEN_PREFIX);
      const accessTokenExpiresAt = this.cappedDeadline(
        now,
        this.config.accessTtlMs,
        session.absoluteExpiresAt,
      );
      const refreshExpiresAt = this.cappedDeadline(
        now,
        this.config.refreshIdleTtlMs,
        session.absoluteExpiresAt,
      );

      await tx
        .update(sessions)
        .set({
          accessTokenHash: sha256Hex(accessToken),
          refreshTokenHash: sha256Hex(nextRefreshToken),
          previousRefreshTokenHash: hash,
          accessTokenExpiresAt,
          refreshExpiresAt,
          lastUsedAt: now,
        })
        .where(eq(sessions.id, session.id));

      return {
        kind: 'rotated',
        session: {
          sessionId: session.id,
          userId: session.userId,
          deviceId: session.deviceId,
          accessToken,
          refreshToken: nextRefreshToken,
          accessTokenExpiresAt,
          refreshExpiresAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
        },
      };
    });

    if (outcome.kind === 'reuse') {
      throw new AuthenticationError('Refresh token reuse detected; session revoked', {
        sessionId: outcome.sessionId,
      });
    }
    return outcome.session;
  }

  /** Active (unrevoked, unexpired) sessions for a user, most recently used first. */
  async listSessions(userId: string): Promise<SessionSummary[]> {
    const now = this.clock.now();
    return this.db
      .select({
        sessionId: sessions.id,
        deviceId: devices.id,
        deviceName: devices.name,
        devicePlatform: devices.platform,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
      })
      .from(sessions)
      .innerJoin(devices, eq(devices.id, sessions.deviceId))
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.refreshExpiresAt, now),
          gt(sessions.absoluteExpiresAt, now),
        ),
      )
      .orderBy(desc(sessions.lastUsedAt));
  }

  /**
   * Revoke a session immediately. Idempotent; when `userId` is given the
   * revocation is ownership-scoped (revoking someone else's session is a no-op).
   */
  async revokeSession(
    sessionId: string,
    options: {
      readonly userId?: string;
      readonly reason?: string;
      readonly correlationId?: string;
    } = {},
  ): Promise<void> {
    const now = this.clock.now();
    const reason = options.reason ?? 'logout';
    await this.db.transaction(async (tx) => {
      const conditions = [eq(sessions.id, sessionId), isNull(sessions.revokedAt)];
      if (options.userId !== undefined) conditions.push(eq(sessions.userId, options.userId));
      const revoked = await tx
        .update(sessions)
        .set({ revokedAt: now, revokedReason: reason })
        .where(and(...conditions))
        .returning({ id: sessions.id, userId: sessions.userId });
      // Only a real revocation is audited: revoking an already-dead or another
      // user's session updates no row and records nothing (ADR-0024).
      if (revoked.length === 0) return;
      await this.audit.append(tx, {
        actorType: 'user',
        actorId: revoked[0]!.userId,
        action: AuditAction.SessionRevoked,
        resourceType: AuditResource.Session,
        resourceId: sessionId,
        before: { revoked: false },
        after: { revoked: true, reason },
        correlationId: options.correlationId ?? null,
      });
    });
  }

  private cappedDeadline(now: Date, ttlMs: number, absolute: Date): Date {
    return new Date(Math.min(now.getTime() + ttlMs, absolute.getTime()));
  }

  private async matchOrCreateDevice(
    executor: DbExecutor,
    userId: string,
    device: DeviceDescriptor,
  ): Promise<string> {
    const inserted = await executor
      .insert(devices)
      .values({ id: this.ids.next(), userId, name: device.name, platform: device.platform })
      .onConflictDoNothing({ target: [devices.userId, devices.name, devices.platform] })
      .returning({ id: devices.id });
    if (inserted.length === 1) return inserted[0]!.id;

    const [existing] = await executor
      .select({ id: devices.id })
      .from(devices)
      .where(
        and(
          eq(devices.userId, userId),
          eq(devices.name, device.name),
          eq(devices.platform, device.platform),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new InternalError('Device row missing after an insert conflict', { userId });
    }
    return existing.id;
  }
}
