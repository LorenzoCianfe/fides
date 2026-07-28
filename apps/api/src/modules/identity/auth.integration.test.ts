import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TestClock } from '../../../test/clock';
import { createTestDb, resetDb, type TestDatabase } from '../../../test/db';
import { CapturingNotifications } from '../../../test/notifications';
import { SoftwareAuthenticator, type AuthenticationCeremonyInput } from '../../../test/webauthn';
import { UuidV7Generator } from '../../shared/ids/uuid-v7';
import { AuditService } from '../audit/application/audit.service';
import { MockKycAdapter } from '../kyc/infra/mock-kyc.adapter';
import { EmailVerificationService } from './application/email-verification.service';
import { RegistrationService, type RegisterInput } from './application/registration.service';
import {
  SessionService,
  type DeviceDescriptor,
  type IssuedSession,
} from './application/session.service';
import { WebAuthnService, type WebAuthnConfig } from './application/webauthn.service';
import { credentials, devices, sessions as sessionRows } from './infra/auth.schema';
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
const audit = new AuditService(db as TestDatabase, ids, clock);
const sessions = new SessionService(db as TestDatabase, ids, clock, audit);
const webauthn = new WebAuthnService(db as TestDatabase, ids, clock, sessions, RP, audit);

const baseInput: Omit<RegisterInput, 'email'> = {
  givenName: 'Alice',
  familyName: 'Ada',
  dateOfBirth: '1990-05-01',
  addressLine1: '1 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'FR',
};

async function onboard(email: string): Promise<{ userId: string; enrolmentToken: string }> {
  const { userId } = await registration.register({ ...baseInput, email });
  const code = notifications.sent.at(-1)!.code;
  const { enrolmentToken } = await emailVerification.verifyEmail(email, code);
  return { userId, enrolmentToken };
}

async function enrolPasskey(
  userId: string,
  enrolmentToken: string,
): Promise<{ authenticator: SoftwareAuthenticator; session: IssuedSession; credentialId: string }> {
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
  return { authenticator, session: result.session!, credentialId: result.credentialId };
}

async function login(
  email: string,
  authenticator: SoftwareAuthenticator,
  overrides: Partial<AuthenticationCeremonyInput> = {},
): Promise<IssuedSession> {
  const options = await webauthn.startAuthentication(email);
  const response = authenticator.createAuthenticationResponse({
    challenge: options.challenge,
    rpId: RP.rpId,
    origin: ORIGIN,
    ...overrides,
  });
  return webauthn.finishAuthentication({ response, device: DEVICE });
}

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetDb(db as TestDatabase);
  notifications.sent.length = 0;
  clock.reset();
});

