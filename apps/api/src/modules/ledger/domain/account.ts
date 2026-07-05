import type { CurrencyCode } from '@fides/domain';

/**
 * Ledger account taxonomy.
 *
 * Every ledger account has an accounting type that fixes its **normal balance**
 * — the side (debit or credit) on which the account naturally increases. The
 * double-entry rule itself is enforced at the journal-entry level (debits equal
 * credits per currency); an account's running balance is a projection derived
 * from its postings relative to this normal balance.
 */

export const AccountType = {
  Asset: 'asset',
  Liability: 'liability',
  Equity: 'equity',
  Income: 'income',
  Expense: 'expense',
} as const;

export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const PostingDirection = {
  Debit: 'debit',
  Credit: 'credit',
} as const;

export type PostingDirection = (typeof PostingDirection)[keyof typeof PostingDirection];

/**
 * The side on which an account of the given type naturally increases.
 * Assets and expenses are debit-normal; liabilities, equity, and income are
 * credit-normal.
 */
export function normalBalance(type: AccountType): PostingDirection {
  switch (type) {
    case AccountType.Asset:
    case AccountType.Expense:
      return PostingDirection.Debit;
    case AccountType.Liability:
    case AccountType.Equity:
    case AccountType.Income:
      return PostingDirection.Credit;
  }
}

/** The opposite posting direction. */
export function oppositeDirection(direction: PostingDirection): PostingDirection {
  return direction === PostingDirection.Debit ? PostingDirection.Credit : PostingDirection.Debit;
}

/**
 * A ledger account: the unit a balance is derived for. A customer wallet maps
 * to a liability account; platform-owned accounts (settlement, fees, suspense)
 * are marked `system`.
 */
export interface LedgerAccount {
  readonly id: string;
  readonly type: AccountType;
  readonly currency: CurrencyCode;
  /** Stable machine code, e.g. `wallet:<walletId>` or `system:settlement`. */
  readonly code: string;
  /** True for platform-owned system accounts, false for customer accounts. */
  readonly system: boolean;
}
