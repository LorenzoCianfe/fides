import type { AccountDto, WalletDto } from '@fides/contracts';
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
