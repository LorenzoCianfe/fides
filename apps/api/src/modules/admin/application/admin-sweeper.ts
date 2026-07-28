import type { EventClock } from '@fides/domain';
import { isNotNull, lte, or } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { adminLoginChallenges, adminSessions } from '../infra/admin.schema';

export interface AdminSweepResult {
  readonly loginChallenges: number;
  readonly sessions: number;
}

/**
 * Retention for back-office security rows, on the same policy the customer
 * sweeper applies (ADR-0021, tightened by ADR-0024): consumed or expired
 * one-time secrets and dead sessions are purged promptly, because their
 * forensic record lives in the tamper-evident audit trail rather than in the
 * mutable row. A dead admin session left lying around is a back-office door,
 * so this matters more here, not less.
 */
export class AdminSweeper {
  constructor(
    private readonly db: Database,
    private readonly clock: EventClock,
  ) {}

  async sweep(): Promise<AdminSweepResult> {
    const now = this.clock.now();

    const challenges = await this.db
      .delete(adminLoginChallenges)
      .where(
        or(isNotNull(adminLoginChallenges.consumedAt), lte(adminLoginChallenges.expiresAt, now)),
      )
      .returning({ id: adminLoginChallenges.id });

    const sessions = await this.db
      .delete(adminSessions)
      .where(
        or(
          isNotNull(adminSessions.revokedAt),
          lte(adminSessions.idleExpiresAt, now),
          lte(adminSessions.absoluteExpiresAt, now),
        ),
      )
      .returning({ id: adminSessions.id });

    return { loginChallenges: challenges.length, sessions: sessions.length };
  }
}
