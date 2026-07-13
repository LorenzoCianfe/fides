import { z } from '../zod';
import { MoneySchema } from '../common/money';

/**
 * Dev/admin funding request: a self-service faucet that credits the caller's own
 * wallet from `system:settlement`. Kill-switched (`DEV_FUNDING_ENABLED`) and
 * amount-capped; a development affordance until admin RBAC lands in Slice 7 (see
 * security.md and ADR-0023). No SCA — crediting your own wallet is not a PSD2
 * payment. The idempotency key travels in the `Idempotency-Key` header.
 */
export const DevFundingRequestSchema = z
  .object({ amount: MoneySchema })
  .openapi('DevFundingRequest');

export type DevFundingRequestDto = z.infer<typeof DevFundingRequestSchema>;

export const DevFundingResponseSchema = z
  .object({
    fundingId: z.string().uuid().openapi({ description: 'The posted journal entry id' }),
    amount: MoneySchema,
    balance: MoneySchema,
    occurredAt: z.string().datetime(),
  })
  .openapi('DevFundingResponse');

export type DevFundingResponseDto = z.infer<typeof DevFundingResponseSchema>;
