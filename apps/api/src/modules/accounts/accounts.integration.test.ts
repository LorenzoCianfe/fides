import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, type TestDatabase } from '../../../test/db';
import { CapturingNotifications } from '../../../test/notifications';
import { outbox } from '../../database/schema/outbox';
import { UuidV7Generator } from '../../shared/ids/uuid-v7';
import { OutboxDispatcher } from '../../shared/outbox/outbox.dispatcher';
import { SystemClock } from '../../shared/time/system-clock';
import { RegistrationService } from '../identity/application/registration.service';
import { KYC_APPROVED_EVENT, type KycApprovedPayload } from '../kyc/application/kyc-events';
import { MockKycAdapter } from '../kyc/infra/mock-kyc.adapter';
import { AuditAction } from '../audit/application/audit-actions';
import { AuditService } from '../audit/application/audit.service';
import { auditLog } from '../audit/infra/audit.schema';
import { LedgerStore } from '../ledger/infra/ledger.repository';
import { AccountProvisioningService } from './application/account-provisioning.service';
import { accounts, wallets } from './infra/accounts.schema';

const ids = new UuidV7Generator();
const clock = new SystemClock();

const { db, close } = createTestDb();
const store = new LedgerStore(db as TestDatabase, ids);
const audit = new AuditService(db as TestDatabase, ids, clock);
const provisioning = new AccountProvisioningService(store, ids, audit);
const notifications = new CapturingNotifications();
const registration = new RegistrationService(
  db as TestDatabase,
  ids,
  clock,
  new MockKycAdapter(ids),
  notifications,
);
const dispatcher = new OutboxDispatcher(db as TestDatabase, {
  [KYC_APPROVED_EVENT]: (tx, payload) =>
    provisioning.provisionForApprovedKyc(tx, payload as KycApprovedPayload),
});

const baseInput = {
  givenName: 'Alice',
  familyName: 'Ada',
  dateOfBirth: '1990-05-01',
  addressLine1: '1 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'FR',
} as const;

async function register(email: string): Promise<string> {
  const { userId } = await registration.register({ ...baseInput, email });
  return userId;
}

async function accountFor(userId: string): Promise<typeof accounts.$inferSelect | undefined> {
  const [row] = await db.select().from(accounts).where(eq(accounts.userId, userId)).limit(1);
  return row;
}

async function walletsFor(accountId: string): Promise<(typeof wallets.$inferSelect)[]> {
  return db.select().from(wallets).where(eq(wallets.accountId, accountId));
}

async function pendingCount(): Promise<number> {
  const rows = await db.select({ id: outbox.id }).from(outbox).where(eq(outbox.status, 'pending'));
  return rows.length;
}

describe('account provisioning (integration)', () => {
  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetDb(db as TestDatabase);
    notifications.sent.length = 0;
  });

  it('provisions one EUR account, wallet, and backing ledger account on kyc.approved', async () => {
    const userId = await register('alice@example.com');
    // The approval event waits until the handler is registered (this dispatch).
    expect(await pendingCount()).toBe(1);

    const result = await dispatcher.dispatchPending();
    expect(result).toEqual({ processed: 1, skipped: 0, failed: 0 });
    expect(await pendingCount()).toBe(0);

    const account = await accountFor(userId);
    expect(account?.status).toBe('active');

    const walletRows = await walletsFor(account!.id);
    expect(walletRows).toHaveLength(1);
    const wallet = walletRows[0]!;
    expect(wallet.currency).toBe('EUR');

    // The wallet is backed 1:1 by a liability ledger account coded to its id.
    const ledgerAccount = await store.findAccountById(wallet.ledgerAccountId);
    expect(ledgerAccount?.code).toBe(`wallet:${wallet.id}`);
    expect(ledgerAccount?.type).toBe('liability');
    expect(ledgerAccount?.system).toBe(false);
    expect(ledgerAccount?.currency).toBe('EUR');

    // The balance projection exists and starts at zero.
    const balance = await store.getBalance(wallet.ledgerAccountId);
    expect(balance.amount).toBe(0n);
    expect(balance.currency).toBe('EUR');

    // Provisioning is recorded on the tamper-evident audit trail as a system
    // action, atomically within the dispatcher transaction (ADR-0024).
    const auditRows = await db.select().from(auditLog);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.action).toBe(AuditAction.AccountProvisioned);
    expect(auditRows[0]!.actorType).toBe('system');
    expect(auditRows[0]!.actorId).toBeNull();
    expect(auditRows[0]!.resourceId).toBe(account!.id);
    expect((auditRows[0]!.metadata as { userId: string }).userId).toBe(userId);
    expect(await audit.verify()).toEqual({ ok: true, count: 1, brokenAtSeq: null });
  });

  it('is idempotent when the approval event is re-delivered', async () => {
    const userId = await register('alice@example.com');
    await dispatcher.dispatchPending();
    const first = await accountFor(userId);
    const firstWallets = await walletsFor(first!.id);

    // Simulate at-least-once re-delivery: re-queue the event and dispatch again.
    await db.update(outbox).set({ status: 'pending' }).where(eq(outbox.type, KYC_APPROVED_EVENT));
    const second = await dispatcher.dispatchPending();
    expect(second.processed).toBe(1);

    // Still exactly one account, one wallet, one ledger account — no duplicates.
    const after = await accountFor(userId);
    expect(after!.id).toBe(first!.id);
    const afterWallets = await walletsFor(first!.id);
    expect(afterWallets).toHaveLength(1);
    expect(afterWallets[0]!.id).toBe(firstWallets[0]!.id);
    expect(afterWallets[0]!.ledgerAccountId).toBe(firstWallets[0]!.ledgerAccountId);
    const allAccounts = await db.select({ id: accounts.id }).from(accounts);
    expect(allAccounts).toHaveLength(1);
  });

  it('provisions a distinct account per approved user when draining a backlog', async () => {
    const alice = await register('alice@example.com');
    const bob = await register('bob@example.com');
    expect(await pendingCount()).toBe(2);

    const result = await dispatcher.dispatchPending();
    expect(result.processed).toBe(2);

    const aliceAccount = await accountFor(alice);
    const bobAccount = await accountFor(bob);
    expect(aliceAccount).toBeDefined();
    expect(bobAccount).toBeDefined();
    expect(aliceAccount!.id).not.toBe(bobAccount!.id);
  });
});
