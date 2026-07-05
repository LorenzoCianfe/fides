import {
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
  type EventClock,
} from '@fides/domain';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { sha256Hex } from '../../../shared/crypto/secrets';
import { emailVerifications, users } from '../infra/identity.schema';

/** Verifies the email-verification code and marks the user's email verified. */
export class EmailVerificationService {
  constructor(
    private readonly db: Database,
    private readonly clock: EventClock,
  ) {}

  async verifyEmail(userId: string, code: string): Promise<void> {
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

    await this.db.transaction(async (tx) => {
      await tx
        .update(emailVerifications)
        .set({ consumedAt: now })
        .where(eq(emailVerifications.id, row.id));
      await tx
        .update(users)
        .set({ emailVerifiedAt: now, updatedAt: now })
        .where(eq(users.id, userId));
    });
  }
}
