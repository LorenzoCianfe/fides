import { BASE_CURRENCY, NotFoundError, type CurrencyCode } from '@fides/domain';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { assertResourceOwnership } from '../../identity/application/authorization';
import type { Principal } from '../../identity/application/session.service';
import { users } from '../../identity/infra/identity.schema';
import { accounts, wallets } from '../infra/accounts.schema';

/** A wallet resolved to the backing ledger account and its owner. */
export interface ResolvedWallet {
  readonly walletId: string;
  readonly accountId: string;
  /** The backing double-entry ledger account (`wallet:<walletId>`, liability). */
  readonly ledgerAccountId: string;
  readonly currency: CurrencyCode;
  readonly ownerUserId: string;
}

/**
 * Internal resolution from users/wallets to the backing `ledger_account_id` the
 * money path debits and credits, and the ownership checks the read surface
 * needs. Kept in the accounts module because it owns the account/wallet tables;
 * the payments module depends on it rather than reaching into wallets directly.
 * The `ledger_account_id` is never exposed on the wire.
 */
export class WalletResolver {
  constructor(private readonly db: Database) {}

  /** The caller's own primary (EUR) wallet. 404 if not provisioned yet. */
  async resolvePrimaryWallet(userId: string): Promise<ResolvedWallet> {
    const [row] = await this.db
      .select({
        walletId: wallets.id,
        accountId: wallets.accountId,
        ledgerAccountId: wallets.ledgerAccountId,
        currency: wallets.currency,
        ownerUserId: accounts.userId,
      })
      .from(wallets)
      .innerJoin(accounts, eq(accounts.id, wallets.accountId))
      .where(and(eq(accounts.userId, userId), eq(wallets.currency, BASE_CURRENCY)))
      .limit(1);
    if (!row) throw new NotFoundError('No wallet for the caller', { userId });
    return toResolved(row);
  }

  /**
   * The recipient's primary (EUR) wallet, resolved by email. A 404 for an
   * unknown recipient is a deliberate, minor existence oracle (ADR-0023),
   * mitigated by SCA and throttling on the transfer route.
   */
  async resolveRecipientByEmail(email: string): Promise<ResolvedWallet> {
    const normalized = email.trim().toLowerCase();
    const [row] = await this.db
      .select({
        walletId: wallets.id,
        accountId: wallets.accountId,
        ledgerAccountId: wallets.ledgerAccountId,
        currency: wallets.currency,
        ownerUserId: accounts.userId,
      })
      .from(wallets)
      .innerJoin(accounts, eq(accounts.id, wallets.accountId))
      .innerJoin(users, eq(users.id, accounts.userId))
      .where(and(eq(users.email, normalized), eq(wallets.currency, BASE_CURRENCY)))
      .limit(1);
    if (!row) throw new NotFoundError('Recipient not found', { recipient: normalized });
    return toResolved(row);
  }

  /**
   * A wallet by id, ownership-checked for the read surface. Unknown id → 404;
   * another user's wallet → 403 (consistent with the accounts read surface).
   */
  async resolveOwnedWallet(principal: Principal, walletId: string): Promise<ResolvedWallet> {
    const [row] = await this.db
      .select({
        walletId: wallets.id,
        accountId: wallets.accountId,
        ledgerAccountId: wallets.ledgerAccountId,
        currency: wallets.currency,
        ownerUserId: accounts.userId,
      })
      .from(wallets)
      .innerJoin(accounts, eq(accounts.id, wallets.accountId))
      .where(eq(wallets.id, walletId))
      .limit(1);
    if (!row) throw new NotFoundError('Wallet not found', { walletId });
    assertResourceOwnership(principal, row.ownerUserId, { walletId });
    return toResolved(row);
  }
}

function toResolved(row: {
  walletId: string;
  accountId: string;
  ledgerAccountId: string;
  currency: string;
  ownerUserId: string;
}): ResolvedWallet {
  return {
    walletId: row.walletId,
    accountId: row.accountId,
    ledgerAccountId: row.ledgerAccountId,
    currency: row.currency as CurrencyCode,
    ownerUserId: row.ownerUserId,
  };
}
