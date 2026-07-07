import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../zod';
import { ErrorResponseSchema } from '../common/error';
import {
  RegisterRequestSchema,
  RegisterResponseSchema,
  ResendVerificationRequestSchema,
  VerifyEmailRequestSchema,
  VerifyEmailResponseSchema,
} from './registration';
import {
  FinishScaRequestSchema,
  ScaGrantResponseSchema,
  StartScaRequestSchema,
  StartScaResponseSchema,
} from './sca';
import { RefreshRequestSchema, SessionListResponseSchema, SessionResponseSchema } from './session';
import {
  FinishAuthenticationRequestSchema,
  FinishPasskeyRegistrationRequestSchema,
  FinishPasskeyRegistrationResponseSchema,
  StartAuthenticationRequestSchema,
  StartPasskeyRegistrationRequestSchema,
  WebAuthnCreationOptionsSchema,
  WebAuthnRequestOptionsSchema,
} from './webauthn';

const TAG_ONBOARDING = 'onboarding';
const TAG_AUTH = 'auth';
const TAG_SESSIONS = 'sessions';
const TAG_SCA = 'sca';

function jsonBody(schema: z.ZodTypeAny) {
  return { content: { 'application/json': { schema } }, required: true };
}

function jsonResponse(description: string, schema: z.ZodTypeAny) {
  return { description, content: { 'application/json': { schema } } };
}

function errorResponse(description: string) {
  return jsonResponse(description, ErrorResponseSchema);
}

const bearer = [{ bearerAuth: [] }];

/**
 * Registers the Wave C auth surface (`/v1/auth/*`, ADR-0021) and the bearer
 * security scheme on an OpenAPI registry. Colocated with the schemas so the
 * served document can never drift from the contracts.
 */
export function registerAuthPaths(registry: OpenAPIRegistry): void {
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    description: 'Opaque session access token (fat_…), validated server-side (ADR-0020)',
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/auth/register',
    summary: 'Register a natural person and start KYC',
    tags: [TAG_ONBOARDING],
    request: { body: jsonBody(RegisterRequestSchema) },
    responses: {
      201: jsonResponse('User created; verification code delivered', RegisterResponseSchema),
      400: errorResponse('Validation failed'),
      409: errorResponse('Email already registered'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/auth/verify-email',
    summary: 'Verify the email code and receive the enrolment token',
    tags: [TAG_ONBOARDING],
    request: { body: jsonBody(VerifyEmailRequestSchema) },
    responses: {
      200: jsonResponse('Email verified; enrolment token issued', VerifyEmailResponseSchema),
      400: errorResponse('Invalid or expired verification code (uniform)'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/auth/resend-verification',
    summary: 'Re-deliver a verification code (silent for unknown emails)',
    tags: [TAG_ONBOARDING],
    request: { body: jsonBody(ResendVerificationRequestSchema) },
    responses: {
      202: { description: 'Accepted regardless of outcome (anti-enumeration)' },
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/auth/webauthn/registration/options',
    summary: 'Issue passkey creation options',
    description:
      'First passkey: requires the enrolment token. Additional passkeys: requires a bearer session instead.',
    tags: [TAG_AUTH],
    request: { body: jsonBody(StartPasskeyRegistrationRequestSchema) },
    responses: {
      200: jsonResponse('Creation options', WebAuthnCreationOptionsSchema),
      401: errorResponse('Missing/invalid enrolment token or session'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/auth/webauthn/registration/verify',
    summary: 'Verify the attestation and store the passkey',
    description: 'Completing the first passkey auto-issues a session (ADR-0020).',
    tags: [TAG_AUTH],
    request: { body: jsonBody(FinishPasskeyRegistrationRequestSchema) },
    responses: {
      201: jsonResponse('Passkey registered', FinishPasskeyRegistrationResponseSchema),
      401: errorResponse('Ceremony verification failed'),
      409: errorResponse('Passkey already registered'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/auth/webauthn/authentication/options',
    summary: 'Issue login assertion options (email-first)',
    description: 'Unknown emails receive indistinguishable decoy options (ADR-0020).',
    tags: [TAG_AUTH],
    request: { body: jsonBody(StartAuthenticationRequestSchema) },
    responses: {
      200: jsonResponse('Request options', WebAuthnRequestOptionsSchema),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/auth/webauthn/authentication/verify',
    summary: 'Verify the login assertion and issue a session',
    tags: [TAG_AUTH],
    request: { body: jsonBody(FinishAuthenticationRequestSchema) },
    responses: {
      200: jsonResponse('Session issued', SessionResponseSchema),
      401: errorResponse('Authentication failed (uniform)'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/auth/refresh',
    summary: 'Rotate the session token pair',
    description: 'Presenting a superseded refresh token revokes the session (ADR-0020).',
    tags: [TAG_SESSIONS],
    request: { body: jsonBody(RefreshRequestSchema) },
    responses: {
      200: jsonResponse('Rotated session', SessionResponseSchema),
      401: errorResponse('Invalid, expired, or reused refresh token'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/auth/logout',
    summary: 'Revoke the current session',
    tags: [TAG_SESSIONS],
    security: bearer,
    responses: {
      204: { description: 'Session revoked (idempotent)' },
      401: errorResponse('Not authenticated'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/auth/sessions',
    summary: 'List the caller’s active sessions',
    tags: [TAG_SESSIONS],
    security: bearer,
    responses: {
      200: jsonResponse('Active sessions, newest first', SessionListResponseSchema),
      401: errorResponse('Not authenticated'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/v1/auth/sessions/{sessionId}',
    summary: 'Revoke one of the caller’s sessions',
    tags: [TAG_SESSIONS],
    security: bearer,
    request: { params: z.object({ sessionId: z.string().uuid() }) },
    responses: {
      204: { description: 'Revoked (idempotent, ownership-scoped)' },
      401: errorResponse('Not authenticated'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/auth/sca/options',
    summary: 'Issue step-up assertion options bound to an action',
    description: 'PSD2 dynamic linking: the challenge is bound to the canonical action hash.',
    tags: [TAG_SCA],
    security: bearer,
    request: { body: jsonBody(StartScaRequestSchema) },
    responses: {
      200: jsonResponse('Request options', StartScaResponseSchema),
      401: errorResponse('Not authenticated'),
      412: errorResponse('No passkey enrolled'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/auth/sca/verify',
    summary: 'Verify the step-up assertion and mint a single-use grant',
    tags: [TAG_SCA],
    security: bearer,
    request: { body: jsonBody(FinishScaRequestSchema) },
    responses: {
      201: jsonResponse('Grant issued', ScaGrantResponseSchema),
      401: errorResponse('Step-up verification failed'),
      429: errorResponse('Rate limited'),
    },
  });
}
