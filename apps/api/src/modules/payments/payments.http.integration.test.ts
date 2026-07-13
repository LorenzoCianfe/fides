import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { buildTransferScaAction, type ScaActionDto } from '@fides/contracts';
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
import { LedgerStore } from '../ledger/infra/ledger.repository';

const ORIGIN = 'http://localhost:3001';
const RP_ID = 'localhost';
const DEVICE = { name: 'Chrome on Windows', platform: 'web' } as const;
const EUR = 'EUR' as const;

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
  process.env.DEV_FUNDING_ENABLED = 'true';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(NOTIFICATIONS)
    .useValue(notifications)
    .compile();

  app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
  server = app.getHttpServer();
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
  /** The same authenticator must sign later step-up ceremonies. */
  readonly authenticator: SoftwareAuthenticator;
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

  return { userId, email, accessToken: finished.body.session.accessToken as string, authenticator };
}

/** Run the SCA step-up ceremony for `action` and return the single-use grant. */
async function stepUpGrant(user: EnrolledUser, action: ScaActionDto): Promise<string> {
  const options = await request(server)
    .post('/v1/auth/sca/options')
    .set('Authorization', `Bearer ${user.accessToken}`)
    .send({ action })
    .expect(200);
  const response = user.authenticator.createAuthenticationResponse({
    challenge: options.body.challenge as string,
    rpId: RP_ID,
    origin: ORIGIN,
  });
  const verified = await request(server)
    .post('/v1/auth/sca/verify')
    .set('Authorization', `Bearer ${user.accessToken}`)
    .send({ action, response })
    .expect(201);
  return verified.body.grant as string;
}

function transferAction(recipient: string, minor: string): ScaActionDto {
  return buildTransferScaAction({ recipient, amount: minor, currency: EUR });
}

function fund(user: EnrolledUser, minor: string, key = 'seed-funding') {
  return request(server)
    .post('/v1/dev/funding')
    .set('Authorization', `Bearer ${user.accessToken}`)
    .set('Idempotency-Key', key)
    .send({ amount: { amount: minor, currency: EUR } });
}

function postTransfer(
  from: EnrolledUser,
  recipient: string,
  minor: string,
  opts: { key: string; grant: string },
) {
  return request(server)
    .post('/v1/transfers')
    .set('Authorization', `Bearer ${from.accessToken}`)
    .set('Idempotency-Key', opts.key)
    .send({ recipient, amount: { amount: minor, currency: EUR }, grant: opts.grant });
}

interface WalletView {
  readonly accountId: string;
  readonly walletId: string;
  readonly balance: { amount: string; currency: string };
}

async function walletOf(user: EnrolledUser): Promise<WalletView> {
  const listed = await request(server)
    .get('/v1/accounts')
    .set('Authorization', `Bearer ${user.accessToken}`)
    .expect(200);
  const account = listed.body.accounts[0];
  return {
    accountId: account.id,
    walletId: account.wallets[0].id,
    balance: account.wallets[0].balance,
  };
}

/** Enrol two users, provision their accounts via the outbox, and fund the sender. */
async function setupFundedPair(
  fundMinor = '10000',
): Promise<{ alice: EnrolledUser; bob: EnrolledUser }> {
  const alice = await enrol('alice@example.com');
  const bob = await enrol('bob@example.com');
  await dispatcher.dispatchPending();
  await fund(alice, fundMinor).expect(201);
  return { alice, bob };
}

