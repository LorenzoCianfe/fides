import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { seedAdmin, signInAdmin, type AdminSession } from '../../../test/admin';
import { createTestDb, resetDb, type TestDatabase } from '../../../test/db';
import { CapturingNotifications } from '../../../test/notifications';
import { SoftwareAuthenticator } from '../../../test/webauthn';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { loadEnv } from '../../config/env';
import { OutboxDispatcher } from '../../shared/outbox/outbox.dispatcher';
import { NOTIFICATIONS } from '../../shared/tokens';
import { AuditAction } from '../audit/application/audit-actions';
import { AuditService } from '../audit/application/audit.service';
import { LedgerStore } from '../ledger/infra/ledger.repository';

const ORIGIN = 'http://localhost:3001';
const RP_ID = 'localhost';
const DEVICE = { name: 'Chrome on Windows', platform: 'web' } as const;
const EUR = 'EUR' as const;

const BOOTSTRAP_EMAIL = 'root@fides.local';
const BOOTSTRAP_PASSWORD = 'a-sufficiently-long-password';
const MAKER_PASSWORD = 'another-sufficiently-long-password';

const SUPER_ID = '00000000-0000-7000-8000-00000000c001';
const MAKER_ID = '00000000-0000-7000-8000-00000000c002';
const AUDITOR_ID = '00000000-0000-7000-8000-00000000c003';

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
  process.env.ADMIN_BOOTSTRAP_EMAIL = BOOTSTRAP_EMAIL;
  process.env.ADMIN_BOOTSTRAP_PASSWORD = BOOTSTRAP_PASSWORD;

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
  // Test files share a process; leave no bootstrap configuration behind.
  delete process.env.ADMIN_BOOTSTRAP_EMAIL;
  delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
});

beforeEach(async () => {
  await resetDb(db as TestDatabase);
  notifications.sent.length = 0;
  // `app.init()` seeded the bootstrap admin once; the truncate above removes it,
  // so each test re-creates the operators it needs with cheap KDF parameters.
  await seedAdmin(db as TestDatabase, {
    id: SUPER_ID,
    email: BOOTSTRAP_EMAIL,
    role: 'super_admin',
    password: BOOTSTRAP_PASSWORD,
  });
});

interface EnrolledUser {
  readonly userId: string;
  readonly email: string;
  readonly accessToken: string;
}

/** Register, verify email, enrol a passkey, and provision the account. */
async function enrolCustomer(email: string): Promise<EnrolledUser> {
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

  await dispatcher.dispatchPending();
  return { userId, email, accessToken: finished.body.session.accessToken as string };
}

async function signInSuper(): Promise<AdminSession> {
  return signInAdmin(server, { email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD });
}

describe('admin authentication (HTTP)', () => {
  it('issues a session only after both factors, enrolling TOTP on first login', async () => {
    const login = await request(server)
      .post('/v1/admin/auth/login')
      .send({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD })
      .expect(200);
    expect(login.body.mfaEnrolled).toBe(false);
    expect(login.body.challengeToken).toMatch(/^alc_/);
    // The password step returns no session material of any kind.
    expect(login.body.token).toBeUndefined();

    const enrolled = await request(server)
      .post('/v1/admin/auth/mfa/enrol')
      .send({ challengeToken: login.body.challengeToken })
      .expect(200);
    expect(enrolled.body.otpauthUri).toContain('otpauth://totp/');

    const session = await signInAdmin(
      server,
      { email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD },
      // A fresh login challenge; the secret just issued is still the active one.
      { secret: enrolled.body.secret as string },
    );
    expect(session.token).toMatch(/^ast_/);

    const me = await request(server)
      .get('/v1/admin/me')
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    expect(me.body).toMatchObject({
      email: BOOTSTRAP_EMAIL,
      role: 'super_admin',
      mfaEnrolled: true,
    });
    expect(me.body.permissions).toContain('audit.read');
    expect(me.body.permissions).not.toContain('admin_funding.request');
  });

  it('rejects wrong credentials, unknown admins, and codes uniformly', async () => {
    await request(server)
      .post('/v1/admin/auth/login')
      .send({ email: BOOTSTRAP_EMAIL, password: 'wrong-password-entirely' })
      .expect(401);
    await request(server)
      .post('/v1/admin/auth/login')
      .send({ email: 'nobody@fides.local', password: BOOTSTRAP_PASSWORD })
      .expect(401);

    const login = await request(server)
      .post('/v1/admin/auth/login')
      .send({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD })
      .expect(200);
    await request(server)
      .post('/v1/admin/auth/mfa/enrol')
      .send({ challengeToken: login.body.challengeToken })
      .expect(200);
    await request(server)
      .post('/v1/admin/auth/mfa/verify')
      .send({ challengeToken: login.body.challengeToken, code: '000000' })
      .expect(401);
  });

  it('keeps customer and admin tokens in disjoint namespaces', async () => {
    const session = await signInSuper();
    const customer = await enrolCustomer('alice@example.com');

    // A customer token cannot reach the back office...
    await request(server)
      .get('/v1/admin/customers')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(401);
    // ...and an admin token cannot reach the customer surface.
    await request(server)
      .get('/v1/accounts')
      .set('Authorization', `Bearer ${session.token}`)
      .expect(401);
  });

  it('revokes the session on logout, immediately', async () => {
    const session = await signInSuper();
    await request(server)
      .post('/v1/admin/auth/logout')
      .set('Authorization', `Bearer ${session.token}`)
      .expect(204);
    await request(server)
      .get('/v1/admin/me')
      .set('Authorization', `Bearer ${session.token}`)
      .expect(401);
  });
});

