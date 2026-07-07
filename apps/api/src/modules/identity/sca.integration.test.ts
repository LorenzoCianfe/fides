import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TestClock } from '../../../test/clock';
import { createTestDb, resetDb, type TestDatabase } from '../../../test/db';
import { CapturingNotifications } from '../../../test/notifications';
import { SoftwareAuthenticator, type AuthenticationCeremonyInput } from '../../../test/webauthn';
import { UuidV7Generator } from '../../shared/ids/uuid-v7';
import { MockKycAdapter } from '../kyc/infra/mock-kyc.adapter';
import { EmailVerificationService } from './application/email-verification.service';
import { RegistrationService, type RegisterInput } from './application/registration.service';
import {
  computeActionHash,
  consumeScaGrant,
  SCA_GRANT_TTL_MS,
  type IssuedScaGrant,
  type ScaAction,
} from './application/sca-grant';
import {
  SessionService,
  type DeviceDescriptor,
  type IssuedSession,
} from './application/session.service';
import { WebAuthnService, type WebAuthnConfig } from './application/webauthn.service';
import { users } from './infra/identity.schema';

const RP: WebAuthnConfig = {
  rpId: 'localhost',
  rpName: 'Fides',
  origins: ['http://localhost:3001'],
};
const ORIGIN = 'http://localhost:3001';
const DEVICE: DeviceDescriptor = { name: 'Chrome on Windows', platform: 'web' };

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

const baseInput: Omit<RegisterInput, 'email'> = {
  givenName: 'Alice',
  familyName: 'Ada',
  dateOfBirth: '1990-05-01',
  addressLine1: '1 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'FR',
};

const TRANSFER_ACTION: ScaAction = {
  type: 'p2p_transfer',
  payload: { amountMinor: '2500', currency: 'EUR', recipientUserId: 'recipient-1' },
};

async function onboard(email: string): Promise<{ userId: string; enrolmentToken: string }> {
  const { userId } = await registration.register({ ...baseInput, email });
  const code = notifications.sent.at(-1)!.code;
  const { enrolmentToken } = await emailVerification.verifyEmail(email, code);
  return { userId, enrolmentToken };
}

async function onboardWithPasskey(email: string): Promise<{
  userId: string;
  session: IssuedSession;
  authenticator: SoftwareAuthenticator;
}> {
  const { userId, enrolmentToken } = await onboard(email);
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

async function stepUp(
  userId: string,
  sessionId: string,
  authenticator: SoftwareAuthenticator,
  optionsAction: ScaAction,
  finishAction: ScaAction = optionsAction,
  overrides: Partial<AuthenticationCeremonyInput> = {},
): Promise<IssuedScaGrant> {
  const options = await webauthn.startStepUp({ userId, action: optionsAction });
  const response = authenticator.createAuthenticationResponse({
    challenge: options.challenge,
    rpId: RP.rpId,
    origin: ORIGIN,
    ...overrides,
  });
  return webauthn.finishStepUp({ userId, sessionId, action: finishAction, response });
}

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetDb(db as TestDatabase);
  notifications.sent.length = 0;
  clock.reset();
});

