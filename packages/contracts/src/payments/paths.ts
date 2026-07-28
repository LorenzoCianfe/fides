import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../zod';
import { ErrorResponseSchema } from '../common/error';
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
 * Registers the payments surface (`/v1/transfers`, ADR-0023) on an OpenAPI
 * registry. Colocated with the schemas so the served document can never drift.
 * The route is bearer-authenticated, idempotent, and requires a single-use SCA
 * grant (dynamic linking).
 *
 * The Slice 5 dev funding faucet that lived beside it was retired in Slice 7,
 * replaced by the admin-only four-eyes funding operation (ADR-0025).
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
}
