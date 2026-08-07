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
 * What the surviving anchors say about the trail's *tail* (ADR-0031).
 *
 * `unanchored` is deliberately not a failure: it means no anchor was available
 * to check, which is the state of a freshly-deployed system — and also the state
 * an attacker leaves behind by deleting the anchor rows. The two cannot be told
 * apart from inside the database, which is exactly why anchors are also
 * published to the process log. Treat it as "no claim checked", not "safe".
 */
export const AuditTailStatusSchema = z
  .enum(['intact', 'truncated', 'unanchored', 'anchor_unverifiable'])
  .openapi('AuditTailStatus', { example: 'intact' });

export type AuditTailStatusDto = z.infer<typeof AuditTailStatusSchema>;

export const AuditTailVerificationSchema = z
  .object({
    status: AuditTailStatusSchema,
    headSeq: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .openapi({ description: 'Where the chain ends now; null when the trail is empty' }),
    anchoredSeq: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .openapi({ description: 'The highest position any checked anchor attests to' }),
    anchoredAt: z.string().datetime().nullable(),
    detail: z.string().nullable(),
  })
  .openapi('AuditTailVerification');

export type AuditTailVerificationDto = z.infer<typeof AuditTailVerificationSchema>;

/**
 * The outcome of a full chain walk from genesis, plus the tail check.
 *
 * `brokenAtSeq` is the first record whose hash fails to recompute or fails to
 * link to its predecessor — that catches any edit or removal *within* the chain.
 * It cannot catch truncation, because deleting the newest records leaves a
 * shorter chain that verifies perfectly, which is what `tail` is for. `ok` is
 * the combined verdict: an intact chain that has not been cut short.
 */
export const AuditVerificationSchema = z
  .object({
    ok: z.boolean().openapi({ description: 'Chain intact AND tail not truncated' }),
    count: z.number().int().nonnegative(),
    brokenAtSeq: z.number().int().nonnegative().nullable(),
    tail: AuditTailVerificationSchema,
    verifiedAt: z.string().datetime(),
  })
  .openapi('AuditVerification');

export type AuditVerificationDto = z.infer<typeof AuditVerificationSchema>;

/**
 * An anchor an operator holds from the log archive. This is the path that still
 * works when the anchor table has been emptied along with the records it
 * attested to — the reason the signature is asymmetric rather than an HMAC.
 */
export const AuditAnchorVerifyRequestSchema = z
  .object({
    payload: z.string().min(1).openapi({
      description: 'The canonical signed payload, exactly as published in the log line',
      example: '{"hash":"9f86d0…","keyId":"prod-1","publishedAtMs":1785000000000,"seq":417}',
    }),
    signature: z
      .string()
      .min(1)
      .openapi({ description: 'The `fsig$v1$keyId$…` envelope from the same line' }),
  })
  .openapi('AuditAnchorVerifyRequest');

export type AuditAnchorVerifyRequestDto = z.infer<typeof AuditAnchorVerifyRequestSchema>;

export const AuditAnchorVerificationSchema = AuditTailVerificationSchema.extend({
  signatureValid: z
    .boolean()
    .openapi({ description: 'False when the payload and signature are not a genuine pair' }),
  verifiedAt: z.string().datetime(),
}).openapi('AuditAnchorVerification');

export type AuditAnchorVerificationDto = z.infer<typeof AuditAnchorVerificationSchema>;
