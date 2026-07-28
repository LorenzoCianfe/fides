import { Money } from '@fides/domain';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, type TestDatabase } from '../../../test/db';
import { outbox } from '../../database/schema/outbox';
import type { IdempotencyContext } from '../../shared/idempotency/idempotency.service';
import { UuidV7Generator } from '../../shared/ids/uuid-v7';
import { OutboxDispatcher } from '../../shared/outbox/outbox.dispatcher';
import { SystemClock } from '../../shared/time/system-clock';
import { LEDGER_ENTRY_POSTED, type LedgerEntryPostedPayload } from './application/ledger-events';
import { PostingService, type PostEntryCommand } from './application/posting.service';
import { TransactionHistoryProjector } from './application/transaction-history.projector';
import { PostingDirection } from './domain/account';
import { buildJournalEntry, type JournalEntry } from './domain/journal-entry';
import { LedgerStore } from './infra/ledger.repository';
import { transactionHistory } from './infra/transaction-history.schema';

const ids = new UuidV7Generator();
const clock = new SystemClock();

const { db, close } = createTestDb();
const store = new LedgerStore(db as TestDatabase, ids);
const posting = new PostingService(db as TestDatabase, ids, clock);
const projector = new TransactionHistoryProjector(ids);
const dispatcher = new OutboxDispatcher(db as TestDatabase, {
  [LEDGER_ENTRY_POSTED]: (tx, payload) =>
    projector.project(tx, payload as LedgerEntryPostedPayload),
});

function eur(minor: number | bigint): Money {
  return Money.fromMinor(minor, 'EUR');
}

function idem(): IdempotencyContext {
  return { actorId: ids.next(), key: ids.next(), fingerprint: 'fp', operation: 'test' };
}

async function setupAccounts(): Promise<{ settlement: string; alice: string; bob: string }> {
  const settlement = await store.ensureSystemAccount({
    type: 'asset',
    currency: 'EUR',
    code: 'system:settlement',
  });
  const alice = await store.createAccount({
    type: 'liability',
    currency: 'EUR',
    code: `wallet:${ids.next()}`,
    system: false,
  });
  const bob = await store.createAccount({
    type: 'liability',
    currency: 'EUR',
    code: `wallet:${ids.next()}`,
    system: false,
  });
  return { settlement: settlement.id, alice: alice.id, bob: bob.id };
}

function funding(settlementId: string, walletId: string, amount: Money): JournalEntry {
  return buildJournalEntry({
    id: ids.next(),
    type: 'funding',
    occurredAt: clock.now(),
    postings: [
      { accountId: settlementId, direction: PostingDirection.Debit, amount },
      { accountId: walletId, direction: PostingDirection.Credit, amount },
    ],
  });
}

function transfer(fromId: string, toId: string, amount: Money): JournalEntry {
  return buildJournalEntry({
    id: ids.next(),
    type: 'transfer',
    occurredAt: clock.now(),
    postings: [
      { accountId: fromId, direction: PostingDirection.Debit, amount },
      { accountId: toId, direction: PostingDirection.Credit, amount },
    ],
  });
}

function command(entry: JournalEntry, guard: string[], ctx: IdempotencyContext): PostEntryCommand {
  return { entry, guardAccountIds: guard, idempotency: ctx };
}

async function historyFor(accountId: string): Promise<(typeof transactionHistory.$inferSelect)[]> {
  return db
    .select()
    .from(transactionHistory)
    .where(eq(transactionHistory.accountId, accountId))
    .orderBy(asc(transactionHistory.occurredAt));
}

async function pendingCount(): Promise<number> {
  const rows = await db.select({ id: outbox.id }).from(outbox).where(eq(outbox.status, 'pending'));
  return rows.length;
}

describe('transaction-history projection (integration)', () => {
  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetDb(db as TestDatabase);
  });

  it('projects a history row per affected account with signed amount and running balance', async () => {
    const { settlement, alice, bob } = await setupAccounts();
    await posting.post(command(funding(settlement, alice, eur(10_000)), [], idem()));
    await posting.post(command(transfer(alice, bob, eur(2_500)), [alice], idem()));

    const result = await dispatcher.dispatchPending();
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(await pendingCount()).toBe(0);

    const aliceRows = await historyFor(alice);
    expect(aliceRows).toHaveLength(2);
    const aliceTransfer = aliceRows.find((row) => row.entryType === 'transfer');
    expect(aliceTransfer?.amountMinor).toBe(-2_500n);
    expect(aliceTransfer?.balanceAfterMinor).toBe('7500');
    expect(aliceTransfer?.counterpartyAccountIds as string[]).toContain(bob);

    const bobRows = await historyFor(bob);
    expect(bobRows).toHaveLength(1);
    expect(bobRows[0]?.amountMinor).toBe(2_500n);
    expect(bobRows[0]?.balanceAfterMinor).toBe('2500');
    expect(bobRows[0]?.counterpartyAccountIds as string[]).toContain(alice);
  });

  it('is idempotent when an event is re-delivered', async () => {
    const { settlement, alice } = await setupAccounts();
    await posting.post(command(funding(settlement, alice, eur(5_000)), [], idem()));

    await dispatcher.dispatchPending();
    expect(await historyFor(alice)).toHaveLength(1);

    // Simulate at-least-once re-delivery: re-queue the event and dispatch again.
    await db.update(outbox).set({ status: 'pending' }).where(eq(outbox.type, LEDGER_ENTRY_POSTED));
    const second = await dispatcher.dispatchPending();
    expect(second.processed).toBe(1);
    expect(await historyFor(alice)).toHaveLength(1);
  });

  it('drains nothing when the outbox is empty', async () => {
    const result = await dispatcher.dispatchPending();
    expect(result).toEqual({ processed: 0, skipped: 0, failed: 0 });
  });

  it('leaves event types without a registered handler pending for their future consumer', async () => {
    await db.insert(outbox).values({
      id: ids.next(),
      type: 'kyc.approved',
      aggregateType: 'user',
      aggregateId: ids.next(),
      payload: { userId: 'someone' },
      occurredAt: new Date(),
    });

    const result = await dispatcher.dispatchPending();
    expect(result).toEqual({ processed: 0, skipped: 0, failed: 0 });

    const [row] = await db.select().from(outbox).where(eq(outbox.type, 'kyc.approved'));
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(0);
  });
});
