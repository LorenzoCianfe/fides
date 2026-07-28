import type { CurrencyCode, Money } from '@fides/domain';

/**
 * Accounts domain view types.
 *
 * The accounts module owns account and wallet structure; it never owns money.
 * A wallet's balance is read from the ledger `balances` projection (ADR-0019),
 * which is the single source of truth — no balance is stored here.
 */

/** Account lifecycle. Phase 1 provisions `active`; transitions arrive later. */
export const AccountStatus = {
  Active: 'active',
  Suspended: 'suspended',
  Closed: 'closed',
} as const;

export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

/** A currency-specific balance holder, backed by a ledger account. */
export interface Wallet {
  readonly id: string;
  readonly currency: CurrencyCode;
  /** Authoritative balance, read from the ledger projection (ADR-0019). */
  readonly balance: Money;
}

/** A customer account with its wallets (Phase 1: exactly one EUR wallet). */
export interface Account {
  readonly id: string;
  readonly status: AccountStatus;
  readonly createdAt: Date;
  readonly wallets: readonly Wallet[];
}
