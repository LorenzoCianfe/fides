import { z } from '../zod';
import { CurrencyCodeSchema, MoneySchema } from '../common/money';
import { pageOf } from '../common/pagination';

/** One row of the back-office customer directory. */
export const AdminCustomerSummarySchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    status: z.enum(['onboarding', 'active', 'suspended']),
    emailVerified: z.boolean(),
    kycStatus: z.enum(['pending', 'approved', 'rejected', 'review']).nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('AdminCustomerSummary');

export type AdminCustomerSummaryDto = z.infer<typeof AdminCustomerSummarySchema>;

export const AdminCustomerPageSchema = pageOf(AdminCustomerSummarySchema).openapi(
  'AdminCustomerPage',
);

export type AdminCustomerPageDto = z.infer<typeof AdminCustomerPageSchema>;

/**
 * A wallet as the back office sees it. Unlike the customer-facing `Wallet` this
 * exposes the backing `ledgerAccountId`, which is what makes the ledger view
 * reachable from a customer.
 */
export const AdminWalletSchema = z
  .object({
    id: z.string().uuid(),
    currency: CurrencyCodeSchema,
    balance: MoneySchema,
    ledgerAccountId: z.string().uuid(),
  })
  .openapi('AdminWallet');

export type AdminWalletDto = z.infer<typeof AdminWalletSchema>;

export const AdminAccountSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(['active', 'suspended', 'closed']),
    createdAt: z.string().datetime(),
    wallets: z.array(AdminWalletSchema),
  })
  .openapi('AdminAccount');

export type AdminAccountDto = z.infer<typeof AdminAccountSchema>;

/** A customer with their KYC decision, accounts, wallets, and live balances. */
export const AdminCustomerDetailSchema = AdminCustomerSummarySchema.extend({
  givenName: z.string(),
  familyName: z.string(),
  country: z.string().length(2),
  kycReference: z.string().nullable(),
  kycDecidedAt: z.string().datetime().nullable(),
  accounts: z.array(AdminAccountSchema),
}).openapi('AdminCustomerDetail');

export type AdminCustomerDetailDto = z.infer<typeof AdminCustomerDetailSchema>;

/** Query for the customer directory: cursor pagination plus an exact-email lookup. */
export const AdminCustomerQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
    email: z.string().email().optional(),
  })
  .openapi('AdminCustomerQuery');

export type AdminCustomerQueryDto = z.infer<typeof AdminCustomerQuerySchema>;

export const AdminUserIdParamsSchema = z.object({ userId: z.string().uuid() });

export type AdminUserIdParamsDto = z.infer<typeof AdminUserIdParamsSchema>;

/**
 * A ledger account beside its reconciliation state: the maintained projection
 * (ADR-0019) against the same figure recomputed from the raw postings.
 */
export const AdminLedgerAccountSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string().openapi({ example: 'wallet:018f…' }),
    type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
    currency: CurrencyCodeSchema,
    system: z.boolean(),
    projectedBalance: MoneySchema,
    computedBalance: MoneySchema,
    reconciled: z
      .boolean()
      .openapi({ description: 'False if the projection has drifted from the postings' }),
  })
  .openapi('AdminLedgerAccount');

export type AdminLedgerAccountDto = z.infer<typeof AdminLedgerAccountSchema>;

export const AdminLedgerAccountParamsSchema = z.object({ ledgerAccountId: z.string().uuid() });

export type AdminLedgerAccountParamsDto = z.infer<typeof AdminLedgerAccountParamsSchema>;
