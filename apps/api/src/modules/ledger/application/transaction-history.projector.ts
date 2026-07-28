import type { IdGenerator } from '@fides/domain';
import type { DatabaseTx } from '../../../database/db.types';
import { transactionHistory } from '../infra/transaction-history.schema';
import type { LedgerEntryPostedPayload } from './ledger-events';

/**
 * Projects `ledger.entry.posted` events into the `transaction_history` read
 * model, one row per affected account. The insert is idempotent on
 * (account, entry), so replaying an event under at-least-once delivery is safe.
 */
export class TransactionHistoryProjector {
  constructor(private readonly ids: IdGenerator) {}

  async project(tx: DatabaseTx, payload: LedgerEntryPostedPayload): Promise<void> {
    if (payload.accounts.length === 0) return;

    const occurredAt = new Date(payload.occurredAt);
    const rows = payload.accounts.map((account) => ({
      id: this.ids.next(),
      accountId: account.accountId,
      journalEntryId: payload.entryId,
      entryType: payload.entryType,
      amountMinor: BigInt(account.amountMinor),
      balanceAfterMinor: account.balanceAfterMinor,
      currency: account.currency,
      counterpartyAccountIds: payload.accounts
        .filter((other) => other.accountId !== account.accountId)
        .map((other) => other.accountId),
      occurredAt,
    }));

    await tx
      .insert(transactionHistory)
      .values(rows)
      .onConflictDoNothing({
        target: [transactionHistory.accountId, transactionHistory.journalEntryId],
      });
  }
}
