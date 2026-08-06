import type {
  RegisterResponseDto,
  ScaActionDto,
  ScaGrantResponseDto,
  SessionResponseDto,
  VerifyEmailResponseDto,
} from '@fides/contracts';
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { apiFetch } from './client';

/**
 * Authentication flows (ADR-0020/0021/0027).
 *
 * The three calls that mint or rotate a session ask for cookie transport, so
 * the tokens never reach this code at all. Everything else relies on the
 * cookies the browser now sends automatically.
 */

export interface RegisterInput {
  email: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string;
  addressLine1: string;
  city: string;
  postalCode: string;
  country: string;
}

export function register(input: RegisterInput): Promise<RegisterResponseDto> {
  return apiFetch<RegisterResponseDto>('/v1/auth/register', { method: 'POST', body: input });
}

export function verifyEmail(email: string, code: string): Promise<VerifyEmailResponseDto> {
  return apiFetch<VerifyEmailResponseDto>('/v1/auth/verify-email', {
    method: 'POST',
    body: { email, code },
  });
}

export function resendVerification(email: string): Promise<void> {
  return apiFetch<void>('/v1/auth/resend-verification', { method: 'POST', body: { email } });
}

/** Device metadata is client-declared and untrusted server-side until attestation. */
function describeDevice(): { name: string; platform: string } {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const name = /Firefox/.test(agent)
    ? 'Firefox'
    : /Edg\//.test(agent)
      ? 'Edge'
      : /Chrome/.test(agent)
        ? 'Chrome'
        : /Safari/.test(agent)
          ? 'Safari'
          : 'Browser';
  return { name, platform: 'web' };
}

/**
 * Enrol the first passkey. The enrolment token stands in for a session the user
 * does not have yet; verifying it issues one.
 */
export async function enrolPasskey(userId: string, enrolmentToken: string): Promise<void> {
  const options = await apiFetch<PublicKeyCredentialCreationOptionsJSON>(
    '/v1/auth/webauthn/registration/options',
    { method: 'POST', body: { userId, enrolmentToken } },
  );

  const attestation = await startRegistration({ optionsJSON: options });

  await apiFetch<{ credentialId: string; session: SessionResponseDto | null }>(
    '/v1/auth/webauthn/registration/verify',
    {
      method: 'POST',
      body: { userId, enrolmentToken, response: attestation, device: describeDevice() },
      cookieTransport: true,
    },
  );
}

/** Sign in with an existing passkey. */
export async function signIn(email: string): Promise<void> {
  const options = await apiFetch<PublicKeyCredentialRequestOptionsJSON>(
    '/v1/auth/webauthn/authentication/options',
    { method: 'POST', body: { email } },
  );

  const assertion = await startAuthentication({ optionsJSON: options });

  await apiFetch<SessionResponseDto>('/v1/auth/webauthn/authentication/verify', {
    method: 'POST',
    body: { response: assertion, device: describeDevice() },
    cookieTransport: true,
  });
}

export function signOut(): Promise<void> {
  return apiFetch<void>('/v1/auth/logout', { method: 'POST' });
}

/**
 * Step up for a sensitive action (PSD2 dynamic linking, ADR-0021/0023).
 *
 * The action is sent so the server can bind the challenge to exactly these
 * parameters; it recomputes the hash from what it actually executes, so a
 * tampered amount or payee fails at consumption rather than here.
 */
export async function stepUp(action: ScaActionDto): Promise<string> {
  const options = await apiFetch<PublicKeyCredentialRequestOptionsJSON>('/v1/auth/sca/options', {
    method: 'POST',
    body: { action },
  });

  const assertion = await startAuthentication({ optionsJSON: options });

  const { grant } = await apiFetch<ScaGrantResponseDto>('/v1/auth/sca/verify', {
    method: 'POST',
    body: { action, response: assertion },
  });
  return grant;
}
