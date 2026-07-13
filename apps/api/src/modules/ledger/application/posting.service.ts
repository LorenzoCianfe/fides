import {
  createDomainEvent,
  InsufficientFundsError,
  InternalError,
  NotFoundError,
  type CurrencyCode,
  type EventClock,
  type IdGenerator,
} from '@fides/domain';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Database, DatabaseTx } from '../../../database/db.types';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  type IdempotencyContext,
} from '../../../shared/idempotency/idempotency.service';
import { appendToOutbox } from '../../../shared/outbox/outbox.writer';
import { balanceEffectMinor, type AccountType, type JournalEntry } from '../domain';
import { balances, journalEntries, ledgerAccounts, postings } from '../infra/ledger.schema';
import { LEDGER_ENTRY_POSTED, type LedgerEntryPostedPayload } from './ledger-events';

export interface PostEntryCommand {
  /** A pre-built, balanced journal entry. */
  readonly entry: JournalEntry;
  /** Accounts on which a negative resulting balance must be rejected. */
  readonly guardAccountIds: readonly string[];
  readonly idempotency: IdempotencyContext;
  /**
   * Optional step run inside the posting transaction on the first (claiming)
   * execution only — never on an idempotent replay. Slice 5 uses it to consume
   * the SCA grant atomically with the posting (ADR-0021/0023): throwing here
   * rolls back the whole transaction, including the idempotency claim, so the
   * key is freed for a fresh attempt and the grant is left unconsumed. Runs
   * before any ledger write.
   */
  readonly onClaimed?: (tx: DatabaseTx, now: Date) => Promise<void>;
}

export interface AccountBalanceResult {
  readonly accountId: string;
  readonly currency: CurrencyCode;
  readonly balanceMinor: string;
}

interface StoredResult {
  readonly entryId: string;
  readonly occurredAt: string;
  readonly balances: readonly AccountBalanceResult[];
}

export interface PostEntryResult extends StoredResult {
  /** True when this result was replayed from a prior idempotent request. */
  readonly replayed: boolean;
}

function mustGet<K, V>(map: Map<K, V>, key: K, message: string): V {
  const value = map.get(key);
  if (value === undefined) throw new InternalError(message, { key: String(key) });
  return value;
}

/**
 * Posts a balanced journal entry and maintains the balance projection, the
 * transactional outbox, and idempotency — all in a single database transaction
 * (ADR-0005, ADR-0019). Balance rows are locked in a deterministic order to
 * prevent deadlocks; guarded accounts may not go negative.
 */