describe('admin RBAC', () => {
  it('authorizes by permission, not by role name', async () => {
    const session = await signInSuper();
    await seedAdmin(db as TestDatabase, {
      id: AUDITOR_ID,
      email: 'auditor@fides.local',
      role: 'auditor',
      password: MAKER_PASSWORD,
    });
    const auditor = await signInAdmin(server, {
      email: 'auditor@fides.local',
      password: MAKER_PASSWORD,
    });

    // The auditor reads the trail but cannot act on the four-eyes queue.
    await request(server)
      .get('/v1/admin/audit')
      .set('Authorization', `Bearer ${auditor.token}`)
      .expect(200);
    await request(server)
      .post('/v1/admin/funding-requests')
      .set('Authorization', `Bearer ${auditor.token}`)
      .send({ userId: SUPER_ID, amount: { amount: '100', currency: EUR }, reason: 'nope' })
      .expect(403);
    // Staffing is super_admin only.
    await request(server)
      .get('/v1/admin/admins')
      .set('Authorization', `Bearer ${auditor.token}`)
      .expect(403);
    await request(server)
      .get('/v1/admin/admins')
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
  });

  it('denies super_admin the maker half, so no role can both raise and approve', async () => {
    const session = await signInSuper();
    const customer = await enrolCustomer('alice@example.com');

    await request(server)
      .post('/v1/admin/funding-requests')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        userId: customer.userId,
        amount: { amount: '5000', currency: EUR },
        reason: 'self-service attempt',
      })
      .expect(403);
  });

  it('supports staffing the back office, and disabling an operator ends their access', async () => {
    const session = await signInSuper();

    const created = await request(server)
      .post('/v1/admin/admins')
      .set('Authorization', `Bearer ${session.token}`)
      .send({ email: 'agent@fides.local', role: 'support_agent', password: MAKER_PASSWORD })
      .expect(201);
    expect(created.body).toMatchObject({ role: 'support_agent', mfaEnrolled: false });
    // No secret material ever leaves on this response.
    expect(created.body.password).toBeUndefined();
    expect(created.body.passwordHash).toBeUndefined();

    // A duplicate email is a conflict, not a silent overwrite.
    await request(server)
      .post('/v1/admin/admins')
      .set('Authorization', `Bearer ${session.token}`)
      .send({ email: 'agent@fides.local', role: 'auditor', password: MAKER_PASSWORD })
      .expect(409);

    const agent = await signInAdmin(server, {
      email: 'agent@fides.local',
      password: MAKER_PASSWORD,
    });
    await request(server)
      .get('/v1/admin/me')
      .set('Authorization', `Bearer ${agent.token}`)
      .expect(200);

    await request(server)
      .post(`/v1/admin/admins/${created.body.id as string}/status`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ status: 'disabled' })
      .expect(200);
    // The live session dies on the next request, not at its next expiry.
    await request(server)
      .get('/v1/admin/me')
      .set('Authorization', `Bearer ${agent.token}`)
      .expect(401);
  });
});

