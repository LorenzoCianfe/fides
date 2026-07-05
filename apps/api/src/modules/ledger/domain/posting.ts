import type { Money } from '@fides/domain';
import { normalBalance, PostingDirection, type AccountType } from './account';

/**
 * A single debit or credit line within a balanced {@link JournalEntry}.
 *
 * The `amount` is always strictly positive; the `direction` carries the sign.
 * Representing amounts as positive Money plus an explicit direction keeps the
 * postings table faithful to accounting convention while the balance invariant
 * (see {@link signedMinor}) stays trivial to check.
 */
export interface Posting {
  readonly accountId: string;
  readonly direction: PostingDirection;
  readonly amount: Money;
}

/**
 * Signed minor-unit value used for the balance invariant: debits count
 * positive, credits negative. A journal entry balances when these sum to zero
 * for every currency.
 */
export function signedMinor(posting: Posting): bigint {
  return posting.direction === PostingDirection.Debit
    ? posting.amount.amount
    : -posting.amount.amount;
}

/**
 * The effect a posting has on the balance of an account of `accountType`:
 * positive when the posting moves the account in its normal direction,
 * negative when it moves against it. This is how a wallet (liability, credit-
 * normal) is credited to increase and debited to decrease.
 */
export function balanceEffectMinor(posting: Posting, accountType: AccountType): bigint {
  const sign = posting.direction === normalBalance(accountType) ? 1n : -1n;
  return sign * posting.amount.amount;
}
