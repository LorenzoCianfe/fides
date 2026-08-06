import type {
  RegisterResponseDto,
  ScaActionDto,
  ScaGrantResponseDto,
  SessionResponseDto,
  VerifyEmailResponseDto,
} from '@fides/contracts';
import { Platform } from 'react-native';
import {
  assertPasskey,
  createPasskey,
  type CreationOptions,
  type RequestOptions,
} from '../auth/passkeys';
import { apiFetch, forgetSession, setSession } from './client';

/**
 * Authentication flows (ADR-0020/0021).
 *
 * Mobile stays on the bearer transport, so the routes that mint a session
 * return their tokens in the body and they go straight to the keystore.
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
  return apiFetch<RegisterResponseDto>('/v1/auth/register', {
    method: 'POST',
    body: input,
    anonymous: true,
  });
}

export function verifyEmail(email: string, code: string): Promise<VerifyEmailResponseDto> {
  return apiFetch<VerifyEmailResponseDto>('/v1/auth/verify-email', {
    method: 'POST',
    body: { email, code },
    anonymous: true,
  });
}

export function resendVerification(email: string): Promise<void> {
  return apiFetch<void>('/v1/auth/resend-verification', {
    method: 'POST',
    body: { email },
    anonymous: true,
  });
}

/** Device metadata is client-declared and untrusted server-side until attestation. */
function describeDevice(): { name: string; platform: string } {
  return {
    name: Platform.select({ ios: 'iPhone', android: 'Android device', default: 'Device' }),
    platform: Platform.OS,
  };
}

/** A minted session, stored so every later call can authenticate. */
async function adoptSession(session: SessionResponseDto): Promise<void> {
  if (!session.accessToken || !session.refreshToken) {
    // Only the cookie transport omits these, and mobile never asks for it.
    throw new Error('Session response carried no tokens');
  }
  await setSession({ accessToken: session.accessToken, refreshToken: session.refreshToken });
}

/**
 * Enrol the first passkey. The enrolment token stands in for a session the user
 * does not have yet; verifying the credential issues one.
 */
export async function enrolPasskey(userId: string, enrolmentToken: string): Promise<void> {
  const options = await apiFetch<CreationOptions>('/v1/auth/webauthn/registration/options', {
    method: 'POST',
    body: { userId, enrolmentToken },
    anonymous: true,
  });

  const attestation = await createPasskey(options);

  const { session } = await apiFetch<{ credentialId: string; session: SessionResponseDto | null }>(
    '/v1/auth/webauthn/registration/verify',
    {
      method: 'POST',
      body: { userId, enrolmentToken, response: attestation, device: describeDevice() },
      anonymous: true,
    },
  );

  if (session) await adoptSession(session);
}

/** Sign in with an existing passkey. */
export async function signIn(email: string): Promise<void> {
  const options = await apiFetch<RequestOptions>('/v1/auth/webauthn/authentication/options', {
    method: 'POST',
    body: { email },
    anonymous: true,
  });

  const assertion = await assertPasskey(options);

  const session = await apiFetch<SessionResponseDto>('/v1/auth/webauthn/authentication/verify', {
    method: 'POST',
    body: { response: assertion, device: describeDevice() },
    anonymous: true,
  });

  await adoptSession(session);
}

export async function signOut(): Promise<void> {
  try {
    await apiFetch<void>('/v1/auth/logout', { method: 'POST' });
  } finally {
    // Whatever the server said, this device's session is over.
    await forgetSession();
  }
}

/**
 * Step up for a sensitive action (PSD2 dynamic linking, ADR-0021/0023).
 *
 * The action travels so the server can bind the challenge to exactly these
 * parameters; it recomputes the hash from what it actually executes, so a
 * tampered amount or payee fails at consumption rather than here.
 */
export async function stepUp(action: ScaActionDto): Promise<string> {
  const options = await apiFetch<RequestOptions>('/v1/auth/sca/options', {
    method: 'POST',
    body: { action },
  });

  const assertion = await assertPasskey(options);

  const { grant } = await apiFetch<ScaGrantResponseDto>('/v1/auth/sca/verify', {
    method: 'POST',
    body: { action, response: assertion },
  });
  return grant;
}
