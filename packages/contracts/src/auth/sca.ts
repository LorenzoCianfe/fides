import { z } from '../zod';
import { WebAuthnAuthenticationResponseSchema, WebAuthnRequestOptionsSchema } from './webauthn';

/**
 * A sensitive action to be authorized under PSD2 dynamic linking (ADR-0021).
 * The server canonicalizes and hashes `{type, payload}`; the WebAuthn challenge
 * and the resulting grant are bound to that hash, so the signed assertion
 * authorizes exactly this action and no other.
 */
export const ScaActionSchema = z
  .object({
    type: z.string().min(1).max(100).openapi({ example: 'p2p_transfer' }),
    payload: z
      .record(z.unknown())
      .openapi({ description: 'The linked parameters the user confirms (amount, payee, …)' }),
  })
  .openapi('ScaAction');

export type ScaActionDto = z.infer<typeof ScaActionSchema>;

export const StartScaRequestSchema = z
  .object({ action: ScaActionSchema })
  .openapi('StartScaRequest');

export type StartScaRequestDto = z.infer<typeof StartScaRequestSchema>;

export const StartScaResponseSchema = WebAuthnRequestOptionsSchema;

export const FinishScaRequestSchema = z
  .object({
    action: ScaActionSchema,
    response: WebAuthnAuthenticationResponseSchema,
  })
  .openapi('FinishScaRequest');

export type FinishScaRequestDto = z.infer<typeof FinishScaRequestSchema>;

export const ScaGrantResponseSchema = z
  .object({
    grant: z
      .string()
      .openapi({ description: 'Single-use grant (fsg_…) the guarded action must present' }),
    actionHash: z.string(),
    expiresAt: z.string().datetime(),
  })
  .openapi('ScaGrant');

export type ScaGrantResponseDto = z.infer<typeof ScaGrantResponseSchema>;
