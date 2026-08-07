import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../zod';
import { WalletTransactionsPageSchema } from '../accounts/transactions';
import { ErrorResponseSchema } from '../common/error';
import { PaginationQuerySchema } from '../common/pagination';
import {
  AdminCreateRequestSchema,
  AdminListResponseSchema,
  AdminLoginRequestSchema,
  AdminLoginResponseSchema,
  AdminMfaEnrolRequestSchema,
  AdminMfaEnrolResponseSchema,
  AdminMfaVerifyRequestSchema,
  AdminPasswordChangeRequestSchema,
  AdminPasswordChangeResponseSchema,
  AdminProfileSchema,
  AdminSessionResponseSchema,
  AdminStatusRequestSchema,
  AdminSummarySchema,
} from './auth';
import { AuditPageSchema, AuditQuerySchema, AuditVerificationSchema } from './audit';
import {
  AdminCustomerDetailSchema,
  AdminCustomerPageSchema,
  AdminCustomerQuerySchema,
  AdminLedgerAccountSchema,
} from './directory';
import {
  AdminFundingApprovalResponseSchema,
  AdminFundingRequestSchema,
  AdminTotpResetApprovalResponseSchema,
  AdminTotpResetRequestSchema,
  PendingActionDecisionSchema,
  PendingActionPageSchema,
  PendingActionQuerySchema,
  PendingActionSchema,
} from './four-eyes';

const TAG_ADMIN_AUTH = 'admin-auth';
const TAG_ADMIN_STAFF = 'admin-staff';
const TAG_ADMIN_DIRECTORY = 'admin-directory';
const TAG_ADMIN_AUDIT = 'admin-audit';
const TAG_ADMIN_FOUR_EYES = 'admin-four-eyes';

/** Admin routes carry their own opaque token (`ast_…`) on the same bearer scheme. */
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
 * Registers the Slice 7 back-office surface (`/v1/admin/*`, ADR-0025) on an
 * OpenAPI registry. Colocated with the schemas so the served document can never
 * drift.
 *
 * Every route except the two login steps requires an admin session token, and
 * every authenticated route additionally requires a permission from the role
 * matrix — a role without it receives 403, which is why 403 appears on reads
 * that have no ownership dimension at all.
 */
