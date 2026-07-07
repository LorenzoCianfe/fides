import {
  ConflictError,
  createDomainEvent,
  ErrorCode,
  type EventClock,
  type IdGenerator,
} from '@fides/domain';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { generateNumericCode, sha256Hex } from '../../../shared/crypto/secrets';
import type { NotificationPort } from '../../../shared/notifications/notification.port';
import { appendToOutbox } from '../../../shared/outbox/outbox.writer';
import type { KycDecision, KycPort } from '../../kyc/application/kyc.port';
import { kycApplications } from '../../kyc/infra/kyc.schema';
import { emailVerifications, users } from '../infra/identity.schema';
import { EMAIL_VERIFICATION_TTL_MS } from './email-verification.service';

export const KYC_APPROVED_EVENT = 'kyc.approved';

export interface RegisterInput {
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  /** ISO 8601 date (YYYY-MM-DD). */
  readonly dateOfBirth: string;
  readonly phone?: string;
  readonly addressLine1: string;
  readonly addressLine2?: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface RegisterResult {
  readonly userId: string;
  readonly status: string;
  readonly kycStatus: string;
}

/**
 * Onboards a natural person: creates the user (status `onboarding`), issues an
 * email-verification code through the notification port, and submits a KYC
 * application. On approval a `kyc.approved` event is enqueued for downstream
 * account provisioning (Slice 4).
 */
export class RegistrationService {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly clock: EventClock,
    private readonly kyc: KycPort,
    private readonly notifications: NotificationPort,
  ) {}

  async register(input: RegisterInput): Promise<RegisterResult> {
    const email = input.email.trim().toLowerCase();

    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) {
      throw new ConflictError('Email already registered', { email }, ErrorCode.CONFLICT);
    }

    const userId = this.ids.next();
    const now = this.clock.now();
    const code = generateNumericCode();

    await this.db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        email,
        status: 'onboarding',
        givenName: input.givenName,
        familyName: input.familyName,
        dateOfBirth: input.dateOfBirth,
        phone: input.phone ?? null,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        city: input.city,
        postalCode: input.postalCode,
        country: input.country,
      });
      await tx.insert(emailVerifications).values({
        id: this.ids.next(),
        userId,
        codeHash: sha256Hex(code),
        expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
      });
      await tx.insert(kycApplications).values({ id: this.ids.next(), userId, status: 'pending' });
    });

    await this.notifications.sendEmailVerification(email, code);

    const decision = await this.kyc.submit({
      userId,
      givenName: input.givenName,
      familyName: input.familyName,
      dateOfBirth: input.dateOfBirth,
      country: input.country,
    });
    await this.applyKycDecision(userId, decision);

    return { userId, status: 'onboarding', kycStatus: decision.outcome };
  }

  private async applyKycDecision(userId: string, decision: KycDecision): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(kycApplications)
        .set({
          status: decision.outcome,
          reference: decision.reference,
          decidedAt: this.clock.now(),
        })
        .where(and(eq(kycApplications.userId, userId), eq(kycApplications.status, 'pending')));

      if (decision.outcome === 'approved') {
        const event = createDomainEvent(
          {
            type: KYC_APPROVED_EVENT,
            aggregateType: 'user',
            aggregateId: userId,
            payload: { userId, reference: decision.reference },
          },
          { ids: this.ids, clock: this.clock },
        );
        await appendToOutbox(tx, event);
      }
    });
  }
}