describe('SCA step-up with dynamic linking (integration)', () => {
  it('issues an action-bound grant that is consumable exactly once', async () => {
    const { userId, session, authenticator } = await onboardWithPasskey('alice@example.com');

    const grant = await stepUp(userId, session.sessionId, authenticator, TRANSFER_ACTION);
    expect(grant.grant).toMatch(/^fsg_/);
    expect(grant.actionHash).toBe(computeActionHash(TRANSFER_ACTION));
    const remainingMs = grant.expiresAt.getTime() - clock.now().getTime();
    expect(remainingMs).toBeGreaterThan(SCA_GRANT_TTL_MS - 5_000);
    expect(remainingMs).toBeLessThanOrEqual(SCA_GRANT_TTL_MS);

    const consume = () =>
      consumeScaGrant(db as TestDatabase, {
        userId,
        sessionId: session.sessionId,
        grant: grant.grant,
        actionHash: grant.actionHash,
        now: clock.now(),
      });
    await expect(consume()).resolves.toBeUndefined();
    await expect(consume()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a ceremony finished against a tampered action (dynamic linking)', async () => {
    const { userId, session, authenticator } = await onboardWithPasskey('alice@example.com');
    const tampered: ScaAction = {
      type: TRANSFER_ACTION.type,
      payload: { ...TRANSFER_ACTION.payload, amountMinor: '9999999' },
    };

    await expect(
      stepUp(userId, session.sessionId, authenticator, TRANSFER_ACTION, tampered),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('links actions canonically: payload key order is irrelevant', async () => {
    const { userId, session, authenticator } = await onboardWithPasskey('alice@example.com');
    const reordered: ScaAction = {
      type: 'p2p_transfer',
      payload: { recipientUserId: 'recipient-1', currency: 'EUR', amountMinor: '2500' },
    };

    const grant = await stepUp(
      userId,
      session.sessionId,
      authenticator,
      TRANSFER_ACTION,
      reordered,
    );
    expect(grant.actionHash).toBe(computeActionHash(TRANSFER_ACTION));
  });

  it('binds the grant to the issuing user and session', async () => {
    const { userId, session, authenticator } = await onboardWithPasskey('alice@example.com');
    const grant = await stepUp(userId, session.sessionId, authenticator, TRANSFER_ACTION);

    await expect(
      consumeScaGrant(db as TestDatabase, {
        userId,
        sessionId: ids.next(),
        grant: grant.grant,
        actionHash: grant.actionHash,
        now: clock.now(),
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      consumeScaGrant(db as TestDatabase, {
        userId: ids.next(),
        sessionId: session.sessionId,
        grant: grant.grant,
        actionHash: grant.actionHash,
        now: clock.now(),
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('expires unconsumed grants', async () => {
    const { userId, session, authenticator } = await onboardWithPasskey('alice@example.com');
    const grant = await stepUp(userId, session.sessionId, authenticator, TRANSFER_ACTION);

    clock.advance(SCA_GRANT_TTL_MS + 1_000);
    await expect(
      consumeScaGrant(db as TestDatabase, {
        userId,
        sessionId: session.sessionId,
        grant: grant.grant,
        actionHash: grant.actionHash,
        now: clock.now(),
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a replayed step-up assertion (challenge is single-use)', async () => {
    const { userId, session, authenticator } = await onboardWithPasskey('alice@example.com');
    const options = await webauthn.startStepUp({ userId, action: TRANSFER_ACTION });
    const response = authenticator.createAuthenticationResponse({
      challenge: options.challenge,
      rpId: RP.rpId,
      origin: ORIGIN,
    });

    await webauthn.finishStepUp({
      userId,
      sessionId: session.sessionId,
      action: TRANSFER_ACTION,
      response,
    });
    await expect(
      webauthn.finishStepUp({
        userId,
        sessionId: session.sessionId,
        action: TRANSFER_ACTION,
        response,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a step-up assertion without user verification', async () => {
    const { userId, session, authenticator } = await onboardWithPasskey('alice@example.com');
    await expect(
      stepUp(userId, session.sessionId, authenticator, TRANSFER_ACTION, TRANSFER_ACTION, {
        userVerified: false,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('requires an enrolled passkey to start a step-up', async () => {
    const { userId } = await onboard('nopasskey@example.com');
    await expect(webauthn.startStepUp({ userId, action: TRANSFER_ACTION })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('cuts off suspended users', async () => {
    const { userId, authenticator, session } = await onboardWithPasskey('alice@example.com');
    void authenticator;
    void session;
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, userId));

    await expect(webauthn.startStepUp({ userId, action: TRANSFER_ACTION })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
