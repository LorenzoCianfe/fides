import { z } from '../zod';
import { CurrencyCodeSchema, MoneySchema } from '../common/money';

/** Account lifecycle state. Phase 1 provisions `active`; transitions arrive later. */
export const AccountStatusSchema = z
  .enum(['active', 'suspended', 'closed'])
  .openapi('AccountStatus', { description: 'Account lifecycle state', example: 'active' });

export type AccountStatusDto = z.infer<typeof AccountStatusSchema>;

/**
 * A currency-specific balance holder within an account. The balance is read from
 * the authoritative ledger projection (ADR-0019), never stored on the wallet.
 */
export const WalletSchema = z
  .object({
    id: z.string().uuid(),
    currency: CurrencyCodeSchema,
    balance: MoneySchema,
  })
  .openapi('Wallet');

export type WalletDto = z.infer<typeof WalletSchema>;

/** A customer account with its wallets (Phase 1: exactly one EUR wallet). */
export const AccountSchema = z
  .object({
    id: z.string().uuid(),
    status: AccountStatusSchema,
    createdAt: z.string().datetime(),
    wallets: z.array(WalletSchema),
  })
  .openapi('Account');

export type AccountDto = z.infer<typeof AccountSchema>;

export const AccountListResponseSchema = z
  .object({ accounts: z.array(AccountSchema) })
  .openapi('AccountList');

export type AccountListResponseDto = z.infer<typeof AccountListResponseSchema>;

/** Path params for the single-account read. */
export const AccountIdParamsSchema = z.object({ accountId: z.string().uuid() });

export type AccountIdParamsDto = z.infer<typeof AccountIdParamsSchema>;