describe('payments HTTP surface (integration)', () => {
  it('moves value between two users with a balanced entry, and replays idempotently', async () => {
    const { alice, bob } = await setupFundedPair('10000');

    const grant = await stepUpGrant(alice, transferAction(bob.email, '2500'));
    const posted = await postTransfer(alice, bob.email, '2500', { key: 'tx-1', grant }).expect(201);
    expect(posted.body).toMatchObject({
      amount: { amount: '2500', currency: 'EUR' },
      senderBalance: { amount: '7500', currency: 'EUR' },
    });
    expect(posted.body.transferId).toBeTruthy();

    // Value actually moved on both sides.
    expect((await walletOf(alice)).balance).toEqual({ amount: '7500', currency: 'EUR' });
    expect((await walletOf(bob)).balance).toEqual({ amount: '2500', currency: 'EUR' });

    // A retry with the same key replays the original result without double-posting.
    const replay = await postTransfer(alice, bob.email, '2500', { key: 'tx-1', grant }).expect(201);
    expect(replay.body.transferId).toBe(posted.body.transferId);
    expect((await walletOf(alice)).balance).toEqual({ amount: '7500', currency: 'EUR' });

    // The whole ledger still nets to zero for EUR (double-entry invariant).
    const ledger = app.get(LedgerStore);
    expect((await ledger.sumSignedByCurrency()).get('EUR')).toBe(0n);
  });

  it('rejects a transfer whose amount differs from the signed action (dynamic linking)', async () => {
    const { alice, bob } = await setupFundedPair('10000');

    // Grant is bound to 1000; execute 9999 with it.
    const grant = await stepUpGrant(alice, transferAction(bob.email, '1000'));
    const tampered = await postTransfer(alice, bob.email, '9999', {
      key: 'tamper-1',
      grant,
    }).expect(401);
    expect(tampered.body).toMatchObject({ code: 'UNAUTHENTICATED', category: 'authentication' });

    // Nothing moved.
    expect((await walletOf(alice)).balance).toEqual({ amount: '10000', currency: 'EUR' });
    expect((await walletOf(bob)).balance).toEqual({ amount: '0', currency: 'EUR' });
  });

  it('consumes the step-up grant exactly once', async () => {
    const { alice, bob } = await setupFundedPair('10000');

    const grant = await stepUpGrant(alice, transferAction(bob.email, '2500'));
    await postTransfer(alice, bob.email, '2500', { key: 'first', grant }).expect(201);

    // The same grant with a fresh idempotency key cannot pay a second time.
    const reuse = await postTransfer(alice, bob.email, '2500', { key: 'second', grant }).expect(
      401,
    );
    expect(reuse.body.code).toBe('UNAUTHENTICATED');
    expect((await walletOf(alice)).balance).toEqual({ amount: '7500', currency: 'EUR' });
  });

  it('rejects a transfer that would overdraw the sender', async () => {
    const { alice, bob } = await setupFundedPair('1000');

    const grant = await stepUpGrant(alice, transferAction(bob.email, '5000'));
    const overdraw = await postTransfer(alice, bob.email, '5000', { key: 'od-1', grant }).expect(
      422,
    );
    expect(overdraw.body.code).toBe('INSUFFICIENT_FUNDS');
    expect((await walletOf(alice)).balance).toEqual({ amount: '1000', currency: 'EUR' });
  });

  it('rejects a self-transfer', async () => {
    const { alice } = await setupFundedPair('10000');

    const grant = await stepUpGrant(alice, transferAction(alice.email, '100'));
    const selfTransfer = await postTransfer(alice, alice.email, '100', {
      key: 'self-1',
      grant,
    }).expect(400);
    expect(selfTransfer.body.code).toBe('VALIDATION_FAILED');
  });

  it('requires an Idempotency-Key header', async () => {
    const { alice, bob } = await setupFundedPair('10000');

    const grant = await stepUpGrant(alice, transferAction(bob.email, '2500'));
    const missing = await request(server)
      .post('/v1/transfers')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ recipient: bob.email, amount: { amount: '2500', currency: EUR }, grant })
      .expect(400);
    expect(missing.body.code).toBe('VALIDATION_FAILED');
  });

  it('caps dev funding and requires authentication', async () => {
    const { alice } = await setupFundedPair('10000');

    const overCap = await fund(alice, '2000000', 'over-cap').expect(400);
    expect(overCap.body.code).toBe('VALIDATION_FAILED');

    await request(server)
      .post('/v1/dev/funding')
      .set('Idempotency-Key', 'x')
      .send({ amount: { amount: '1000', currency: EUR } })
      .expect(401);
  });

  it('serves wallet transaction history, paginated and ownership-scoped', async () => {
    const { alice, bob } = await setupFundedPair('10000');

    const grant = await stepUpGrant(alice, transferAction(bob.email, '2500'));
    await postTransfer(alice, bob.email, '2500', { key: 'hist-1', grant }).expect(201);
    // History is projected asynchronously off the outbox.
    await dispatcher.dispatchPending();

    const aliceWallet = await walletOf(alice);
    const history = await request(server)
      .get(`/v1/wallets/${aliceWallet.walletId}/transactions`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(history.body.items).toHaveLength(2);
    expect(history.body.items[0]).toMatchObject({
      type: 'transfer',
      amount: { amount: '-2500', currency: 'EUR' },
      balanceAfter: { amount: '7500', currency: 'EUR' },
    });
    expect(history.body.items[1]).toMatchObject({
      type: 'funding',
      amount: { amount: '10000', currency: 'EUR' },
      balanceAfter: { amount: '10000', currency: 'EUR' },
    });
    expect(history.body.nextCursor).toBeNull();

    // Keyset pagination: newest first, then the older page via the cursor.
    const page1 = await request(server)
      .get(`/v1/wallets/${aliceWallet.walletId}/transactions?limit=1`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.items[0].type).toBe('transfer');
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(server)
      .get(`/v1/wallets/${aliceWallet.walletId}/transactions`)
      .query({ limit: 1, cursor: page1.body.nextCursor })
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].type).toBe('funding');

    // Ownership: Bob cannot read Alice's wallet; unknown id is 404, malformed is 400.
    await request(server)
      .get(`/v1/wallets/${aliceWallet.walletId}/transactions`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .expect(403);
    await request(server)
      .get('/v1/wallets/00000000-0000-7000-8000-0000000000ff/transactions')
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .expect(404);
    await request(server)
      .get('/v1/wallets/not-a-uuid/transactions')
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .expect(400);
  });

  it('publishes the payments surface in the OpenAPI document', async () => {
    const docs = await request(server).get('/docs-json').expect(200);
    const paths = Object.keys(docs.body.paths as Record<string, unknown>);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/v1/transfers',
        '/v1/dev/funding',
        '/v1/wallets/{walletId}/transactions',
      ]),
    );
  });
});
