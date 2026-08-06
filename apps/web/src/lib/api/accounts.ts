import type {
  AccountListResponseDto,
  CurrencyCodeDto,
  TransferRequestDto,
  TransferResponseDto,
  WalletTransactionsPageDto,
} from '@fides/contracts';
// Runtime import on purpose: the canonical SCA action must be byte-identical to
// the one the server recomputes inside the posting transaction. Rebuilding it
// here by hand is exactly the drift PSD2 dynamic linking exists to prevent
// (ADR-0023), so the shared builder is worth its weight in the bundle.
import { buildTransferScaAction } from '@fides/contracts';
import { stepUp } from './auth';
import { apiFetch, newIdempotencyKey } from './client';

export function listAccounts(signal?: AbortSignal): Promise<AccountListResponseDto> {
  return apiFetch<AccountListResponseDto>('/v1/accounts', { signal });
}

export function listTransactions(
  walletId: string,
  options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<WalletTransactionsPageDto> {
  const query = new URLSearchParams();
  if (options.limit) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';

  return apiFetch<WalletTransactionsPageDto>(`/v1/wallets/${walletId}/transactions${suffix}`, {
    signal: options.signal,
  });
}

export interface SendMoneyInput {
  recipient: string;
  /** Integer minor units as a string, matching the wire contract. */
  amountMinor: string;
  currency: CurrencyCodeDto;
  /** Reused across retries so a retry replays rather than pays twice. */
  idempotencyKey?: string;
}

/**
 * Send money: step up, then post the transfer with the resulting single-use
 * grant. The recipient is normalized before building the action because the
 * server normalizes it too, and the two must hash identically.
 */
export async function sendMoney(input: SendMoneyInput): Promise<TransferResponseDto> {
  const recipient = input.recipient.trim().toLowerCase();
  const grant = await stepUp(
    buildTransferScaAction({
      recipient,
      amount: input.amountMinor,
      currency: input.currency,
    }),
  );

  const body: TransferRequestDto = {
    recipient,
    amount: { amount: input.amountMinor, currency: input.currency },
    grant,
  };

  return apiFetch<TransferResponseDto>('/v1/transfers', {
    method: 'POST',
    body,
    idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
  });
}
