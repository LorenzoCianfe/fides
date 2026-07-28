import type {
  AccountDto,
  TransactionItemDto,
  WalletDto,
  WalletTransactionsPageDto,
} from '@fides/contracts';
import type {
  TransactionHistoryEntry,
  TransactionHistoryPage,
} from '../../ledger/application/transaction-history.reader';
import type { Account, Wallet } from '../domain';

/** Serialize an account domain view onto the wire contract. */
export function toAccountDto(account: Account): AccountDto {
  return {
    id: account.id,
    status: account.status,
    createdAt: account.createdAt.toISOString(),
    wallets: account.wallets.map(toWalletDto),
  };
}

function toWalletDto(wallet: Wallet): WalletDto {
  return {
    id: wallet.id,
    currency: wallet.currency,
    // Money.toJSON() yields the MoneyDto shape: integer minor units as a string.
    balance: wallet.balance.toJSON(),
  };
}

/** Serialize a wallet's transaction-history page onto the wire contract. */
export function toWalletTransactionsPageDto(
  page: TransactionHistoryPage,
): WalletTransactionsPageDto {
  return {
    items: page.items.map(toTransactionItemDto),
    nextCursor: page.nextCursor,
  };
}

function toTransactionItemDto(entry: TransactionHistoryEntry): TransactionItemDto {
  return {
    id: entry.id,
    type: entry.type,
    amount: entry.amount.toJSON(),
    balanceAfter: entry.balanceAfter.toJSON(),
    occurredAt: entry.occurredAt.toISOString(),
  };
}
