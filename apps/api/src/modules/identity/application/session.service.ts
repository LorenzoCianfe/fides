import {
  AuthenticationError,
  AuthorizationError,
  InternalError,
  type EventClock,
  type IdGenerator,
} from '@fides/domain';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../../database/db.types';
import { generateToken, sha256Hex } from '../../../shared/crypto/secrets';
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

/** The authenticated caller attached to a request by the auth guard. */
export interface Principal {
  readonly userId: string;
  readonly sessionId: string;
  readonly deviceId: string;
  readonly userStatus: UserRow['status'];
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
    };
  }

  /**
   * Rotate the token pair. The superseded refresh hash is retained so that its
   * reuse — the stolen-token signal — revokes the session on sight.
   */
  async refresh(refreshToken: string): Promise<IssuedSession> {
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
        return { kind: 'reuse', sessionId: session.id };
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

  /**
   * Revoke a session immediately. Idempotent; when `userId` is given the
   * revocation is ownership-scoped (revoking someone else's session is a no-op).
   */
  async revokeSession(
    sessionId: string,
    options: { readonly userId?: string; readonly reason?: string } = {},
  ): Promise<void> {
    const conditions = [eq(sessions.id, sessionId), isNull(sessions.revokedAt)];
    if (options.userId !== undefined) conditions.push(eq(sessions.userId, options.userId));
    await this.db
      .update(sessions)
      .set({ revokedAt: this.clock.now(), revokedReason: options.reason ?? 'logout' })
      .where(and(...conditions));
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
