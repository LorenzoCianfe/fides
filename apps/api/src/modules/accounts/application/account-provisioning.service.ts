import { BASE_CURRENCY, type IdGenerator } from '@fides/domain';
import type { DatabaseTx } from '../../../database/db.types';
import type { KycApprovedPayload } from '../../kyc/application/kyc-events';
import { LedgerStore } from '../../ledger/infra/ledger.repository';
import { accounts, wallets } from '../infra/accounts.schema';

/**
 * Provisions a customer's account on KYC approval: one EUR account, a single
 * EUR wallet, and the wallet's backing ledger account (`wallet:<walletId>`,
 * liability) via {@link LedgerStore.createAccount}.
 *
 * Runs as the `kyc.approved` outbox handler, inside the dispatcher's
 * transaction, so every write — including the wallet's ledger account — commits
 * atomically with the row being marked dispatched. Idempotent under
 * at-least-once delivery: the account row is inserted first with
 * `ON CONFLICT (user_id) DO NOTHING`, so a redelivery (or a concurrent claim)
 * short-circuits before any ledger account is created, leaving no orphans.
 */
export class AccountProvisioningService {
  constructor(
    private readonly ledger: LedgerStore,
    private readonly ids: IdGenerator,
  ) {}

  async provisionForApprovedKyc(tx: DatabaseTx, payload: KycApprovedPayload): Promise<void> {
    const accountId = this.ids.next();
    const walletId = this.ids.next();

    const inserted = await tx
      .insert(accounts)
      .values({ id: accountId, userId: payload.userId, status: 'active' })
      .onConflictDoNothing({ target: accounts.userId })
      .returning({ id: accounts.id });

    // Already provisioned (redelivery or concurrent claim): nothing to do. The
    // wallet and ledger account were created by the delivery that won the insert.
    if (inserted.length === 0) return;

    const ledgerAccount = await this.ledger.createAccount(
      {
        type: 'liability',
        currency: BASE_CURRENCY,
        code: `wallet:${walletId}`,
        system: false,
      },
      tx,
    );

    await tx.insert(wallets).values({
      id: walletId,
      accountId,
      currency: BASE_CURRENCY,
      ledgerAccountId: ledgerAccount.id,
    });
  }
}
