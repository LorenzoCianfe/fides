import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createTestDb, resetDb, type TestDatabase } from '../test/db';
import { CapturingNotifications } from '../test/notifications';
import { SoftwareAuthenticator } from '../test/webauthn';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadEnv } from './config/env';
import { NOTIFICATIONS } from './shared/tokens';

const ORIGIN = 'http://localhost:3001';
const RP_ID = 'localhost';
const DEVICE = { name: 'Chrome on Windows', platform: 'web' } as const;

const baseInput = {
  givenName: 'Alice',
  familyName: 'Ada',
  dateOfBirth: '1990-05-01',
  addressLine1: '1 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'FR',
};

const notifications = new CapturingNotifications();
const { db, close: closeDb } = createTestDb();

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;

beforeAll(async () => {
  process.env.DATABASE_URL = inject('databaseUrl');
  process.env.SCHEDULERS_ENABLED = 'false';
  process.env.THROTTLE_ENABLED = 'false';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(NOTIFICATIONS)
    .useValue(notifications)
    .compile();

  app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
  server = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDb(db as TestDatabase);
  notifications.sent.length = 0;
});

interface OnboardedUser {
  readonly userId: string;
  readonly email: string;
  readonly enrolmentToken: string;
}

async function onboard(email: string): Promise<OnboardedUser> {
  const registered = await request(server)
    .post('/v1/auth/register')
    .send({ ...baseInput, email })
    .expect(201);
  expect(registered.body.kycStatus).toBe('approved');

  const code = notifications.sent.at(-1)!.code;
  const verified = await request(server)
    .post('/v1/auth/verify-email')
    .send({ email, code })
    .expect(200);
  expect(verified.body.userId).toBe(registered.body.userId);

  return {
    userId: registered.body.userId as string,
    email,
    enrolmentToken: verified.body.enrolmentToken as string,
  };
}

interface EnrolledUser extends OnboardedUser {
  readonly authenticator: SoftwareAuthenticator;
  readonly session: Record<string, string>;
}

async function enrolPasskey(user: OnboardedUser): Promise<EnrolledUser> {
  const authenticator = new SoftwareAuthenticator();
  const options = await request(server)
    .post('/v1/auth/webauthn/registration/options')
    .send({ userId: user.userId, enrolmentToken: user.enrolmentToken })
    .expect(200);

  const response = authenticator.createRegistrationResponse({
    challenge: options.body.challenge as string,
    rpId: RP_ID,
    origin: ORIGIN,
  });
  const finished = await request(server)
    .post('/v1/auth/webauthn/registration/verify')
    .send({ userId: user.userId, enrolmentToken: user.enrolmentToken, response, device: DEVICE })
    .expect(201);

  expect(finished.body.session).not.toBeNull();
  return { ...user, authenticator, session: finished.body.session as Record<string, string> };
}

async function login(
  email: string,
  authenticator: SoftwareAuthenticator,
): Promise<Record<string, string>> {
  const options = await request(server)
    .post('/v1/auth/webauthn/authentication/options')
    .send({ email })
    .expect(200);
  const response = authenticator.createAuthenticationResponse({
    challenge: options.body.challenge as string,
    rpId: RP_ID,
    origin: ORIGIN,
  });
  const session = await request(server)
    .post('/v1/auth/webauthn/authentication/verify')
    .send({ response, device: { name: 'Fides for iOS', platform: 'ios' } })
    .expect(200);
  return session.body as Record<string, string>;
}