describe('admin read-only views', () => {
  it('serves the customer directory, wallet history, and ledger reconciliation', async () => {
    const session = await signInSuper();
    const customer = await enrolCustomer('alice@example.com');

    const list = await request(server)
      .get('/v1/admin/customers?limit=10')
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      email: 'alice@example.com',
      emailVerified: true,
      kycStatus: 'approved',
    });

    const detail = await request(server)
      .get(`/v1/admin/customers/${customer.userId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    expect(detail.body).toMatchObject({ givenName: 'Alice', country: 'FR' });
    const wallet = detail.body.accounts[0].wallets[0];
    expect(wallet.balance).toEqual({ amount: '0', currency: 'EUR' });

    // The admin history read is capability-scoped, not ownership-scoped.
    const history = await request(server)
      .get(`/v1/admin/wallets/${wallet.id as string}/transactions`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    expect(history.body.items).toEqual([]);

    // The ledger view surfaces the ADR-0019 reconciliation invariant.
    const ledgerAccount = await request(server)
      .get(`/v1/admin/ledger/accounts/${wallet.ledgerAccountId as string}`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    expect(ledgerAccount.body).toMatchObject({
      type: 'liability',
      currency: 'EUR',
      system: false,
      reconciled: true,
    });
    expect(ledgerAccount.body.projectedBalance).toEqual(ledgerAccount.body.computedBalance);

    await request(server)
      .get('/v1/admin/customers/00000000-0000-7000-8000-0000000000ff')
      .set('Authorization', `Bearer ${session.token}`)
      .expect(404);
  });

  it('reads and verifies the audit trail — the surface Slice 6 deferred', async () => {
    const session = await signInSuper();
    await enrolCustomer('alice@example.com');

    const page = await request(server)
      .get('/v1/admin/audit?limit=2')
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    expect(page.body.items.length).toBe(2);
    // Newest first, over the gap-free sequence.
    expect(page.body.items[0].seq).toBeGreaterThan(page.body.items[1].seq);
    expect(page.body.nextCursor).toBeTruthy();

    const next = await request(server)
      .get(`/v1/admin/audit?limit=2&cursor=${page.body.nextCursor as string}`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    expect(next.body.items[0].seq).toBeLessThan(page.body.items[1].seq);

    const filtered = await request(server)
      .get(`/v1/admin/audit?action=${AuditAction.AccountProvisioned}`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].actorType).toBe('system');

    const verified = await request(server)
      .get('/v1/admin/audit/verify')
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    expect(verified.body).toMatchObject({ ok: true, brokenAtSeq: null });
    expect(verified.body.count).toBeGreaterThan(0);
  });
});

describe('four-eyes admin funding', () => {
  /** A compliance officer: holds the maker half, and cannot hold the checker half. */
  async function staffMaker(): Promise<AdminSession> {
    await seedAdmin(db as TestDatabase, {
      id: MAKER_ID,
      email: 'maker@fides.local',
      role: 'compliance_officer',
      password: MAKER_PASSWORD,
    });
    return signInAdmin(server, { email: 'maker@fides.local', password: MAKER_PASSWORD });
  }

  it('moves no money until a second admin approves, then posts atomically', async () => {
    const checker = await signInSuper();
    const maker = await staffMaker();
    const customer = await enrolCustomer('alice@example.com');

    const filed = await request(server)
      .post('/v1/admin/funding-requests')
      .set('Authorization', `Bearer ${maker.token}`)
      .set('X-Correlation-Id', 'four-eyes-corr-000001')
      .send({
        userId: customer.userId,
        amount: { amount: '25000', currency: EUR },
        reason: 'Goodwill credit for incident 42',
      })
      .expect(201);
    expect(filed.body).toMatchObject({
      type: 'admin_funding',
      status: 'pending',
      makerId: maker.adminId,
      checkerId: null,
      resultRef: null,
      expired: false,
    });

    // Filing moved nothing.
    const beforeApproval = await request(server)
      .get('/v1/accounts')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(beforeApproval.body.accounts[0].wallets[0].balance).toEqual({
      amount: '0',
      currency: 'EUR',
    });

    // The maker cannot approve their own request, even though the request is
    // otherwise perfectly valid — this is the segregation-of-duties boundary.
    await request(server)
      .post(`/v1/admin/pending-actions/${filed.body.id as string}/approve`)
      .set('Authorization', `Bearer ${maker.token}`)
      .set('Idempotency-Key', 'self-approve')
      .send({})
      .expect(403);

    const approved = await request(server)
      .post(`/v1/admin/pending-actions/${filed.body.id as string}/approve`)
      .set('Authorization', `Bearer ${checker.token}`)
      .set('Idempotency-Key', 'approve-1')
      .set('X-Correlation-Id', 'four-eyes-corr-000002')
      .send({ reason: 'Verified against the incident record' })
      .expect(201);
    expect(approved.body.action).toMatchObject({
      status: 'approved',
      checkerId: checker.adminId,
      resultRef: approved.body.fundingId,
    });

    // The money moved, and the ledger still nets to zero.
    const afterApproval = await request(server)
      .get('/v1/accounts')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(afterApproval.body.accounts[0].wallets[0].balance).toEqual({
      amount: '25000',
      currency: 'EUR',
    });
    expect((await app.get(LedgerStore).sumSignedByCurrency()).get('EUR')).toBe(0n);

    // Both the workflow decision and the money move are on the trail, attributed
    // to admins, and the whole chain is still intact.
    const trail = await request(server)
      .get('/v1/admin/audit?limit=100')
      .set('Authorization', `Bearer ${checker.token}`)
      .expect(200);
    const byAction = new Map<string, Record<string, unknown>>(
      (trail.body.items as Record<string, unknown>[]).map((row) => [row.action as string, row]),
    );
    expect(byAction.get(AuditAction.AdminFundingRequested)).toMatchObject({
      actorType: 'admin',
      actorId: maker.adminId,
      correlationId: 'four-eyes-corr-000001',
    });
    expect(byAction.get(AuditAction.AdminFundingApproved)).toMatchObject({
      actorType: 'admin',
      actorId: checker.adminId,
      correlationId: 'four-eyes-corr-000002',
    });
    expect(byAction.get(AuditAction.AdminFundingExecuted)).toMatchObject({
      actorType: 'admin',
      actorId: checker.adminId,
      resourceId: approved.body.fundingId,
    });
    expect(await app.get(AuditService).verify()).toMatchObject({ ok: true });
  });

  it('refuses to approve the same request twice, and replays an idempotent retry', async () => {
    const checker = await signInSuper();
    const maker = await staffMaker();
    const customer = await enrolCustomer('alice@example.com');

    const filed = await request(server)
      .post('/v1/admin/funding-requests')
      .set('Authorization', `Bearer ${maker.token}`)
      .send({
        userId: customer.userId,
        amount: { amount: '1000', currency: EUR },
        reason: 'Test credit',
      })
      .expect(201);
    const actionId = filed.body.id as string;

    const first = await request(server)
      .post(`/v1/admin/pending-actions/${actionId}/approve`)
      .set('Authorization', `Bearer ${checker.token}`)
      .set('Idempotency-Key', 'approve-once')
      .send({})
      .expect(201);

    // The same key replays the stored result: no second posting.
    const replay = await request(server)
      .post(`/v1/admin/pending-actions/${actionId}/approve`)
      .set('Authorization', `Bearer ${checker.token}`)
      .set('Idempotency-Key', 'approve-once')
      .send({})
      .expect(201);
    expect(replay.body.fundingId).toBe(first.body.fundingId);

    // A fresh key on an already-decided request is rejected outright.
    await request(server)
      .post(`/v1/admin/pending-actions/${actionId}/approve`)
      .set('Authorization', `Bearer ${checker.token}`)
      .set('Idempotency-Key', 'approve-again')
      .send({})
      .expect(400);

    const balance = await request(server)
      .get('/v1/accounts')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(balance.body.accounts[0].wallets[0].balance).toEqual({
      amount: '1000',
      currency: 'EUR',
    });
  });

  it('rejects a request without moving money, and cannot then approve it', async () => {
    const checker = await signInSuper();
    const maker = await staffMaker();
    const customer = await enrolCustomer('alice@example.com');

    const filed = await request(server)
      .post('/v1/admin/funding-requests')
      .set('Authorization', `Bearer ${maker.token}`)
      .send({
        userId: customer.userId,
        amount: { amount: '9999', currency: EUR },
        reason: 'Unsupported claim',
      })
      .expect(201);

    const rejected = await request(server)
      .post(`/v1/admin/pending-actions/${filed.body.id as string}/reject`)
      .set('Authorization', `Bearer ${checker.token}`)
      .send({ reason: 'No supporting evidence' })
      .expect(200);
    expect(rejected.body).toMatchObject({
      status: 'rejected',
      checkerId: checker.adminId,
      resultRef: null,
    });

    await request(server)
      .post(`/v1/admin/pending-actions/${filed.body.id as string}/approve`)
      .set('Authorization', `Bearer ${checker.token}`)
      .set('Idempotency-Key', 'too-late')
      .send({})
      .expect(400);

    const balance = await request(server)
      .get('/v1/accounts')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(balance.body.accounts[0].wallets[0].balance).toEqual({ amount: '0', currency: 'EUR' });
  });

  it('validates the request up front and requires an idempotency key to approve', async () => {
    const checker = await signInSuper();
    const maker = await staffMaker();
    const customer = await enrolCustomer('alice@example.com');

    // Over the configured cap: rejected when filed, so no checker time is spent.
    await request(server)
      .post('/v1/admin/funding-requests')
      .set('Authorization', `Bearer ${maker.token}`)
      .send({
        userId: customer.userId,
        amount: { amount: '99999999', currency: EUR },
        reason: 'Too much',
      })
      .expect(400);

    // A customer with no wallet yet cannot be funded.
    await request(server)
      .post('/v1/admin/funding-requests')
      .set('Authorization', `Bearer ${maker.token}`)
      .send({
        userId: '00000000-0000-7000-8000-0000000000ff',
        amount: { amount: '100', currency: EUR },
        reason: 'Unknown',
      })
      .expect(404);

    const filed = await request(server)
      .post('/v1/admin/funding-requests')
      .set('Authorization', `Bearer ${maker.token}`)
      .send({
        userId: customer.userId,
        amount: { amount: '100', currency: EUR },
        reason: 'Fine',
      })
      .expect(201);

    await request(server)
      .post(`/v1/admin/pending-actions/${filed.body.id as string}/approve`)
      .set('Authorization', `Bearer ${checker.token}`)
      .send({})
      .expect(400);
  });

  it('lists the queue, filterable by status', async () => {
    const checker = await signInSuper();
    const maker = await staffMaker();
    const customer = await enrolCustomer('alice@example.com');

    for (const amount of ['100', '200']) {
      await request(server)
        .post('/v1/admin/funding-requests')
        .set('Authorization', `Bearer ${maker.token}`)
        .send({ userId: customer.userId, amount: { amount, currency: EUR }, reason: 'Batch' })
        .expect(201);
    }

    const pending = await request(server)
      .get('/v1/admin/pending-actions?status=pending')
      .set('Authorization', `Bearer ${checker.token}`)
      .expect(200);
    expect(pending.body.items).toHaveLength(2);

    await request(server)
      .post(`/v1/admin/pending-actions/${pending.body.items[0].id as string}/reject`)
      .set('Authorization', `Bearer ${checker.token}`)
      .send({})
      .expect(200);

    const stillPending = await request(server)
      .get('/v1/admin/pending-actions?status=pending')
      .set('Authorization', `Bearer ${checker.token}`)
      .expect(200);
    expect(stillPending.body.items).toHaveLength(1);

    const single = await request(server)
      .get(`/v1/admin/pending-actions/${stillPending.body.items[0].id as string}`)
      .set('Authorization', `Bearer ${maker.token}`)
      .expect(200);
    expect(single.body.status).toBe('pending');
  });
});

describe('admin OpenAPI surface', () => {
  it('publishes the back-office routes', async () => {
    const docs = await request(server).get('/docs-json').expect(200);
    const paths = Object.keys(docs.body.paths as Record<string, unknown>);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/v1/admin/auth/login',
        '/v1/admin/auth/mfa/enrol',
        '/v1/admin/auth/mfa/verify',
        '/v1/admin/me',
        '/v1/admin/admins',
        '/v1/admin/customers',
        '/v1/admin/customers/{userId}',
        '/v1/admin/wallets/{walletId}/transactions',
        '/v1/admin/ledger/accounts/{ledgerAccountId}',
        '/v1/admin/audit',
        '/v1/admin/audit/verify',
        '/v1/admin/funding-requests',
        '/v1/admin/pending-actions',
        '/v1/admin/pending-actions/{actionId}/approve',
      ]),
    );
  });
});
