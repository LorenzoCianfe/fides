import { ValidationError, type EventClock, type IdGenerator } from '@fides/domain';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { generateNumericCode, sha256Hex } from '../../../shared/crypto/secrets';
import type { NotificationPort } from '../../../shared/notifications/notification.port';
import { credentials } from '../infra/auth.schema';
import { emailVerifications, users, type UserRow } from '../infra/identity.schema';
import { issueEnrolmentToken } from './enrolment-token';

export const EMAIL_VERIFICATION_TTL_MS = 15 * 60 * 1000;

export interface VerifyEmailResult {
  /** Returned on success so onboarding can resume on any device. */
  readonly userId: string;
  /** One-time token authorizing the first passkey registration (ADR-0020). */
  readonly enrolmentToken: string;
}

/**
 * Email-verification lifecycle, keyed by email so onboarding can resume on any
 * device: verifies codes, re-delivers them to passkey-less users (the re-issue
 * path for enrolment tokens that expire before the first passkey), and issues
 * the enrolment token gating the first passkey. Every failure is uniform, so
 * the surface cannot confirm which emails hold accounts (ADR-0021).
 */
export class EmailVerificationService {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly clock: EventClock,
    private readonly notifications: NotificationPort,
  ) {}

  async verifyEmail(email: string, code: string): Promise<VerifyEmailResult> {
    const now = this.clock.now();
    const user = await this.findUser(email);
    if (!user || user.status === 'suspended') throw invalidCode();

    const [row] = await this.db
      .select()
      .from(emailVerifications)
      .where(and(eq(emailVerifications.userId, user.id), isNull(emailVerifications.consumedAt)))
      .orderBy(desc(emailVerifications.createdAt))
      .limit(1);

    if (!row) throw invalidCode();
    if (row.expiresAt.getTime() <= now.getTime()) throw invalidCode();
    if (row.codeHash !== sha256Hex(code)) throw invalidCode();

    return this.db.transaction(async (tx) => {
      await tx
        .update(emailVerifications)
        .set({ consumedAt: now })
        .where(eq(emailVerifications.id, row.id));
      await tx
        .update(users)
        .set({ emailVerifiedAt: user.emailVerifiedAt ?? now, updatedAt: now })
        .where(eq(users.id, user.id));
      const enrolmentToken = await issueEnrolmentToken(tx, this.ids, this.clock, user.id);
      return { userId: user.id, enrolmentToken };
    });
  }

  /**
   * Re-deliver a verification code so its owner can obtain a fresh enrolment
   * token. Deliberately silent: unknown emails, suspended users, and users who
   * already hold a passkey (login covers them) all no-op indistinguishably.
   */
  async resendVerification(email: string): Promise<void> {
    const now = this.clock.now();
    const user = await this.findUser(email);
    if (!user || user.status === 'suspended') return;

    const [passkey] = await this.db
      .select({ id: credentials.id })
      .from(credentials)
      .where(eq(credentials.userId, user.id))
      .limit(1);
    if (passkey) return;

    const code = generateNumericCode();
    await this.db.insert(emailVerifications).values({
      id: this.ids.next(),
      userId: user.id,
      codeHash: sha256Hex(code),
      expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
    });
    await this.notifications.sendEmailVerification(user.email, code);
  }

  private async findUser(email: string): Promise<UserRow | undefined> {
    const normalized = email.trim().toLowerCase();
    const [user] = await this.db.select().from(users).where(eq(users.email, normalized)).limit(1);
    return user;
  }
}

/** Uniform failure: never reveals whether the email, the code, or the expiry was wrong. */
function invalidCode(): ValidationError {
  return new ValidationError('Invalid or expired verification code');
}
