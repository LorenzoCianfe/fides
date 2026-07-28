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

export const PendingActionStatusSchema = z
  .enum(['pending', 'approved', 'rejected'])
  .openapi('PendingActionStatus');

export type PendingActionStatusDto = z.infer<typeof PendingActionStatusSchema>;

/** An entry in the four-eyes queue. */
export const PendingActionSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string().openapi({ example: 'admin_funding' }),
    status: PendingActionStatusSchema,
    payload: AdminFundingPayloadSchema,
    makerId: z.string().uuid(),
    makerReason: z.string().nullable(),
    checkerId: z.string().uuid().nullable(),
    decisionReason: z.string().nullable(),
    decidedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime(),
    expired: z
      .boolean()
      .openapi({
        description: 'A still-pending request past its deadline can no longer be approved',
      }),
    resultRef: z
      .string()
      .nullable()
      .openapi({ description: 'What execution produced — for funding, the journal entry id' }),
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

export const PendingActionIdParamsSchema = z.object({ actionId: z.string().uuid() });

export type PendingActionIdParamsDto = z.infer<typeof PendingActionIdParamsSchema>;
