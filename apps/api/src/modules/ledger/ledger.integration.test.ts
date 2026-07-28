import { Money, type CurrencyCode } from '@fides/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, type TestDatabase } from '../../../test/db';
import type { IdempotencyContext } from '../../shared/idempotency/idempotency.service';
import { UuidV7Generator } from '../../shared/ids/uuid-v7';
import { SystemClock } from '../../shared/time/system-clock';
import { PostingService, type PostEntryCommand } from './application/posting.service';
import { PostingDirection } from './domain/account';
import { buildJournalEntry, type JournalEntry } from './domain/journal-entry';
import { LedgerStore } from './infra/ledger.repository';

const ids = new UuidV7Generator();
const clock = new SystemClock();
const FIXED_ACTOR = '00000000-0000-7000-8000-000000000001';

const { db, close } = createTestDb();
const store = new LedgerStore(db as TestDatabase, ids);
const posting = new PostingService(db as TestDatabase, ids, clock);

function eur(minor: number | bigint): Money {
  return Money.fromMinor(minor, 'EUR');
}

function idem(overrides: Partial<IdempotencyContext> = {}): IdempotencyContext {
  return {
    actorId: ids.next(),
    key: ids.next(),
    fingerprint: 'fp',
    operation: 'test',
    ...overrides,
  };
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

function command(
  entry: JournalEntry,
  guardAccountIds: string[],
  ctx: IdempotencyContext,
): PostEntryCommand {
  return { entry, guardAccountIds, idempotency: ctx };
}

async function balanceMinor(accountId: string): Promise<bigint> {
  return (await store.getBalance(accountId)).amount;
}

/** Run a query and capture the rejection, flattening the error's cause chain. */
async function captureDbError(
  run: Promise<unknown>,
): Promise<{ rejected: boolean; text: string; code?: string }> {
  try {
    await run;
    return { rejected: false, text: '' };
  } catch (error) {
    const parts: string[] = [];
    let code: string | undefined;
    let current: unknown = error;
    while (current instanceof Error) {
      parts.push(current.message);
      const candidate = (current as { code?: unknown }).code;
      if (typeof candidate === 'string') code = candidate;
      current = current.cause;
    }
    return { rejected: true, text: parts.join(' | '), code };
  }
}

describe('ledger persistence (integration)', () => {
  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetDb(db as TestDatabase);
  });

  it('funds a wallet then transfers, keeping balances reconciled and the ledger balanced', async () => {
    const { settlement, alice, bob } = await setupAccounts();

    await posting.post(command(funding(settlement, alice, eur(10_000)), [], idem()));
    await posting.post(command(transfer(alice, bob, eur(2_500)), [alice], idem()));

    expect(await balanceMinor(alice)).toBe(7_500n);
    expect(await balanceMinor(bob)).toBe(2_500n);
    expect(await balanceMinor(settlement)).toBe(10_000n);

    for (const accountId of [settlement, alice, bob]) {
      const reconciliation = await store.reconcileAccount(accountId);
      expect(reconciliation.consistent).toBe(true);
    }

    const totals = await store.sumSignedByCurrency();
    expect(totals.get('EUR')).toBe(0n);
  });

  it('replays the stored result for a duplicate idempotency key without double-posting', async () => {
    const { settlement, alice } = await setupAccounts();
    const ctx: IdempotencyContext = {
      actorId: FIXED_ACTOR,
      key: 'fund-once',
      fingerprint: 'fp-fund',
      operation: 'funding',
    };

    const first = await posting.post(command(funding(settlement, alice, eur(5_000)), [], ctx));
    const second = await posting.post(command(funding(settlement, alice, eur(9_999)), [], ctx));

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.entryId).toBe(first.entryId);
    expect(await balanceMinor(alice)).toBe(5_000n);
  });

  it('rejects a reused idempotency key carrying a different request', async () => {
    const { settlement, alice } = await setupAccounts();
    const base = { actorId: FIXED_ACTOR, key: 'reused', operation: 'funding' };

    await posting.post(
      command(funding(settlement, alice, eur(1_000)), [], { ...base, fingerprint: 'fp-A' }),
    );

    await expect(
      posting.post(
        command(funding(settlement, alice, eur(1_000)), [], { ...base, fingerprint: 'fp-B' }),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('rejects a transfer that would overdraw a wallet and leaves state unchanged', async () => {
    const { settlement, alice, bob } = await setupAccounts();
    await posting.post(command(funding(settlement, alice, eur(1_000)), [], idem()));

    await expect(
      posting.post(command(transfer(alice, bob, eur(5_000)), [alice], idem())),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });

    expect(await balanceMinor(alice)).toBe(1_000n);
    expect(await balanceMinor(bob)).toBe(0n);
  });

  it('forbids UPDATE and DELETE on the append-only ledger tables', async () => {
    const { settlement, alice } = await setupAccounts();
    const result = await posting.post(command(funding(settlement, alice, eur(100)), [], idem()));

    const onUpdate = await captureDbError(
      db.execute(sql`UPDATE journal_entries SET type = 'tampered' WHERE id = ${result.entryId}`),
    );
    expect(onUpdate.rejected).toBe(true);
    expect(onUpdate.code === '23001' || /append-only/i.test(onUpdate.text)).toBe(true);

    const onDelete = await captureDbError(
      db.execute(sql`DELETE FROM postings WHERE account_id = ${alice}`),
    );
    expect(onDelete.rejected).toBe(true);
    expect(onDelete.code === '23001' || /append-only/i.test(onDelete.text)).toBe(true);
  });

  it('reads back a currency-correct Money balance', async () => {
    const { settlement, alice } = await setupAccounts();
    await posting.post(command(funding(settlement, alice, eur(4_200)), [], idem()));
    const balance = await store.getBalance(alice);
    expect(balance.currency).toBe<CurrencyCode>('EUR');
    expect(balance.toDecimalString()).toBe('42.00');
  });
});
