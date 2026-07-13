import { z } from '../zod';
import { EmailSchema } from '../auth/primitives';
import type { ScaActionDto } from '../auth/sca';
import { MoneySchema } from '../common/money';

/** Discriminator for the P2P transfer SCA action (PSD2 dynamic linking, ADR-0021/0023). */
export const TRANSFER_SCA_ACTION_TYPE = 'p2p_transfer';

/**
 * Build the canonical SCA action for a P2P transfer. Shared by the client (which
 * signs it during step-up over /v1/auth/sca/options) and the server (which
 * recomputes and hashes it inside the posting transaction), so the dynamically
 * linked amount and payee are byte-identical on both sides: a tampered field
 * changes the action hash and grant consumption fails with the generic auth
 * error. `amount` is integer minor units as a string (matching {@link MoneySchema});
 * `recipient` is the normalized (trimmed, lower-cased) recipient email.
 */
export function buildTransferScaAction(params: {
  readonly recipient: string;
  readonly amount: string;
  readonly currency: string;
}): ScaActionDto {
  return {
    type: TRANSFER_SCA_ACTION_TYPE,
    payload: {
      recipient: params.recipient,
      amount: params.amount,
      currency: params.currency,
    },
  };
}

/**
 * Internal instant P2P transfer request. The single-use step-up `grant` (fsg_…)
 * is obtained beforehand from /v1/auth/sca/verify over the same
 * {@link buildTransferScaAction} payload. The idempotency key travels in the
 * `Idempotency-Key` header, not the body.
 */
export const TransferRequestSchema = z
  .object({
    recipient: EmailSchema,
    amount: MoneySchema,
    grant: z
      .string()
      .min(1)
      .openapi({ description: 'Single-use SCA grant (fsg_…) from /v1/auth/sca/verify' }),
  })
  .openapi('TransferRequest');

export type TransferRequestDto = z.infer<typeof TransferRequestSchema>;

export const TransferResponseSchema = z
  .object({
    transferId: z.string().uuid().openapi({ description: 'The posted journal entry id' }),
    amount: MoneySchema,
    senderBalance: MoneySchema,
    occurredAt: z.string().datetime(),
  })
  .openapi('TransferResponse');

export type TransferResponseDto = z.infer<typeof TransferResponseSchema>;
