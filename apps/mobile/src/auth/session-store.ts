import * as SecureStore from 'expo-secure-store';

/**
 * Where the session tokens live on a device.
 *
 * Mobile keeps the **bearer** transport (ADR-0027): the cookie mode exists for
 * browsers, which cannot be trusted to hold a token out of reach of script.
 * A native app can, so the pair goes to the iOS keychain / Android keystore
 * through `expo-secure-store` rather than to `AsyncStorage`, which is plain
 * unencrypted files readable on a rooted or jailbroken device.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is deliberate on both counts: a banking
 * session should not be readable while the device is locked, and it should not
 * travel to a new device through an encrypted backup.
 */
const ACCESS_KEY = 'fides.session.access';
const REFRESH_KEY = 'fides.session.refresh';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export async function saveSession(tokens: SessionTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken, OPTIONS),
    SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken, OPTIONS),
  ]);
}

export async function readSession(): Promise<SessionTokens | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY, OPTIONS),
    SecureStore.getItemAsync(REFRESH_KEY, OPTIONS),
  ]);
  // A half-present pair is unusable: without the refresh token the session
  // cannot survive the first expiry, so treat it as no session at all.
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY, OPTIONS),
    SecureStore.deleteItemAsync(REFRESH_KEY, OPTIONS),
  ]);
}
