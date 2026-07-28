import type { EventClock } from '@fides/domain';
import { isNotNull, lte, or } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { enrolmentTokens, scaGrants, sessions, webauthnChallenges } from '../infra/auth.schema';
import { emailVerifications } from '../infra/identity.schema';

export interface SweepResult {
  readonly scaGrants: number;
  readonly webauthnChallenges: number;
  readonly enrolmentTokens: number;
  readonly emailVerifications: number;
  readonly sessions: number;
}

/**
 * Deletes dead security rows per the retention policy (ADR-0021, tightened by
 * ADR-0024): consumed or expired one-time secrets and dead sessions are all
 * purged promptly. Dead sessions no longer keep a 90-day forensic grace — their
 * revocation and refresh-reuse events now live in the tamper-evident audit
 * trail, which carries the session, device, reason, and timestamps. SCA grants
 * are still swept before sessions (they reference session rows), and their
 * 5-minute TTL guarantees any grant of a dead session is itself long dead. The
 * audit trail is append-only and is never swept.
 */
export class IdentitySweeper {
  constructor(
    private readonly db: Database,
    private readonly clock: EventClock,
  ) {}

  async sweep(): Promise<SweepResult> {
    const now = this.clock.now();

    const grants = await this.db
      .delete(scaGrants)
      .where(or(isNotNull(scaGrants.consumedAt), lte(scaGrants.expiresAt, now)))
      .returning({ id: scaGrants.id });

    const challenges = await this.db
      .delete(webauthnChallenges)
      .where(or(isNotNull(webauthnChallenges.consumedAt), lte(webauthnChallenges.expiresAt, now)))
      .returning({ id: webauthnChallenges.id });

    const tokens = await this.db
      .delete(enrolmentTokens)
      .where(or(isNotNull(enrolmentTokens.consumedAt), lte(enrolmentTokens.expiresAt, now)))
      .returning({ id: enrolmentTokens.id });

    const verifications = await this.db
      .delete(emailVerifications)
      .where(or(isNotNull(emailVerifications.consumedAt), lte(emailVerifications.expiresAt, now)))
      .returning({ id: emailVerifications.id });

    // Purge promptly (ADR-0024): revoked, idle-dead, or absolute-dead. The
    // forensic record of any revocation now lives in the audit trail.
    const deadSessions = await this.db
      .delete(sessions)
      .where(
        or(
          isNotNull(sessions.revokedAt),
          lte(sessions.absoluteExpiresAt, now),
          lte(sessions.refreshExpiresAt, now),
        ),
      )
      .returning({ id: sessions.id });

    return {
      scaGrants: grants.length,
      webauthnChallenges: challenges.length,
      enrolmentTokens: tokens.length,
      emailVerifications: verifications.length,
      sessions: deadSessions.length,
    };
  }
}
