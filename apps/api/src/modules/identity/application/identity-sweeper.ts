import type { EventClock } from '@fides/domain';
import { and, isNotNull, lte, or } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { enrolmentTokens, scaGrants, sessions, webauthnChallenges } from '../infra/auth.schema';
import { emailVerifications } from '../infra/identity.schema';

/** Dead sessions keep forensic value until the audit trail lands (ADR-0021). */
export const DEAD_SESSION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface SweepResult {
  readonly scaGrants: number;
  readonly webauthnChallenges: number;
  readonly enrolmentTokens: number;
  readonly emailVerifications: number;
  readonly sessions: number;
}

/**
 * Deletes dead security rows per the ADR-0021 retention policy: consumed or
 * expired one-time secrets are purged promptly (hashed rows with no audit
 * value), dead sessions only after a 90-day forensic grace. SCA grants go
 * first — they reference sessions, and their 5-minute TTL guarantees any grant
 * of a 90-day-dead session is itself long dead.
 */
export class IdentitySweeper {
  constructor(
    private readonly db: Database,
    private readonly clock: EventClock,
  ) {}

  async sweep(): Promise<SweepResult> {
    const now = this.clock.now();
    const sessionDeadline = new Date(now.getTime() - DEAD_SESSION_RETENTION_MS);

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

    const deadSessions = await this.db
      .delete(sessions)
      .where(
        or(
          and(isNotNull(sessions.revokedAt), lte(sessions.revokedAt, sessionDeadline)),
          lte(sessions.absoluteExpiresAt, sessionDeadline),
          lte(sessions.refreshExpiresAt, sessionDeadline),
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
