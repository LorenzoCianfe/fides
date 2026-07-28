import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TestClock } from '../../../test/clock';
import { createTestDb, resetDb, type TestDatabase } from '../../../test/db';
import { CapturingNotifications } from '../../../test/notifications';
import { SoftwareAuthenticator } from '../../../test/webauthn';
import { UuidV7Generator } from '../../shared/ids/uuid-v7';
import { AuditService } from '../audit/application/audit.service';
import { MockKycAdapter } from '../kyc/infra/mock-kyc.adapter';
import { EmailVerificationService } from './application/email-verification.service';
import { IdentitySweeper } from './application/identity-sweeper';
import { RegistrationService, type RegisterInput } from './application/registration.service';
import { computeActionHash, issueScaGrant } from './application/sca-grant';
import {
  SessionService,
  type DeviceDescriptor,
  type IssuedSession,
} from './application/session.service';
import { WebAuthnService, type WebAuthnConfig } from './application/webauthn.service';
import { scaGrants, sessions as sessionRows, webauthnChallenges } from './infra/auth.schema';
import { emailVerifications } from './infra/identity.schema';

const RP: WebAuthnConfig = {
  rpId: 'localhost',
  rpName: 'Fides',
  origins: ['http://localhost:3001'],
};
const ORIGIN = 'http://localhost:3001';
const DEVICE: DeviceDescriptor = { name: 'Chrome on Windows', platform: 'web' };
const DAY_MS = 24 * 60 * 60 * 1000;

const ids = new UuidV7Generator();
const clock = new TestClock();
const { db, close } = createTestDb();
const kyc = new MockKycAdapter(ids);
const notifications = new CapturingNotifications();
const registration = new RegistrationService(db as TestDatabase, ids, clock, kyc, notifications);
const emailVerification = new EmailVerificationService(
  db as TestDatabase,
  ids,
  clock,
  notifications,
);
const audit = new AuditService(db as TestDatabase, ids, clock);
const sessions = new SessionService(db as TestDatabase, ids, clock, audit);
const webauthn = new WebAuthnService(db as TestDatabase, ids, clock, sessions, RP, audit);
const sweeper = new IdentitySweeper(db as TestDatabase, clock);

const baseInput: Omit<RegisterInput, 'email'> = {
  givenName: 'Alice',
  familyName: 'Ada',
  dateOfBirth: '1990-05-01',
  addressLine1: '1 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'FR',
};

async function onboardWithPasskey(email: string): Promise<{
  userId: string;
  session: IssuedSession;
  authenticator: SoftwareAuthenticator;
}> {
  const { userId } = await registration.register({ ...baseInput, email });
  const code = notifications.sent.at(-1)!.code;
  const { enrolmentToken } = await emailVerification.verifyEmail(email, code);
  const authenticator = new SoftwareAuthenticator();
  const options = await webauthn.startRegistration({ userId, enrolmentToken });
  const response = authenticator.createRegistrationResponse({
    challenge: options.challenge,
    rpId: RP.rpId,
    origin: ORIGIN,
  });
  const result = await webauthn.finishRegistration({
    userId,
    enrolmentToken,
    response,
    device: DEVICE,
  });
  return { userId, session: result.session!, authenticator };
}

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetDb(db as TestDatabase);
  notifications.sent.length = 0;
  clock.reset();
});

describe('identity sweeper (integration)', () => {
  it('purges consumed and expired secrets promptly while keeping live ones', async () => {
    // Alice completes onboarding: her verification, enrolment token, and
    // registration challenge are all consumed. Bob only registered (live
    // verification); an unknown email holds a live decoy challenge.
    await onboardWithPasskey('alice@example.com');
    await registration.register({ ...baseInput, email: 'bob@example.com' });
    await webauthn.startAuthentication('ghost@example.com');

    const first = await sweeper.sweep();
    expect(first).toEqual({
      scaGrants: 0,
      webauthnChallenges: 1,
      enrolmentTokens: 1,
      emailVerifications: 1,
      sessions: 0,
    });

    const liveVerifications = await db.select().from(emailVerifications);
    expect(liveVerifications).toHaveLength(1);
    const liveChallenges = await db.select().from(webauthnChallenges);
    expect(liveChallenges).toHaveLength(1);

    // Sixteen minutes on, Bob's code (15 m TTL) and the decoy (5 m) are dead.
    clock.advance(16 * 60 * 1000);
    const second = await sweeper.sweep();
    expect(second.emailVerifications).toBe(1);
    expect(second.webauthnChallenges).toBe(1);
    expect(await db.select().from(emailVerifications)).toHaveLength(0);
    expect(await db.select().from(webauthnChallenges)).toHaveLength(0);
  });

  it('purges a revoked session promptly, cascading its SCA grant (ADR-0024)', async () => {
    const alice = await onboardWithPasskey('alice@example.com');
    await issueScaGrant(db as TestDatabase, ids, clock, {
      userId: alice.userId,
      sessionId: alice.session.sessionId,
      actionHash: computeActionHash({ type: 'p2p_transfer', payload: { amountMinor: '1' } }),
    });

    // A live session and its unexpired grant survive the sweep.
    const live = await sweeper.sweep();
    expect(live.sessions).toBe(0);
    expect(await db.select().from(sessionRows)).toHaveLength(1);
    expect(await db.select().from(scaGrants)).toHaveLength(1);

    // Once revoked it is dead and swept promptly — no 90-day grace, because the
    // revocation now lives in the audit trail. The still-unexpired grant is not
    // consumed/expired, so it is not swept explicitly; deleting the session
    // cascades it away (FK ON DELETE CASCADE).
    await sessions.revokeSession(alice.session.sessionId, { userId: alice.userId });
    const swept = await sweeper.sweep();
    expect(swept.sessions).toBe(1);
    expect(await db.select().from(sessionRows)).toHaveLength(0);
    expect(await db.select().from(scaGrants)).toHaveLength(0);
  });

  it('purges an idle-dead session once its refresh deadline passes', async () => {
    await onboardWithPasskey('alice@example.com');

    // Freshly issued: alive, so retained.
    expect((await sweeper.sweep()).sessions).toBe(0);
    expect(await db.select().from(sessionRows)).toHaveLength(1);

    // Past the 30-day idle window with no refresh: idle-dead, swept promptly.
    clock.advance(31 * DAY_MS);
    expect((await sweeper.sweep()).sessions).toBe(1);
    expect(await db.select().from(sessionRows)).toHaveLength(0);
  });
});
