import * as Passkeys from 'react-native-passkeys';

/**
 * The library does not re-export its option types from its entry point, and
 * deep-importing its build directory would break on any internal reshuffle.
 * Deriving them from the public signatures is exact and cannot drift.
 */
export type CreationOptions = Parameters<typeof Passkeys.create>[0];
export type RequestOptions = Parameters<typeof Passkeys.get>[0];

/**
 * Native passkey ceremonies.
 *
 * The options object the server returns is the WebAuthn JSON shape, and this
 * library takes it as-is, so nothing is reshaped in between — which matters,
 * because a client that rebuilds the challenge is a client that can get it
 * subtly wrong.
 */

/** Raised when the platform cannot do passkeys at all — notably Expo Go. */
export class PasskeysUnavailableError extends Error {
  constructor() {
    super('Passkeys are unavailable on this build');
    this.name = 'PasskeysUnavailableError';
  }
}

/**
 * Raised when the user dismissed the sheet. Carries the `NotAllowedError` name
 * the web platform uses for the same event, so one mapper handles both clients.
 */
export class PasskeyCancelledError extends Error {
  constructor() {
    super('Passkey ceremony cancelled');
    this.name = 'NotAllowedError';
  }
}

/**
 * Whether this build can create and use passkeys. False in Expo Go, which
 * cannot load the native module — the screens use this to explain the problem
 * rather than letting the ceremony fail with nothing to act on.
 */
export function passkeysSupported(): boolean {
  try {
    return Passkeys.isSupported();
  } catch {
    return false;
  }
}

export async function createPasskey(options: CreationOptions): Promise<unknown> {
  if (!passkeysSupported()) throw new PasskeysUnavailableError();
  // A null return means the sheet closed without a credential; the library
  // reports a genuine failure by throwing.
  const credential = await Passkeys.create(options);
  if (!credential) throw new PasskeyCancelledError();
  return credential;
}

export async function assertPasskey(options: RequestOptions): Promise<unknown> {
  if (!passkeysSupported()) throw new PasskeysUnavailableError();
  const assertion = await Passkeys.get(options);
  if (!assertion) throw new PasskeyCancelledError();
  return assertion;
}
