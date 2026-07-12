import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../zod';
import { ErrorResponseSchema } from '../common/error';
import { AccountListResponseSchema, AccountSchema } from './account';

const TAG_ACCOUNTS = 'accounts';
const bearer = [{ bearerAuth: [] }];

function jsonResponse(description: string, schema: z.ZodTypeAny) {
  return { description, content: { 'application/json': { schema } } };
}

function errorResponse(description: string) {
  return jsonResponse(description, ErrorResponseSchema);
}

/**
 * Registers the Slice 4 account read surface (`/v1/accounts`) on an OpenAPI
 * registry. Colocated with the schemas so the served document can never drift
 * from the contracts. Both routes are bearer-authenticated and ownership-scoped.
 */
export function registerAccountPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/v1/accounts',
    summary: 'List the caller’s accounts and wallet balances',
    tags: [TAG_ACCOUNTS],
    security: bearer,
    responses: {
      200: jsonResponse('The caller’s accounts', AccountListResponseSchema),
      401: errorResponse('Not authenticated'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/accounts/{accountId}',
    summary: 'Fetch one of the caller’s accounts',
    description: 'Ownership-scoped: another user’s account id resolves to 403.',
    tags: [TAG_ACCOUNTS],
    security: bearer,
    request: { params: z.object({ accountId: z.string().uuid() }) },
    responses: {
      200: jsonResponse('The account', AccountSchema),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Not the owner of this account'),
      404: errorResponse('Account not found'),
    },
  });
}