describe('auth HTTP surface (integration)', () => {
  it('carries a user end to end: register, verify, enrol, login, step up, refresh, logout', async () => {
    const user = await enrolPasskey(await onboard('alice@example.com'));
    expect(user.session.accessToken).toMatch(/^fat_/);

    // The first session is visible and marked current.
    const initialList = await request(server)
      .get('/v1/auth/sessions')
      .set('Authorization', `Bearer ${user.session.accessToken}`)
      .expect(200);
    expect(initialList.body.sessions).toHaveLength(1);
    expect(initialList.body.sessions[0].current).toBe(true);

    // Login from a second device.
    const second = await login(user.email, user.authenticator);
    const listAfterLogin = await request(server)
      .get('/v1/auth/sessions')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .expect(200);
    expect(listAfterLogin.body.sessions).toHaveLength(2);

    // Step-up SCA with dynamic linking on the second session.
    const action = {
      type: 'p2p_transfer',
      payload: { amountMinor: '2500', currency: 'EUR', recipientUserId: user.userId },
    };
    const scaOptions = await request(server)
      .post('/v1/auth/sca/options')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .send({ action })
      .expect(200);
    const assertion = user.authenticator.createAuthenticationResponse({
      challenge: scaOptions.body.challenge as string,
      rpId: RP_ID,
      origin: ORIGIN,
    });
    const grant = await request(server)
      .post('/v1/auth/sca/verify')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .send({ action, response: assertion })
      .expect(201);
    expect(grant.body.grant).toMatch(/^fsg_/);
    expect(grant.body.actionHash).toMatch(/^[0-9a-f]{64}$/);

    // Refresh rotates the pair and invalidates the old access token.
    const rotated = await request(server)
      .post('/v1/auth/refresh')
      .send({ refreshToken: second.refreshToken })
      .expect(200);
    await request(server)
      .get('/v1/auth/sessions')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .expect(401);

    // Revoke the first device's session, then log out of the second.
    await request(server)
      .delete(`/v1/auth/sessions/${user.session.sessionId}`)
      .set('Authorization', `Bearer ${rotated.body.accessToken}`)
      .expect(204);
    const afterRevoke = await request(server)
      .get('/v1/auth/sessions')
      .set('Authorization', `Bearer ${rotated.body.accessToken}`)
      .expect(200);
    expect(afterRevoke.body.sessions).toHaveLength(1);

    await request(server)
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${rotated.body.accessToken}`)
      .expect(204);
    await request(server)
      .get('/v1/auth/sessions')
      .set('Authorization', `Bearer ${rotated.body.accessToken}`)
      .expect(401);
  });

  it('renders the canonical error envelope across failure modes', async () => {
    // Validation failure carries structured issues.
    const invalid = await request(server)
      .post('/v1/auth/register')
      .send({ email: 'not-an-email' })
      .expect(400);
    expect(invalid.body).toMatchObject({ code: 'VALIDATION_FAILED', category: 'validation' });
    expect(Array.isArray(invalid.body.details?.issues)).toBe(true);
    expect(invalid.body.correlationId).toBeTruthy();

    // Duplicate registration stays an explicit conflict (ADR-0021).
    const alice = await onboard('alice@example.com');
    const duplicate = await request(server)
      .post('/v1/auth/register')
      .send({ ...baseInput, email: 'alice@example.com' })
      .expect(409);
    expect(duplicate.body.code).toBe('CONFLICT');

    // Missing bearer on a protected route.
    const unauthenticated = await request(server).get('/v1/auth/sessions').expect(401);
    expect(unauthenticated.body).toMatchObject({
      code: 'UNAUTHENTICATED',
      category: 'authentication',
    });

    // A presented-but-invalid bearer on an optional-auth route is rejected.
    await request(server)
      .post('/v1/auth/webauthn/registration/options')
      .set('Authorization', 'Bearer fat_forged')
      .send({ userId: alice.userId })
      .expect(401);

    // Malformed route params are validation failures, not 500s.
    const enrolled = await enrolPasskey(alice);
    const badParam = await request(server)
      .delete('/v1/auth/sessions/not-a-uuid')
      .set('Authorization', `Bearer ${enrolled.session.accessToken}`)
      .expect(400);
    expect(badParam.body.code).toBe('VALIDATION_FAILED');
  });

  it('fails verification uniformly and keeps resend silent (anti-enumeration)', async () => {
    await request(server)
      .post('/v1/auth/resend-verification')
      .send({ email: 'ghost@example.com' })
      .expect(202);
    expect(notifications.sent).toHaveLength(0);

    const unknown = await request(server)
      .post('/v1/auth/verify-email')
      .send({ email: 'ghost@example.com', code: '123456' })
      .expect(400);

    await onboard('alice@example.com');
    const sent = notifications.sent.at(-1)!.code;
    const wrong = sent === '000000' ? '000001' : '000000';
    const wrongCode = await request(server)
      .post('/v1/auth/verify-email')
      .send({ email: 'alice@example.com', code: wrong })
      .expect(400);

    expect(unknown.body.message).toBe(wrongCode.body.message);

    // Unknown emails still receive plausible login options (decoys).
    const decoy = await request(server)
      .post('/v1/auth/webauthn/authentication/options')
      .send({ email: 'ghost@example.com' })
      .expect(200);
    expect(decoy.body.challenge).toBeTruthy();
    expect(decoy.body.allowCredentials.length).toBeGreaterThan(0);
  });

  it('honors well-formed correlation ids and replaces malformed ones', async () => {
    const honored = await request(server)
      .get('/health')
      .set('x-correlation-id', 'gateway-issued-42')
      .expect(200);
    expect(honored.headers['x-correlation-id']).toBe('gateway-issued-42');

    const replaced = await request(server)
      .get('/health')
      .set('x-correlation-id', 'bad id')
      .expect(200);
    expect(replaced.headers['x-correlation-id']).toBeTruthy();
    expect(replaced.headers['x-correlation-id']).not.toBe('bad id');
  });

  it('keeps the liveness probe unversioned and everything else under /v1', async () => {
    await request(server).get('/health').expect(200);
    await request(server).get('/v1/health').expect(404);
    await request(server).post('/auth/register').send({}).expect(404);
  });

  it('serves the generated OpenAPI document with the auth surface and bearer scheme', async () => {
    const docs = await request(server).get('/docs-json').expect(200);
    const paths = Object.keys(docs.body.paths as Record<string, unknown>);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/health',
        '/v1/auth/register',
        '/v1/auth/webauthn/registration/verify',
        '/v1/auth/sessions/{sessionId}',
        '/v1/auth/sca/verify',
      ]),
    );
    expect(docs.body.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });
});
