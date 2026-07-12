import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createTestDb, resetDb, type TestDatabase } from '../../../test/db';
import { CapturingNotifications } from '../../../test/notifications';
import { SoftwareAuthenticator } from '../../../test/webauthn';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { loadEnv } from '../../config/env';
import { OutboxDispatcher } from '../../shared/outbox/outbox.dispatcher';
import { NOTIFICATIONS } from '../../shared/tokens';

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
let dispatcher: OutboxDispatcher;

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
  // Provisioning runs off the outbox; with schedulers disabled the suite drains
  // it explicitly, exactly as the armed interval would in production.
  dispatcher = app.get(OutboxDispatcher);
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDb(db as TestDatabase);
  notifications.sent.length = 0;
});

interface EnrolledUser {
  readonly userId: string;
  readonly email: string;
  readonly accessToken: string;
}

/** Register, verify email, and enrol a first passkey — returns the auto-issued session. */
async function enrol(email: string): Promise<EnrolledUser> {
  const registered = await request(server)
    .post('/v1/auth/register')
    .send({ ...baseInput, email })
    .expect(201);
  const userId = registered.body.userId as string;

  const code = notifications.sent.at(-1)!.code;
  const verified = await request(server)
    .post('/v1/auth/verify-email')
    .send({ email, code })
    .expect(200);
  const enrolmentToken = verified.body.enrolmentToken as string;

  const authenticator = new SoftwareAuthenticator();
  const options = await request(server)
    .post('/v1/auth/webauthn/registration/options')
    .send({ userId, enrolmentToken })
    .expect(200);
  const response = authenticator.createRegistrationResponse({
    challenge: options.body.challenge as string,
    rpId: RP_ID,
    origin: ORIGIN,
  });
  const finished = await request(server)
    .post('/v1/auth/webauthn/registration/verify')
    .send({ userId, enrolmentToken, response, device: DEVICE })
    .expect(201);

  return { userId, email, accessToken: finished.body.session.accessToken as string };
}

describe('accounts HTTP surface (integration)', () => {
  it('provisions on kyc.approved and serves the account with a zero EUR wallet', async () => {
    const alice = await enrol('alice@example.com');

    // Before the outbox drains, the account does not exist yet (event-driven).
    const beforeProvision = await request(server)
      .get('/v1/accounts')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(beforeProvision.body.accounts).toEqual([]);

    await dispatcher.dispatchPending();

    const listed = await request(server)
      .get('/v1/accounts')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(listed.body.accounts).toHaveLength(1);
    const account = listed.body.accounts[0];
    expect(account.status).toBe('active');
    expect(account.createdAt).toBeTruthy();
    expect(account.wallets).toHaveLength(1);
    expect(account.wallets[0]).toMatchObject({
      currency: 'EUR',
      balance: { amount: '0', currency: 'EUR' },
    });

    // The single-account read returns the same resource.
    const fetched = await request(server)
      .get(`/v1/accounts/${account.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(fetched.body.id).toBe(account.id);
    expect(fetched.body.wallets[0].id).toBe(account.wallets[0].id);
  });

  it('scopes reads to the owner', async () => {
    const alice = await enrol('alice@example.com');
    const bob = await enrol('bob@example.com');
    await dispatcher.dispatchPending();

    const aliceList = await request(server)
      .get('/v1/accounts')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    const aliceAccountId = aliceList.body.accounts[0].id as string;

    // Bob sees only his own account, never Alice's.
    const bobList = await request(server)
      .get('/v1/accounts')
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .expect(200);
    expect(bobList.body.accounts).toHaveLength(1);
    expect(bobList.body.accounts[0].id).not.toBe(aliceAccountId);

    // Fetching Alice's account by id is forbidden (object-level authorization).
    const forbidden = await request(server)
      .get(`/v1/accounts/${aliceAccountId}`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .expect(403);
    expect(forbidden.body).toMatchObject({ code: 'FORBIDDEN', category: 'authorization' });

    // A well-formed but unknown id is a 404; a malformed one is a 400.
    await request(server)
      .get('/v1/accounts/00000000-0000-7000-8000-000000000000')
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .expect(404);
    const badParam = await request(server)
      .get('/v1/accounts/not-a-uuid')
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .expect(400);
    expect(badParam.body.code).toBe('VALIDATION_FAILED');
  });

  it('requires authentication', async () => {
    const unauthenticated = await request(server).get('/v1/accounts').expect(401);
    expect(unauthenticated.body).toMatchObject({
      code: 'UNAUTHENTICATED',
      category: 'authentication',
    });
  });

  it('publishes the account surface in the OpenAPI document', async () => {
    const docs = await request(server).get('/docs-json').expect(200);
    const paths = Object.keys(docs.body.paths as Record<string, unknown>);
    expect(paths).toEqual(expect.arrayContaining(['/v1/accounts', '/v1/accounts/{accountId}']));
  });
});
