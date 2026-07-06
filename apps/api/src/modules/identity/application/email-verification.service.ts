import {
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
  type EventClock,
  type IdGenerator,
} from '@fides/domain';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { sha256Hex } from '../../../shared/crypto/secrets';
import { emailVerifications, users } from '../infra/identity.schema';
import { issueEnrolmentToken } from './enrolment-token';

export interface VerifyEmailResult {
  /** One-time token authorizing the first passkey registration (ADR-0020). */
  readonly enrolmentToken: string;
}

/**
 * Verifies the email-verification code, marks the user's email verified, and
 * issues the enrolment token that gates the first passkey registration.
 */
export class EmailVerificationService {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly clock: EventClock,
  ) {}

  async verifyEmail(userId: string, code: string): Promise<VerifyEmailResult> {
    const now = this.clock.now();

    const [row] = await this.db
      .select()
      .from(emailVerifications)
      .where(and(eq(emailVerifications.userId, userId), isNull(emailVerifications.consumedAt)))
      .orderBy(desc(emailVerifications.createdAt))
      .limit(1);

    if (!row) throw new NotFoundError('No pending email verification', { userId });
    if (row.expiresAt.getTime() < now.getTime()) {
      throw new PreconditionFailedError('Email verification code has expired');
    }
    if (row.codeHash !== sha256Hex(code)) {
      throw new ValidationError('Invalid email verification code');
    }

    return this.db.transaction(async (tx) => {
      await tx
        .update(emailVerifications)
        .set({ consumedAt: now })
        .where(eq(emailVerifications.id, row.id));
      await tx
        .update(users)
        .set({ emailVerifiedAt: now, updatedAt: now })
        .where(eq(users.id, userId));
      const enrolmentToken = await issueEnrolmentToken(tx, this.ids, this.clock, userId);
      return { enrolmentToken };
    });
  }
}
