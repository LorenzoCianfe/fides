import { z } from '../zod';
import { pageOf } from '../common/pagination';

/** Who performed an audited action (ADR-0024, extended for admins by ADR-0025). */
export const AuditActorTypeSchema = z
  .enum(['user', 'system', 'admin'])
  .openapi('AuditActorType', { example: 'admin' });

export type AuditActorTypeDto = z.infer<typeof AuditActorTypeSchema>;

/**
 * One record of the append-only, hash-chained audit trail. `hash` and `prevHash`
 * are exposed so a reader can re-verify the chain independently of this API.
 */
export const AuditRecordSchema = z
  .object({
    id: z.string().uuid(),
    seq: z.number().int().nonnegative().openapi({ description: 'Gap-free chain position' }),
    occurredAt: z.string().datetime(),
    actorType: AuditActorTypeSchema,
    actorId: z.string().uuid().nullable(),
    action: z.string().openapi({ example: 'admin_funding.approved' }),
    resourceType: z.string().openapi({ example: 'pending_admin_action' }),
    resourceId: z.string(),
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
    metadata: z.unknown().nullable(),
    correlationId: z.string().nullable(),
    hash: z.string(),
    prevHash: z.string(),
  })
  .openapi('AuditRecord');

export type AuditRecordDto = z.infer<typeof AuditRecordSchema>;

export const AuditPageSchema = pageOf(AuditRecordSchema).openapi('AuditPage');

export type AuditPageDto = z.infer<typeof AuditPageSchema>;

/** Query for the audit read: cursor pagination over `seq`, plus coarse filters. */
export const AuditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
    action: z.string().min(1).max(120).optional(),
    actorId: z.string().uuid().optional(),
    actorType: AuditActorTypeSchema.optional(),
  })
  .openapi('AuditQuery');

export type AuditQueryDto = z.infer<typeof AuditQuerySchema>;

/**
 * The outcome of a full chain walk from genesis. `brokenAtSeq` is the first
 * record whose hash fails to recompute or fails to link to its predecessor.
 */
export const AuditVerificationSchema = z
  .object({
    ok: z.boolean(),
    count: z.number().int().nonnegative(),
    brokenAtSeq: z.number().int().nonnegative().nullable(),
    verifiedAt: z.string().datetime(),
  })
  .openapi('AuditVerification');

export type AuditVerificationDto = z.infer<typeof AuditVerificationSchema>;
