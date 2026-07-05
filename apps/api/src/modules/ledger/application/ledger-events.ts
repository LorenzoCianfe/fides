import type { CurrencyCode } from '@fides/domain';
import type { PostingDirection } from '../domain';

/** Event type emitted when a journal entry is posted. */
export const LEDGER_ENTRY_POSTED = 'ledger.entry.posted';

export interface LedgerEntryPostedAccount {
  readonly accountId: string;
  readonly currency: CurrencyCode;
  /** Signed effect on this account's balance in minor units: + credited, − debited. */
  readonly amountMinor: string;
  /** The account's balance after this entry, in minor units. */
  readonly balanceAfterMinor: string;
}

export interface LedgerEntryPostedPosting {
  readonly accountId: string;
  readonly direction: PostingDirection;
  readonly amount: string;
  readonly currency: CurrencyCode;
}

/**
 * Payload of {@link LEDGER_ENTRY_POSTED}. Carries the per-account effect and
 * resulting balance so downstream projections need not re-read the ledger.
 */
export interface LedgerEntryPostedPayload {
  readonly entryId: string;
  readonly entryType: string;
  /** Business time of the entry (ISO 8601). */
  readonly occurredAt: string;
  readonly accounts: readonly LedgerEntryPostedAccount[];
  readonly postings: readonly LedgerEntryPostedPosting[];
}
