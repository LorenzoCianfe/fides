import { NotFoundError, type CurrencyCode } from '@fides/domain';
import { eq } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { assertResourceOwnership } from '../../identity/application/authorization';
import type { Principal } from '../../identity/application/session.service';
import { LedgerStore } from '../../ledger/infra/ledger.repository';
import type { Account, AccountStatus, Wallet } from '../domain';
import { accounts, wallets, type AccountRow, type WalletRow } from '../infra/accounts.schema';

/**
 * Account read side (Slice 4). Returns account/wallet structure with each
 * wallet's live balance read from the authoritative ledger projection
 * (ADR-0019). Object-level authorization is enforced server-side: the list is
 * scoped to the principal, and the single read asserts ownership.
 */
export class AccountService {
  constructor(
    private readonly db: Database,
    private readonly ledger: LedgerStore,
  ) {}

  /** The caller's accounts, each hydrated with its wallets and balances. */
  async listAccounts(userId: string): Promise<Account[]> {
    const rows = await this.db.select().from(accounts).where(eq(accounts.userId, userId));
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  /**
   * One account by id, ownership-checked. A non-existent account is a 404; an
   * account owned by another user is a 403 (security.md §3.1).
   */
  async getAccount(principal: Principal, accountId: string): Promise<Account> {
    const [row] = await this.db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
    if (!row) throw new NotFoundError('Account not found', { accountId });
    assertResourceOwnership(principal, row.userId, { accountId });
    return this.hydrate(row);
  }

  private async hydrate(account: AccountRow): Promise<Account> {
    const walletRows = await this.db
      .select()
      .from(wallets)
      .where(eq(wallets.accountId, account.id));
    const hydrated = await Promise.all(walletRows.map((wallet) => this.toWallet(wallet)));
    return {
      id: account.id,
      status: account.status as AccountStatus,
      createdAt: account.createdAt,
      wallets: hydrated,
    };
  }

  private async toWallet(wallet: WalletRow): Promise<Wallet> {
    const balance = await this.ledger.getBalance(wallet.ledgerAccountId);
    return { id: wallet.id, currency: wallet.currency as CurrencyCode, balance };
  }
}
