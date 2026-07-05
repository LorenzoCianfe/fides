import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, type TestDatabase } from '../../../test/db';
import { outbox } from '../../database/schema/outbox';
import { UuidV7Generator } from '../../shared/ids/uuid-v7';
import type { NotificationPort } from '../../shared/notifications/notification.port';
import { SystemClock } from '../../shared/time/system-clock';
import { MockKycAdapter } from '../kyc/infra/mock-kyc.adapter';
import { kycApplications } from '../kyc/infra/kyc.schema';
import { EmailVerificationService } from './application/email-verification.service';
import {
  KYC_APPROVED_EVENT,
  RegistrationService,
  type RegisterInput,
} from './application/registration.service';
import { users } from './infra/identity.schema';

class CapturingNotifications implements NotificationPort {
  readonly sent: { to: string; code: string }[] = [];
  async sendEmailVerification(to: string, code: string): Promise<void> {
    this.sent.push({ to, code });
    return Promise.resolve();
  }
}

const ids = new UuidV7Generator();
const clock = new SystemClock();
const { db, close } = createTestDb();
const kyc = new MockKycAdapter(ids);
const notifications = new CapturingNotifications();
const registration = new RegistrationService(db as TestDatabase, ids, clock, kyc, notifications);
const emailVerification = new EmailVerificationService(db as TestDatabase, clock);

const baseInput: Omit<RegisterInput, 'email'> = {
  givenName: 'Alice',
  familyName: 'Ada',
  dateOfBirth: '1990-05-01',
  addressLine1: '1 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'FR',
};

function register(email: string): Promise<{ userId: string; status: string; kycStatus: string }> {
  return registration.register({ ...baseInput, email });
}

describe('identity onboarding (integration)', () => {
  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetDb(db as TestDatabase);
    notifications.sent.length = 0;
  });

  it('registers a user, delivers a code, and auto-approves KYC with an event', async () => {
    const result = await register('Alice@Example.com');
    expect(result.status).toBe('onboarding');
    expect(result.kycStatus).toBe('approved');

    const [user] = await db.select().from(users).where(eq(users.id, result.userId));
    expect(user?.email).toBe('alice@example.com');
    expect(user?.emailVerifiedAt).toBeNull();

    const [application] = await db
      .select()
      .from(kycApplications)
      .where(eq(kycApplications.userId, result.userId));
    expect(application?.status).toBe('approved');
    expect(application?.reference).toMatch(/^kyc_/);

    expect(notifications.sent).toHaveLength(1);
    expect(notifications.sent[0]?.to).toBe('alice@example.com');
    expect(notifications.sent[0]?.code).toMatch(/^\d{6}$/);

    const events = await db.select().from(outbox).where(eq(outbox.type, KYC_APPROVED_EVENT));
    expect(events).toHaveLength(1);
  });

  it('verifies the email with the delivered code and rejects reuse', async () => {
    const { userId } = await register('bob@example.com');
    const code = notifications.sent[0]!.code;

    await emailVerification.verifyEmail(userId, code);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user?.emailVerifiedAt).not.toBeNull();

    await expect(emailVerification.verifyEmail(userId, code)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects an incorrect verification code', async () => {
    const { userId } = await register('carol@example.com');
    await expect(emailVerification.verifyEmail(userId, 'bad-code')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects a duplicate email case-insensitively', async () => {
    await register('dave@example.com');
    await expect(register('Dave@Example.com')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
