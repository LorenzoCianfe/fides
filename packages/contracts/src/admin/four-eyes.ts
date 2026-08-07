import { z } from '../zod';
import { MoneySchema } from '../common/money';
import { pageOf } from '../common/pagination';

/**
 * The maker half of four-eyes admin funding (ADR-0011, ADR-0025). Filing a
 * request moves no money: it is executed only when a different admin holding
 * the checker permission approves it.
 */
export const AdminFundingRequestSchema = z
  .object({
    userId: z.string().uuid().openapi({ description: 'The beneficiary customer' }),
    amount: MoneySchema,
    reason: z
      .string()
      .min(1)
      .max(500)
      .openapi({ description: 'Why the credit is warranted; shown to the checker' }),
  })
  .openapi('AdminFundingRequest');

export type AdminFundingRequestDto = z.infer<typeof AdminFundingRequestSchema>;

/** The stored, checker-visible parameters of a funding request. */
export const AdminFundingPayloadSchema = z
  .object({
    userId: z.string().uuid(),
    walletId: z.string().uuid().openapi({
      description: 'Resolved when the request was filed, so the checker approves an exact target',
    }),
    amountMinor: z.string(),
    currency: z.string().length(3),
    reason: z.string(),
  })
  .openapi('AdminFundingPayload');

export type AdminFundingPayloadDto = z.infer<typeof AdminFundingPayloadSchema>;

/**
 * The maker half of a four-eyes second-factor reset (ADR-0030). Filing a request
 * changes nothing about the target's credentials: a reset is a second-factor
 * bypass by definition — whoever enrols next holds the account — so it is
 * executed only when a different admin approves.
 */
export const AdminTotpResetRequestSchema = z
  .object({
    adminId: z
      .string()
      .uuid()
      .openapi({ description: 'The operator whose second factor would be cleared' }),
    reason: z
      .string()
      .min(1)
      .max(500)
      .openapi({ description: 'Why the reset is warranted; shown to the checker' }),
  })
  .openapi('AdminTotpResetRequest');

export type AdminTotpResetRequestDto = z.infer<typeof AdminTotpResetRequestSchema>;

/** The stored, checker-visible parameters of a second-factor reset request. */
export const AdminTotpResetPayloadSchema = z
  .object({
    targetAdminId: z.string().uuid(),
    targetEmail: z.string().email().openapi({
      description: 'Captured when the request was filed, so the checker sees whom they approve',
    }),
    reason: z.string(),
  })
  .openapi('AdminTotpResetPayload');

export type AdminTotpResetPayloadDto = z.infer<typeof AdminTotpResetPayloadSchema>;

/**
 * The payload of a queue entry, discriminated by the entry's `type`. Kept as a
 * union rather than a loose record so a client that understands one action type
 * still gets a checked shape for the other.
 */
export const PendingActionPayloadSchema = z
  .union([AdminFundingPayloadSchema, AdminTotpResetPayloadSchema])
  .openapi('PendingActionPayload');

export type PendingActionPayloadDto = z.infer<typeof PendingActionPayloadSchema>;

export const PendingActionStatusSchema = z
  .enum(['pending', 'approved', 'rejected'])
  .openapi('PendingActionStatus');

export type PendingActionStatusDto = z.infer<typeof PendingActionStatusSchema>;

/** An entry in the four-eyes queue, of either registered type. */
export const PendingActionSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(['admin_funding', 'admin_totp_reset']).openapi({ example: 'admin_funding' }),
    status: PendingActionStatusSchema,
    payload: PendingActionPayloadSchema,
    makerId: z.string().uuid(),
    makerReason: z.string().nullable(),
    checkerId: z.string().uuid().nullable(),
    decisionReason: z.string().nullable(),
    decidedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime(),
    expired: z.boolean().openapi({
      description: 'A still-pending request past its deadline can no longer be approved',
    }),
    resultRef: z.string().nullable().openapi({
      description:
        'What execution produced — for funding the journal entry id, for a reset the target admin id',
    }),
    createdAt: z.string().datetime(),
  })
  .openapi('PendingAction');

export type PendingActionDto = z.infer<typeof PendingActionSchema>;

export const PendingActionPageSchema = pageOf(PendingActionSchema).openapi('PendingActionPage');

export type PendingActionPageDto = z.infer<typeof PendingActionPageSchema>;

export const PendingActionQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
    status: PendingActionStatusSchema.optional(),
  })
  .openapi('PendingActionQuery');

export type PendingActionQueryDto = z.infer<typeof PendingActionQuerySchema>;

export const PendingActionDecisionSchema = z
  .object({ reason: z.string().max(500).optional() })
  .openapi('PendingActionDecision');

export type PendingActionDecisionDto = z.infer<typeof PendingActionDecisionSchema>;

/** The result of an approval: the decided request and the credit it posted. */
export const AdminFundingApprovalResponseSchema = z
  .object({
    action: PendingActionSchema,
    fundingId: z.string().uuid().openapi({ description: 'The posted journal entry id' }),
  })
  .openapi('AdminFundingApprovalResponse');

export type AdminFundingApprovalResponseDto = z.infer<typeof AdminFundingApprovalResponseSchema>;

/** The result of an approved reset: the decided request and its blast radius. */
export const AdminTotpResetApprovalResponseSchema = z
  .object({
    action: PendingActionSchema,
    revokedSessions: z.number().int().nonnegative().openapi({
      description: 'How many of the target’s live back-office sessions the reset cut off',
    }),
  })
  .openapi('AdminTotpResetApprovalResponse');

export type AdminTotpResetApprovalResponseDto = z.infer<
  typeof AdminTotpResetApprovalResponseSchema
>;

export const PendingActionIdParamsSchema = z.object({ actionId: z.string().uuid() });

export type PendingActionIdParamsDto = z.infer<typeof PendingActionIdParamsSchema>;
