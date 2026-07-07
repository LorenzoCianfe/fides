import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TestClock } from '../../../test/clock';
import { createTestDb, resetDb, type TestDatabase } from '../../../test/db';
import { CapturingNotifications } from '../../../test/notifications';
import { SoftwareAuthenticator } from '../../../test/webauthn';
import { UuidV7Generator } from '../../shared/ids/uuid-v7';
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
const sessions = new SessionService(db as TestDatabase, ids, clock);
const webauthn = new WebAuthnService(db as TestDatabase, ids, clock, sessions, RP);
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

  it('retains dead sessions for the 90-day forensic grace, then purges them', async () => {
    const alice = await onboardWithPasskey('alice@example.com');
    await issueScaGrant(db as TestDatabase, ids, clock, {
      userId: alice.userId,
      sessionId: alice.session.sessionId,
      actionHash: computeActionHash({ type: 'p2p_transfer', payload: { amountMinor: '1' } }),
    });
    await sessions.revokeSession(alice.session.sessionId, { userId: alice.userId });

    // Freshly revoked: inside the grace window, the session (and its still
    // unexpired grant) survive the sweep.
    const immediate = await sweeper.sweep();
    expect(immediate.sessions).toBe(0);
    expect(immediate.scaGrants).toBe(0);
    expect(await db.select().from(sessionRows)).toHaveLength(1);

    // 91 days on: the expired grant goes first (it references the session),
    // then the session itself. A never-refreshed second session would already
    // be idle-dead at day 30, so it is created now to prove retention counts
    // from death, not creation.
    clock.advance(91 * DAY_MS);
    const survivor = await sessions.issueSession(db as TestDatabase, alice.userId, {
      name: 'Fides for iOS',
      platform: 'ios',
    });
    const late = await sweeper.sweep();
    expect(late.scaGrants).toBe(1);
    expect(late.sessions).toBe(1);

    const remaining = await db.select().from(sessionRows);
    expect(remaining.map((row) => row.id)).toEqual([survivor.sessionId]);
    expect(await db.select().from(scaGrants)).toHaveLength(0);

    // The survivor dies idle at +30 d and is purged 90 days after that.
    clock.advance(121 * DAY_MS);
    const final = await sweeper.sweep();
    expect(final.sessions).toBe(1);
    expect(await db.select().from(sessionRows)).toHaveLength(0);
  });
});
