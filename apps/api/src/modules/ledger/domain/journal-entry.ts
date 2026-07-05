import { InvalidJournalEntryError, UnbalancedEntryError, type CurrencyCode } from '@fides/domain';
import { signedMinor, type Posting } from './posting';

/**
 * A balanced, append-only journal entry: the atomic unit of the double-entry
 * ledger. Every economic event (a transfer, a funding top-up) is exactly one
 * entry whose postings sum to zero per currency.
 *
 * Entries are constructed only through {@link buildJournalEntry}, which enforces
 * the structural and balance invariants, so a `JournalEntry` value is always
 * valid by construction.
 */
export interface JournalEntry {
  readonly id: string;
  /** Domain reason for the entry, e.g. `transfer` or `funding`. */
  readonly type: string;
  readonly occurredAt: Date;
  readonly postings: readonly Posting[];
  readonly correlationId?: string;
  /** Free-form, non-authoritative context (e.g. transfer id, memo). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface JournalEntryInput {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly postings: readonly Posting[];
  readonly correlationId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Sum the signed minor units of `postings` per currency. Exposed for balance
 * checks and tests; an entry balances when every currency maps to `0n`.
 */
export function sumByCurrency(postings: readonly Posting[]): Map<CurrencyCode, bigint> {
  const totals = new Map<CurrencyCode, bigint>();
  for (const posting of postings) {
    const currency = posting.amount.currency;
    totals.set(currency, (totals.get(currency) ?? 0n) + signedMinor(posting));
  }
  return totals;
}

/**
 * Build a validated journal entry.
 *
 * @throws {InvalidJournalEntryError} if there are fewer than two postings or any
 *   posting amount is not strictly positive.
 * @throws {UnbalancedEntryError} if debits do not equal credits for some currency.
 */
export function buildJournalEntry(input: JournalEntryInput): JournalEntry {
  if (input.postings.length < 2) {
    throw new InvalidJournalEntryError('A journal entry requires at least two postings', {
      postingCount: input.postings.length,
    });
  }

  for (const posting of input.postings) {
    if (!posting.amount.isPositive()) {
      throw new InvalidJournalEntryError('Posting amounts must be strictly positive', {
        accountId: posting.accountId,
        amount: posting.amount.toString(),
      });
    }
  }

  for (const [currency, total] of sumByCurrency(input.postings)) {
    if (total !== 0n) {
      throw new UnbalancedEntryError({ currency, imbalanceMinor: total.toString() });
    }
  }

  return {
    id: input.id,
    type: input.type,
    occurredAt: input.occurredAt,
    postings: input.postings,
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  };
}
