import { z } from '../zod';
import { DeviceDescriptorSchema, EmailSchema } from './primitives';
import { SessionResponseSchema } from './session';

/**
 * Client-submitted ceremony payloads use `.passthrough()`: they are defined by
 * the WebAuthn spec and verified in depth by the relying party
 * (@simplewebauthn), so validation must never strip fields it does not know.
 * The server-issued options below are documentation-shaped (responses are not
 * runtime-validated) and stay structurally compatible with the library types.
 */

/** Server-issued creation options (PublicKeyCredentialCreationOptionsJSON). */
export const WebAuthnCreationOptionsSchema = z
  .object({
    challenge: z.string(),
    rp: z.object({ id: z.string().optional(), name: z.string() }),
    user: z.object({ id: z.string(), name: z.string(), displayName: z.string() }),
    pubKeyCredParams: z.array(z.object({ alg: z.number(), type: z.string() })),
    timeout: z.number().optional(),
    excludeCredentials: z.array(z.unknown()).optional(),
    authenticatorSelection: z.unknown().optional(),
    attestation: z.string().optional(),
    extensions: z.unknown().optional(),
  })
  .openapi('WebAuthnCreationOptions');

export type WebAuthnCreationOptionsDto = z.infer<typeof WebAuthnCreationOptionsSchema>;

/** Server-issued request options (PublicKeyCredentialRequestOptionsJSON). */
export const WebAuthnRequestOptionsSchema = z
  .object({
    challenge: z.string(),
    rpId: z.string().optional(),
    timeout: z.number().optional(),
    allowCredentials: z.array(z.unknown()).optional(),
    userVerification: z.string().optional(),
    extensions: z.unknown().optional(),
  })
  .openapi('WebAuthnRequestOptions');

export type WebAuthnRequestOptionsDto = z.infer<typeof WebAuthnRequestOptionsSchema>;

/** Authenticator attestation submitted by the client (RegistrationResponseJSON). */
export const WebAuthnRegistrationResponseSchema = z
  .object({
    id: z.string(),
    rawId: z.string(),
    type: z.literal('public-key'),
    response: z
      .object({
        clientDataJSON: z.string(),
        attestationObject: z.string(),
        transports: z.array(z.string()).optional(),
      })
      .passthrough(),
    clientExtensionResults: z.record(z.unknown()).default({}),
    authenticatorAttachment: z.string().optional(),
  })
  .passthrough()
  .openapi('WebAuthnRegistrationResponse');

export type WebAuthnRegistrationResponseDto = z.infer<typeof WebAuthnRegistrationResponseSchema>;

/** Authenticator assertion submitted by the client (AuthenticationResponseJSON). */
export const WebAuthnAuthenticationResponseSchema = z
  .object({
    id: z.string(),
    rawId: z.string(),
    type: z.literal('public-key'),
    response: z
      .object({
        clientDataJSON: z.string(),
        authenticatorData: z.string(),
        signature: z.string(),
        userHandle: z.string().nullish(),
      })
      .passthrough(),
    clientExtensionResults: z.record(z.unknown()).default({}),
    authenticatorAttachment: z.string().optional(),
  })
  .passthrough()
  .openapi('WebAuthnAuthenticationResponse');

export type WebAuthnAuthenticationResponseDto = z.infer<
  typeof WebAuthnAuthenticationResponseSchema
>;

/**
 * First passkey: unauthenticated + enrolment token (issued by email
 * verification). Additional passkeys: authenticated session, no token.
 */
export const StartPasskeyRegistrationRequestSchema = z
  .object({
    userId: z.string().uuid(),
    enrolmentToken: z.string().optional(),
  })
  .openapi('StartPasskeyRegistrationRequest');

export type StartPasskeyRegistrationRequestDto = z.infer<
  typeof StartPasskeyRegistrationRequestSchema
>;

export const FinishPasskeyRegistrationRequestSchema = z
  .object({
    userId: z.string().uuid(),
    enrolmentToken: z.string().optional(),
    response: WebAuthnRegistrationResponseSchema,
    device: DeviceDescriptorSchema,
  })
  .openapi('FinishPasskeyRegistrationRequest');

export type FinishPasskeyRegistrationRequestDto = z.infer<
  typeof FinishPasskeyRegistrationRequestSchema
>;

export const FinishPasskeyRegistrationResponseSchema = z
  .object({
    credentialId: z.string(),
    /** Auto-issued on first-passkey enrolment (ADR-0020); null when adding passkeys. */
    session: SessionResponseSchema.nullable(),
  })
  .openapi('FinishPasskeyRegistrationResponse');

export type FinishPasskeyRegistrationResponseDto = z.infer<
  typeof FinishPasskeyRegistrationResponseSchema
>;

/** Email-first login; unknown emails receive indistinguishable decoy options. */
export const StartAuthenticationRequestSchema = z
  .object({ email: EmailSchema })
  .openapi('StartAuthenticationRequest');

export type StartAuthenticationRequestDto = z.infer<typeof StartAuthenticationRequestSchema>;

export const FinishAuthenticationRequestSchema = z
  .object({
    response: WebAuthnAuthenticationResponseSchema,
    device: DeviceDescriptorSchema,
  })
  .openapi('FinishAuthenticationRequest');

export type FinishAuthenticationRequestDto = z.infer<typeof FinishAuthenticationRequestSchema>;
