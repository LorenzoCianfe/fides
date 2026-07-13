import { Money, ValidationError, type CurrencyCode } from '@fides/domain';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { transactionHistory } from '../infra/transaction-history.schema';

/** One projected history entry for a ledger account, as a domain view. */
export interface TransactionHistoryEntry {
  /** The journal entry id (stable, unique per account). */
  readonly id: string;
  readonly type: string;
  /** Signed effect on this account's balance: negative debited, positive credited. */
  readonly amount: Money;
  readonly balanceAfter: Money;
  readonly occurredAt: Date;
}

export interface TransactionHistoryPage {
  readonly items: readonly TransactionHistoryEntry[];
  /** Opaque cursor for the next page, or null when the last page was returned. */
  readonly nextCursor: string | null;
}

export interface ListHistoryOptions {
  readonly limit: number;
  readonly cursor?: string;
}

interface Keyset {
  readonly occurredAt: Date;
  readonly journalEntryId: string;
}

/**
 * Read side of the `transaction_history` projection (ADR-0019). Returns a
 * ledger account's entries newest-first, keyset-paginated over
 * `(occurred_at desc, journal_entry_id desc)` — a stable total order (the
 * `(account, entry)` uniqueness makes the entry id a deterministic tiebreaker),
 * so pages never skip or duplicate rows as new entries arrive.
 */
export class TransactionHistoryReader {
  constructor(private readonly db: Database) {}

  async listByAccount(
    ledgerAccountId: string,
    options: ListHistoryOptions,
  ): Promise<TransactionHistoryPage> {
    const after = options.cursor ? decodeCursor(options.cursor) : undefined;

    const rows = await this.db
      .select({
        journalEntryId: transactionHistory.journalEntryId,
        entryType: transactionHistory.entryType,
        amountMinor: transactionHistory.amountMinor,
        balanceAfterMinor: transactionHistory.balanceAfterMinor,
        currency: transactionHistory.currency,
        occurredAt: transactionHistory.occurredAt,
      })
      .from(transactionHistory)
      .where(
        after
          ? and(eq(transactionHistory.accountId, ledgerAccountId), keysetBefore(after))
          : eq(transactionHistory.accountId, ledgerAccountId),
      )
      .orderBy(desc(transactionHistory.occurredAt), desc(transactionHistory.journalEntryId))
      .limit(options.limit + 1);

    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;

    const items = page.map((row) => {
      const currency = row.currency as CurrencyCode;
      return {
        id: row.journalEntryId,
        type: row.entryType,
        amount: Money.fromMinor(row.amountMinor, currency),
        balanceAfter: Money.fromMinor(BigInt(row.balanceAfterMinor), currency),
        occurredAt: row.occurredAt,
      };
    });

    const last = page.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(last.occurredAt, last.journalEntryId) : null;
    return { items, nextCursor };
  }
}

function keysetBefore(after: Keyset) {
  return or(
    lt(transactionHistory.occurredAt, after.occurredAt),
    and(
      eq(transactionHistory.occurredAt, after.occurredAt),
      lt(transactionHistory.journalEntryId, after.journalEntryId),
    ),
  );
}

function encodeCursor(occurredAt: Date, journalEntryId: string): string {
  return Buffer.from(`${occurredAt.toISOString()}|${journalEntryId}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): Keyset {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  const iso = separator >= 0 ? decoded.slice(0, separator) : '';
  const journalEntryId = separator >= 0 ? decoded.slice(separator + 1) : '';
  const occurredAt = new Date(iso);
  if (separator < 0 || journalEntryId.length === 0 || Number.isNaN(occurredAt.getTime())) {
    throw new ValidationError('Malformed pagination cursor', { cursor });
  }
  return { occurredAt, journalEntryId };
}
