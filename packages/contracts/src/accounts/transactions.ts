import { z } from '../zod';
import { MoneySchema } from '../common/money';
import { pageOf } from '../common/pagination';

/**
 * One entry in a wallet's transaction history, projected asynchronously from the
 * ledger (`transaction_history`, ADR-0019). `amount` is the signed effect on this
 * wallet's balance — negative when debited, positive when credited.
 */
export const TransactionItemSchema = z
  .object({
    id: z.string().uuid().openapi({ description: 'The journal entry id' }),
    type: z.string().openapi({ example: 'transfer' }),
    amount: MoneySchema,
    balanceAfter: MoneySchema,
    occurredAt: z.string().datetime(),
  })
  .openapi('TransactionItem');

export type TransactionItemDto = z.infer<typeof TransactionItemSchema>;

/** A cursor-paginated page of a wallet's transaction history. */
export const WalletTransactionsPageSchema =
  pageOf(TransactionItemSchema).openapi('WalletTransactionsPage');

export type WalletTransactionsPageDto = z.infer<typeof WalletTransactionsPageSchema>;

/** Path params for the wallet transaction-history read. */
export const WalletIdParamsSchema = z.object({ walletId: z.string().uuid() });

export type WalletIdParamsDto = z.infer<typeof WalletIdParamsSchema>;