export class PostingService {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly clock: EventClock,
  ) {}

  async post(command: PostEntryCommand): Promise<PostEntryResult> {
    const { entry, guardAccountIds, idempotency, onClaimed } = command;

    return this.db.transaction(async (tx) => {
      const now = this.clock.now();

      const claim = await claimIdempotencyKey(tx, idempotency, now);
      if (!claim.claimed) {
        return { ...(claim.responseBody as StoredResult), replayed: true };
      }

      // First execution only: authorize (e.g. consume the SCA grant) atomically
      // with the posting. A replay returned above, so this never runs twice.
      if (onClaimed) await onClaimed(tx, now);

      const accountIds = [...new Set(entry.postings.map((posting) => posting.accountId))].sort();

      const accountRows = await tx
        .select({
          id: ledgerAccounts.id,
          type: ledgerAccounts.type,
          currency: ledgerAccounts.currency,
        })
        .from(ledgerAccounts)
        .where(inArray(ledgerAccounts.id, accountIds));
      if (accountRows.length !== accountIds.length) {
        throw new NotFoundError('One or more ledger accounts do not exist', {
          requested: accountIds,
          found: accountRows.map((row) => row.id),
        });
      }
      const typeByAccount = new Map<string, AccountType>(
        accountRows.map((row) => [row.id, row.type as AccountType]),
      );
      const currencyByAccount = new Map<string, CurrencyCode>(
        accountRows.map((row) => [row.id, row.currency as CurrencyCode]),
      );

      // Lock the affected balance rows in a deterministic order (by account id)
      // so concurrent postings can never deadlock against one another.
      const balanceRows = await tx
        .select({ accountId: balances.accountId, balance: balances.balance })
        .from(balances)
        .where(inArray(balances.accountId, accountIds))
        .orderBy(balances.accountId)
        .for('update');
      if (balanceRows.length !== accountIds.length) {
        throw new InternalError('Missing balance projection row for a ledger account', {
          requested: accountIds,
          found: balanceRows.map((row) => row.accountId),
        });
      }
      const balanceByAccount = new Map<string, bigint>(
        balanceRows.map((row) => [row.accountId, BigInt(row.balance)]),
      );

      const effectByAccount = new Map<string, bigint>();
      for (const posting of entry.postings) {
        const type = mustGet(typeByAccount, posting.accountId, 'Account type missing');
        const prior = effectByAccount.get(posting.accountId) ?? 0n;
        effectByAccount.set(posting.accountId, prior + balanceEffectMinor(posting, type));
      }

      for (const accountId of guardAccountIds) {
        const current = balanceByAccount.get(accountId) ?? 0n;
        const delta = effectByAccount.get(accountId) ?? 0n;
        if (current + delta < 0n) {
          throw new InsufficientFundsError({
            accountId,
            currentMinor: current.toString(),
            requiredMinor: (-delta).toString(),
          });
        }
      }

      await tx.insert(journalEntries).values({
        id: entry.id,
        type: entry.type,
        occurredAt: entry.occurredAt,
        correlationId: entry.correlationId ?? null,
        metadata: entry.metadata ?? null,
      });

      await tx.insert(postings).values(
        entry.postings.map((posting, index) => ({
          id: this.ids.next(),
          journalEntryId: entry.id,
          accountId: posting.accountId,
          direction: posting.direction,
          amount: posting.amount.amount,
          currency: posting.amount.currency,
          position: index,
        })),
      );

      const resultBalances: AccountBalanceResult[] = [];
      for (const accountId of accountIds) {
        const current = balanceByAccount.get(accountId) ?? 0n;
        const next = current + (effectByAccount.get(accountId) ?? 0n);
        await tx
          .update(balances)
          .set({ balance: next.toString(), version: sql`${balances.version} + 1`, updatedAt: now })
          .where(eq(balances.accountId, accountId));
        resultBalances.push({
          accountId,
          currency: mustGet(currencyByAccount, accountId, 'Account currency missing'),
          balanceMinor: next.toString(),
        });
      }

      const payload: LedgerEntryPostedPayload = {
        entryId: entry.id,
        entryType: entry.type,
        occurredAt: entry.occurredAt.toISOString(),
        accounts: resultBalances.map((balance) => ({
          accountId: balance.accountId,
          currency: balance.currency,
          amountMinor: (effectByAccount.get(balance.accountId) ?? 0n).toString(),
          balanceAfterMinor: balance.balanceMinor,
        })),
        postings: entry.postings.map((posting) => ({
          accountId: posting.accountId,
          direction: posting.direction,
          amount: posting.amount.amount.toString(),
          currency: posting.amount.currency,
        })),
      };

      const event = createDomainEvent(
        {
          type: LEDGER_ENTRY_POSTED,
          aggregateType: 'journal_entry',
          aggregateId: entry.id,
          payload,
          ...(entry.correlationId !== undefined ? { correlationId: entry.correlationId } : {}),
        },
        { ids: this.ids, clock: this.clock },
      );
      await appendToOutbox(tx, event);

      const stored: StoredResult = {
        entryId: entry.id,
        occurredAt: entry.occurredAt.toISOString(),
        balances: resultBalances,
      };
      await completeIdempotencyKey(tx, idempotency, 201, stored);

      return { ...stored, replayed: false };
    });
  }
}