export function registerAdminPaths(registry: OpenAPIRegistry): void {
  // --- Authentication -------------------------------------------------------
  registry.registerPath({
    method: 'post',
    path: '/v1/admin/auth/login',
    summary: 'Verify the admin password (first factor)',
    description:
      'Returns a single-use, short-lived challenge token — never a session. Failures are uniform across unknown, disabled, and wrong-password admins.',
    tags: [TAG_ADMIN_AUTH],
    request: { body: jsonBody(AdminLoginRequestSchema) },
    responses: {
      200: jsonResponse('Password accepted; complete the second factor', AdminLoginResponseSchema),
      400: errorResponse('Validation failed'),
      401: errorResponse('Invalid credentials'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/admin/auth/mfa/enrol',
    summary: 'Issue a TOTP secret for an admin with no second factor',
    description:
      'Exchangeable once per login challenge, and only while the admin is unenrolled. The secret is returned exactly once and is activated by the first successful verification.',
    tags: [TAG_ADMIN_AUTH],
    request: { body: jsonBody(AdminMfaEnrolRequestSchema) },
    responses: {
      200: jsonResponse('Enrolment secret and provisioning URI', AdminMfaEnrolResponseSchema),
      400: errorResponse('Already enrolled, or a secret was already issued for this login'),
      401: errorResponse('Invalid or expired login challenge'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/admin/auth/mfa/verify',
    summary: 'Verify the TOTP code (second factor) and issue the session',
    description:
      'Consumes the challenge, activates a pending enrolment on first success, and issues the back-office session. A code cannot be replayed, even inside its own validity window.',
    tags: [TAG_ADMIN_AUTH],
    request: { body: jsonBody(AdminMfaVerifyRequestSchema) },
    responses: {
      201: jsonResponse('Session issued', AdminSessionResponseSchema),
      400: errorResponse('Validation failed'),
      401: errorResponse('Invalid challenge or verification code'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/admin/auth/logout',
    summary: 'Revoke the current admin session',
    tags: [TAG_ADMIN_AUTH],
    security: bearer,
    responses: {
      204: { description: 'Session revoked' },
      401: errorResponse('Not authenticated'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/admin/me',
    summary: 'The authenticated admin and their effective permissions',
    tags: [TAG_ADMIN_AUTH],
    security: bearer,
    responses: {
      200: jsonResponse('The admin profile', AdminProfileSchema),
      401: errorResponse('Not authenticated'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/admin/me/password',
    summary: 'Rotate your own password',
    description:
      'Re-proves both factors — the current password and a fresh TOTP code — and revokes every other session the admin holds, keeping the calling one. Available to any authenticated admin; no permission gates rotating your own credential.',
    tags: [TAG_ADMIN_AUTH],
    security: bearer,
    request: { body: jsonBody(AdminPasswordChangeRequestSchema) },
    responses: {
      200: jsonResponse('Password changed', AdminPasswordChangeResponseSchema),
      400: errorResponse('Too short, or unchanged from the current password'),
      401: errorResponse('Wrong current password or verification code'),
      429: errorResponse('Rate limited'),
    },
  });

  // --- Back-office staffing -------------------------------------------------
  registry.registerPath({
    method: 'post',
    path: '/v1/admin/admins',
    summary: 'Create a back-office operator',
    description:
      'Requires admins.manage (super_admin only). The new admin starts with a password and no second factor, and enrols TOTP at first login. This is what allows a maker to exist alongside the checker, making four-eyes operable.',
    tags: [TAG_ADMIN_STAFF],
    security: bearer,
    request: { body: jsonBody(AdminCreateRequestSchema) },
    responses: {
      201: jsonResponse('Admin created', AdminSummarySchema),
      400: errorResponse('Validation failed'),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks admins.manage'),
      409: errorResponse('An admin with that email already exists'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/admin/admins',
    summary: 'List back-office operators',
    tags: [TAG_ADMIN_STAFF],
    security: bearer,
    responses: {
      200: jsonResponse('The roster', AdminListResponseSchema),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks admins.manage'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/admin/admins/{adminId}/status',
    summary: 'Disable or re-enable a back-office operator',
    description:
      'Disabling takes effect immediately: the admin’s live sessions are rejected on their next request. An admin cannot disable their own account.',
    tags: [TAG_ADMIN_STAFF],
    security: bearer,
    request: {
      params: z.object({ adminId: z.string().uuid() }),
      body: jsonBody(AdminStatusRequestSchema),
    },
    responses: {
      200: jsonResponse('Updated', AdminSummarySchema),
      400: errorResponse('Validation failed, or the caller targeted their own account'),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks admins.manage'),
      404: errorResponse('Admin not found'),
    },
  });

  // --- Read-only views ------------------------------------------------------
  registry.registerPath({
    method: 'get',
    path: '/v1/admin/customers',
    summary: 'List customers',
    description: 'Cursor-paginated, newest first. Requires the customers.read permission.',
    tags: [TAG_ADMIN_DIRECTORY],
    security: bearer,
    request: { query: AdminCustomerQuerySchema },
    responses: {
      200: jsonResponse('A page of customers', AdminCustomerPageSchema),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks customers.read'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/admin/customers/{userId}',
    summary: 'Fetch one customer with accounts, wallets, and balances',
    tags: [TAG_ADMIN_DIRECTORY],
    security: bearer,
    request: { params: z.object({ userId: z.string().uuid() }) },
    responses: {
      200: jsonResponse('The customer', AdminCustomerDetailSchema),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks customers.read'),
      404: errorResponse('Customer not found'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/admin/wallets/{walletId}/transactions',
    summary: 'List any wallet’s transaction history',
    description:
      'The customer history read, authorized by capability instead of ownership. Requires wallets.read.',
    tags: [TAG_ADMIN_DIRECTORY],
    security: bearer,
    request: {
      params: z.object({ walletId: z.string().uuid() }),
      query: PaginationQuerySchema,
    },
    responses: {
      200: jsonResponse('A page of transactions, newest first', WalletTransactionsPageSchema),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks wallets.read'),
      404: errorResponse('Wallet not found'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/admin/ledger/accounts/{ledgerAccountId}',
    summary: 'Fetch a ledger account with its reconciliation state',
    description:
      'Returns the maintained balance projection beside the same figure recomputed from the postings, so the ADR-0019 invariant is observable in production. Requires ledger.read.',
    tags: [TAG_ADMIN_DIRECTORY],
    security: bearer,
    request: { params: z.object({ ledgerAccountId: z.string().uuid() }) },
    responses: {
      200: jsonResponse('The ledger account', AdminLedgerAccountSchema),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks ledger.read'),
      404: errorResponse('Ledger account not found'),
    },
  });

  // --- Audit trail (the surface deferred from Slice 6) ----------------------
  registry.registerPath({
    method: 'get',
    path: '/v1/admin/audit',
    summary: 'Read the append-only audit trail',
    description:
      'Cursor-paginated over the gap-free sequence, newest first. Requires audit.read (auditor or higher).',
    tags: [TAG_ADMIN_AUDIT],
    security: bearer,
    request: { query: AuditQuerySchema },
    responses: {
      200: jsonResponse('A page of audit records', AuditPageSchema),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks audit.read'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/admin/audit/verify',
    summary: 'Verify the audit hash chain',
    description:
      'Walks the whole chain from genesis, recomputing every hash and link, and reports the first break. Requires audit.read.',
    tags: [TAG_ADMIN_AUDIT],
    security: bearer,
    responses: {
      200: jsonResponse('Verification outcome', AuditVerificationSchema),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks audit.read'),
    },
  });

  // --- Four-eyes admin funding ---------------------------------------------
  registry.registerPath({
    method: 'post',
    path: '/v1/admin/funding-requests',
    summary: 'Request an admin funding credit (maker)',
    description:
      'Files a request; no money moves. Requires admin_funding.request, which super_admin deliberately does not hold — no role may both initiate and approve (ADR-0011).',
    tags: [TAG_ADMIN_FOUR_EYES],
    security: bearer,
    request: { body: jsonBody(AdminFundingRequestSchema) },
    responses: {
      201: jsonResponse('Request filed and awaiting a checker', PendingActionSchema),
      400: errorResponse('Validation failed, or the amount exceeds the permitted maximum'),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks admin_funding.request'),
      404: errorResponse('Customer has no wallet yet'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/admin/pending-actions',
    summary: 'List the four-eyes queue',
    tags: [TAG_ADMIN_FOUR_EYES],
    security: bearer,
    request: { query: PendingActionQuerySchema },
    responses: {
      200: jsonResponse('A page of pending actions', PendingActionPageSchema),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks pending_actions.read'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/admin/pending-actions/{actionId}',
    summary: 'Fetch one pending action',
    tags: [TAG_ADMIN_FOUR_EYES],
    security: bearer,
    request: { params: z.object({ actionId: z.string().uuid() }) },
    responses: {
      200: jsonResponse('The pending action', PendingActionSchema),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks pending_actions.read'),
      404: errorResponse('Pending action not found'),
    },
  });

  // Decisions are type-scoped rather than generic. The permission a decision
  // needs depends on the row's type, which a route-level annotation cannot know,
  // so the alternative would be moving the decisive authorization check off the
  // route and into the service — hiding it from exactly the diff that should
  // show it. The unified queue above stays the place to *read* both types.
  registry.registerPath({
    method: 'post',
    path: '/v1/admin/funding-requests/{actionId}/approve',
    summary: 'Approve a funding request and execute it (checker)',
    description:
      'The credit posts inside the same transaction that decides the request, so a concurrent double-approval cannot post twice and a failed posting leaves the request pending. The maker cannot approve their own request.',
    tags: [TAG_ADMIN_FOUR_EYES],
    security: bearer,
    request: {
      params: z.object({ actionId: z.string().uuid() }),
      headers: idempotencyHeader,
      body: jsonBody(PendingActionDecisionSchema),
    },
    responses: {
      201: jsonResponse('Approved and executed', AdminFundingApprovalResponseSchema),
      400: errorResponse(
        'Already decided, expired, not a funding request, or missing Idempotency-Key',
      ),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks admin_funding.approve, or the caller is the maker'),
      404: errorResponse('Pending action not found'),
      409: errorResponse('Idempotency key reused with a different request'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/admin/funding-requests/{actionId}/reject',
    summary: 'Reject a funding request (checker)',
    description: 'Records the decision; no money moves and the request cannot be revived.',
    tags: [TAG_ADMIN_FOUR_EYES],
    security: bearer,
    request: {
      params: z.object({ actionId: z.string().uuid() }),
      body: jsonBody(PendingActionDecisionSchema),
    },
    responses: {
      200: jsonResponse('Rejected', PendingActionSchema),
      400: errorResponse('Already decided, or not a funding request'),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks admin_funding.approve'),
      404: errorResponse('Pending action not found'),
    },
  });

  // --- Four-eyes second-factor reset (ADR-0030) -----------------------------
  registry.registerPath({
    method: 'post',
    path: '/v1/admin/totp-resets',
    summary: 'Request a reset of another operator’s second factor (maker)',
    description:
      'Files a request; the target’s credentials are untouched until a checker approves. Requires admin_totp_reset.request, which only compliance_officer holds — narrower than the funding maker half, because a reset hands over a back-office identity rather than crediting a customer.',
    tags: [TAG_ADMIN_FOUR_EYES],
    security: bearer,
    request: { body: jsonBody(AdminTotpResetRequestSchema) },
    responses: {
      201: jsonResponse('Request filed and awaiting a checker', PendingActionSchema),
      400: errorResponse('Validation failed'),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks admin_totp_reset.request'),
      404: errorResponse('Admin not found'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/admin/totp-resets/{actionId}/approve',
    summary: 'Approve a second-factor reset and execute it (checker)',
    description:
      'Clears the target’s secret, enrolment, replay guard, and lockout, and revokes all of their live sessions — in the same transaction that decides the request. The maker cannot approve their own request, and no admin may approve a reset of their own factor: that would be a unilateral second-factor bypass.',
    tags: [TAG_ADMIN_FOUR_EYES],
    security: bearer,
    request: {
      params: z.object({ actionId: z.string().uuid() }),
      body: jsonBody(PendingActionDecisionSchema),
    },
    responses: {
      200: jsonResponse('Approved and executed', AdminTotpResetApprovalResponseSchema),
      400: errorResponse('Already decided, expired, or not a reset request'),
      401: errorResponse('Not authenticated'),
      403: errorResponse(
        'Role lacks admin_totp_reset.approve, or the caller is the maker or the target',
      ),
      404: errorResponse('Pending action not found'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/admin/totp-resets/{actionId}/reject',
    summary: 'Reject a second-factor reset (checker)',
    description: 'Records the decision; the target’s factor is untouched.',
    tags: [TAG_ADMIN_FOUR_EYES],
    security: bearer,
    request: {
      params: z.object({ actionId: z.string().uuid() }),
      body: jsonBody(PendingActionDecisionSchema),
    },
    responses: {
      200: jsonResponse('Rejected', PendingActionSchema),
      400: errorResponse('Already decided, or not a reset request'),
      401: errorResponse('Not authenticated'),
      403: errorResponse('Role lacks admin_totp_reset.approve'),
      404: errorResponse('Pending action not found'),
    },
  });
}
