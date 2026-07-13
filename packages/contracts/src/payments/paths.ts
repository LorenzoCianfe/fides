import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../zod';
import { ErrorResponseSchema } from '../common/error';
import { DevFundingRequestSchema, DevFundingResponseSchema } from './funding';
import { TransferRequestSchema, TransferResponseSchema } from './transfer';

const TAG_PAYMENTS = 'payments';
const bearer = [{ bearerAuth: [] }];

function jsonBody(schema: z.ZodTypeAny) {
  return { content: { 'application/json': { schema } }, required: true };
}

function jsonResponse(description: string, schema: z.ZodTypeAny) {
  return { description, content: { 'application/json': { schema } } };
}

function errorResponse(description: string) {
  return jsonResponse(description, ErrorResponseSchema);
}

/** Required idempotency key on money-moving POSTs (documentation.md §6). */
const idempotencyHeader = z.object({
  'Idempotency-Key': z.string().min(1).max(255).openapi({
    description: 'Client-generated key; a retry with the same key replays the original result.',
  }),
});

/**
 * Registers the Slice 5 payments surface (`/v1/transfers`, `/v1/dev/funding`,
 * ADR-0023) on an OpenAPI registry. Colocated with the schemas so the served
 * document can never drift. Both routes are bearer-authenticated and idempotent;
 * the transfer additionally requires a single-use SCA grant (dynamic linking).
 */
export function registerPaymentPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/v1/transfers',
    summary: 'Make an internal instant P2P transfer',
    description:
      'SCA-gated (PSD2 dynamic linking): the action hash is recomputed from the transfer payload and the single-use grant is consumed inside the posting transaction. Idempotent on the Idempotency-Key header.',
    tags: [TAG_PAYMENTS],
    security: bearer,
    request: { headers: idempotencyHeader, body: jsonBody(TransferRequestSchema) },
    responses: {
      201: jsonResponse('Transfer posted', TransferResponseSchema),
      400: errorResponse('Validation failed or missing Idempotency-Key'),
      401: errorResponse('Not authenticated, or step-up authentication required'),
      404: errorResponse('Recipient not found'),
      409: errorResponse('Idempotency key reused with a different request'),
      422: errorResponse('Insufficient funds'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/dev/funding',
    summary: 'Fund the caller’s own wallet from settlement (dev only)',
    description:
      'Self-service faucet, kill-switched via DEV_FUNDING_ENABLED and amount-capped. A development affordance until admin RBAC (Slice 7). No SCA.',
    tags: [TAG_PAYMENTS],
    security: bearer,
    request: { headers: idempotencyHeader, body: jsonBody(DevFundingRequestSchema) },
    responses: {
      201: jsonResponse('Wallet funded', DevFundingResponseSchema),
      400: errorResponse('Validation failed or missing Idempotency-Key'),
      401: errorResponse('Not authenticated'),
      404: errorResponse('Funding disabled, or no wallet for the caller'),
      409: errorResponse('Idempotency key reused with a different request'),
      429: errorResponse('Rate limited'),
    },
  });
}