describe('passkey enrolment (integration)', () => {
  it('gates the first passkey behind the enrolment token from email verification', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    expect(enrolmentToken).toMatch(/^fet_/);

    await expect(webauthn.startRegistration({ userId })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(
      webauthn.startRegistration({ userId, enrolmentToken: 'fet_forged' }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const options = await webauthn.startRegistration({ userId, enrolmentToken });
    expect(options.rp.id).toBe(RP.rpId);
    expect(options.user.name).toBe('alice@example.com');
    expect(options.authenticatorSelection?.userVerification).toBe('required');
    expect(options.excludeCredentials ?? []).toHaveLength(0);
  });

  it('registers the first passkey, stores the credential, and auto-issues a session', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const { authenticator, session } = await enrolPasskey(userId, enrolmentToken);

    const [credential] = await db.select().from(credentials).where(eq(credentials.userId, userId));
    expect(credential?.credentialId).toBe(authenticator.credentialIdB64);
    expect(credential?.deviceType).toBe('singleDevice');
    expect(credential?.backedUp).toBe(false);

    expect(session.accessToken).toMatch(/^fat_/);
    expect(session.refreshToken).toMatch(/^frt_/);
    const principal = await sessions.validateAccessToken(session.accessToken);
    expect(principal.userId).toBe(userId);
    expect(principal.userStatus).toBe('onboarding');

    const [device] = await db.select().from(devices).where(eq(devices.userId, userId));
    expect(device?.name).toBe(DEVICE.name);
    expect(device?.id).toBe(session.deviceId);
  });

  it('consumes the enrolment token: a second first-passkey ceremony cannot reuse it', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const { session } = await enrolPasskey(userId, enrolmentToken);
    expect(session).toBeTruthy();

    await expect(webauthn.startRegistration({ userId, enrolmentToken })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a replayed registration response (challenge is single-use)', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const authenticator = new SoftwareAuthenticator();
    const options = await webauthn.startRegistration({ userId, enrolmentToken });
    const response = authenticator.createRegistrationResponse({
      challenge: options.challenge,
      rpId: RP.rpId,
      origin: ORIGIN,
    });

    await webauthn.finishRegistration({ userId, enrolmentToken, response, device: DEVICE });
    await expect(
      webauthn.finishRegistration({ userId, enrolmentToken, response, device: DEVICE }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects an expired registration challenge', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const authenticator = new SoftwareAuthenticator();
    const options = await webauthn.startRegistration({ userId, enrolmentToken });
    const response = authenticator.createRegistrationResponse({
      challenge: options.challenge,
      rpId: RP.rpId,
      origin: ORIGIN,
    });

    clock.advance(6 * 60 * 1000);
    await expect(
      webauthn.finishRegistration({ userId, enrolmentToken, response, device: DEVICE }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects attestations from a wrong origin or wrong RP ID', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const authenticator = new SoftwareAuthenticator();

    const optionsA = await webauthn.startRegistration({ userId, enrolmentToken });
    const wrongOrigin = authenticator.createRegistrationResponse({
      challenge: optionsA.challenge,
      rpId: RP.rpId,
      origin: 'https://evil.example',
    });
    await expect(
      webauthn.finishRegistration({
        userId,
        enrolmentToken,
        response: wrongOrigin,
        device: DEVICE,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const optionsB = await webauthn.startRegistration({ userId, enrolmentToken });
    const wrongRpId = authenticator.createRegistrationResponse({
      challenge: optionsB.challenge,
      rpId: 'evil.example',
      origin: ORIGIN,
    });
    await expect(
      webauthn.finishRegistration({ userId, enrolmentToken, response: wrongRpId, device: DEVICE }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects an attestation without user verification', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const authenticator = new SoftwareAuthenticator();
    const options = await webauthn.startRegistration({ userId, enrolmentToken });
    const response = authenticator.createRegistrationResponse({
      challenge: options.challenge,
      rpId: RP.rpId,
      origin: ORIGIN,
      userVerified: false,
    });
    await expect(
      webauthn.finishRegistration({ userId, enrolmentToken, response, device: DEVICE }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('requires an authenticated session to add an additional passkey', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const first = await enrolPasskey(userId, enrolmentToken);

    await expect(webauthn.startRegistration({ userId })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    const options = await webauthn.startRegistration({ userId, authenticatedUserId: userId });
    expect(options.excludeCredentials?.map((c) => c.id)).toContain(first.credentialId);

    const second = new SoftwareAuthenticator();
    const response = second.createRegistrationResponse({
      challenge: options.challenge,
      rpId: RP.rpId,
      origin: ORIGIN,
    });
    const result = await webauthn.finishRegistration({
      userId,
      authenticatedUserId: userId,
      response,
      device: DEVICE,
    });
    expect(result.session).toBeNull();

    const stored = await db.select().from(credentials).where(eq(credentials.userId, userId));
    expect(stored).toHaveLength(2);
  });
});

describe('passkey login (integration)', () => {
  it('authenticates with a registered passkey and bumps the signature counter', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const { authenticator } = await enrolPasskey(userId, enrolmentToken);

    const session = await login('alice@example.com', authenticator);
    const principal = await sessions.validateAccessToken(session.accessToken);
    expect(principal.userId).toBe(userId);

    const [credential] = await db.select().from(credentials).where(eq(credentials.userId, userId));
    expect(credential?.counter).toBe(1);
    expect(credential?.lastUsedAt).not.toBeNull();
  });

  it('returns decoy options for an unknown email and fails verification generically', async () => {
    const options = await webauthn.startAuthentication('ghost@example.com');
    expect(options.challenge).toBeTruthy();
    expect(options.allowCredentials?.length).toBeGreaterThan(0);

    const stranger = new SoftwareAuthenticator();
    const response = stranger.createAuthenticationResponse({
      challenge: options.challenge,
      rpId: RP.rpId,
      origin: ORIGIN,
    });
    await expect(webauthn.finishAuthentication({ response, device: DEVICE })).rejects.toMatchObject(
      { code: 'UNAUTHENTICATED', message: 'Authentication failed' },
    );
  });

  it('rejects an assertion without user verification', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const { authenticator } = await enrolPasskey(userId, enrolmentToken);
    await expect(
      login('alice@example.com', authenticator, { userVerified: false }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a signature-counter regression (cloned authenticator signal)', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const { authenticator } = await enrolPasskey(userId, enrolmentToken);

    await login('alice@example.com', authenticator);
    await expect(login('alice@example.com', authenticator, { counter: 1 })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects login and existing sessions for a suspended user', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const { authenticator, session } = await enrolPasskey(userId, enrolmentToken);

    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, userId));

    await expect(login('alice@example.com', authenticator)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(sessions.validateAccessToken(session.accessToken)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('sessions (integration)', () => {
  it('rotates both tokens on refresh and invalidates the previous access token', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const { session } = await enrolPasskey(userId, enrolmentToken);

    const rotated = await sessions.refresh(session.refreshToken);
    expect(rotated.sessionId).toBe(session.sessionId);
    expect(rotated.accessToken).not.toBe(session.accessToken);
    expect(rotated.refreshToken).not.toBe(session.refreshToken);

    await expect(sessions.validateAccessToken(session.accessToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    const principal = await sessions.validateAccessToken(rotated.accessToken);
    expect(principal.sessionId).toBe(session.sessionId);
  });

  it('revokes the whole session when a superseded refresh token is reused', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const { session } = await enrolPasskey(userId, enrolmentToken);

    const rotated = await sessions.refresh(session.refreshToken);
    await expect(sessions.refresh(session.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    const [row] = await db.select().from(sessionRows).where(eq(sessionRows.id, session.sessionId));
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.revokedReason).toBe('refresh_token_reuse');

    await expect(sessions.validateAccessToken(rotated.accessToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(sessions.refresh(rotated.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('expires the access token while the refresh path stays alive within the idle window', async () => {
    const shortSessions = new SessionService(db as TestDatabase, ids, clock, audit, {
      accessTtlMs: 1_000,
      refreshIdleTtlMs: 5_000,
      absoluteTtlMs: 8_000,
    });
    const { userId } = await onboard('alice@example.com');
    const issued = await shortSessions.issueSession(db as TestDatabase, userId, DEVICE);

    await expect(shortSessions.validateAccessToken(issued.accessToken)).resolves.toBeTruthy();
    clock.advance(1_500);
    await expect(shortSessions.validateAccessToken(issued.accessToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(shortSessions.refresh(issued.refreshToken)).resolves.toBeTruthy();
  });

  it('kills the session when the idle window elapses without a refresh', async () => {
    const shortSessions = new SessionService(db as TestDatabase, ids, clock, audit, {
      accessTtlMs: 1_000,
      refreshIdleTtlMs: 5_000,
      absoluteTtlMs: 8_000,
    });
    const { userId } = await onboard('alice@example.com');
    const issued = await shortSessions.issueSession(db as TestDatabase, userId, DEVICE);

    clock.advance(5_500);
    await expect(shortSessions.refresh(issued.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('caps every extension at the absolute deadline', async () => {
    const shortSessions = new SessionService(db as TestDatabase, ids, clock, audit, {
      accessTtlMs: 1_000,
      refreshIdleTtlMs: 5_000,
      absoluteTtlMs: 8_000,
    });
    const { userId } = await onboard('alice@example.com');
    const issued = await shortSessions.issueSession(db as TestDatabase, userId, DEVICE);

    clock.advance(4_000);
    const rotated = await shortSessions.refresh(issued.refreshToken);
    expect(rotated.refreshExpiresAt.getTime()).toBe(issued.absoluteExpiresAt.getTime());

    clock.advance(4_500);
    await expect(shortSessions.refresh(rotated.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('revocation is immediate and ownership-scoped', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const { session } = await enrolPasskey(userId, enrolmentToken);
    const other = await onboard('mallory@example.com');

    await sessions.revokeSession(session.sessionId, { userId: other.userId });
    await expect(sessions.validateAccessToken(session.accessToken)).resolves.toBeTruthy();

    await sessions.revokeSession(session.sessionId, { userId });
    await expect(sessions.validateAccessToken(session.accessToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(sessions.refresh(session.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    const [row] = await db
      .select()
      .from(sessionRows)
      .where(and(eq(sessionRows.id, session.sessionId), eq(sessionRows.userId, userId)));
    expect(row?.revokedReason).toBe('logout');
  });

  it('lists active sessions per device, newest first, hiding revoked ones', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    const { authenticator, session: first } = await enrolPasskey(userId, enrolmentToken);

    clock.advance(60_000);
    const options = await webauthn.startAuthentication('alice@example.com');
    const response = authenticator.createAuthenticationResponse({
      challenge: options.challenge,
      rpId: RP.rpId,
      origin: ORIGIN,
    });
    const second = await webauthn.finishAuthentication({
      response,
      device: { name: 'Fides for iOS', platform: 'ios' },
    });

    const listed = await sessions.listSessions(userId);
    expect(listed.map((entry) => entry.sessionId)).toEqual([second.sessionId, first.sessionId]);
    expect(listed[0]?.devicePlatform).toBe('ios');
    expect(listed[1]?.deviceName).toBe(DEVICE.name);
    for (const entry of listed) {
      expect(Object.keys(entry)).not.toContain('accessTokenHash');
    }

    await sessions.revokeSession(first.sessionId, { userId });
    const afterRevoke = await sessions.listSessions(userId);
    expect(afterRevoke.map((entry) => entry.sessionId)).toEqual([second.sessionId]);
  });
});

describe('enrolment token re-issue (integration)', () => {
  it('recovers an expired enrolment token through resend + verify on any device', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');

    clock.advance(16 * 60 * 1000);
    await expect(webauthn.startRegistration({ userId, enrolmentToken })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    await emailVerification.resendVerification('alice@example.com');
    const code = notifications.sent.at(-1)!.code;
    const fresh = await emailVerification.verifyEmail('alice@example.com', code);
    expect(fresh.userId).toBe(userId);
    expect(fresh.enrolmentToken).not.toBe(enrolmentToken);

    const { session } = await enrolPasskey(userId, fresh.enrolmentToken);
    expect(session.accessToken).toMatch(/^fat_/);
  });

  it('resend no-ops once a passkey exists', async () => {
    const { userId, enrolmentToken } = await onboard('alice@example.com');
    await enrolPasskey(userId, enrolmentToken);

    const sentBefore = notifications.sent.length;
    await emailVerification.resendVerification('alice@example.com');
    expect(notifications.sent).toHaveLength(sentBefore);
  });
});
