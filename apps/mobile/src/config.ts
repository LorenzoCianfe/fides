/**
 * Runtime configuration.
 *
 * `EXPO_PUBLIC_*` values are inlined into the bundle at build time, which is
 * the right mechanism for a public API base URL and the wrong one for anything
 * secret — nothing here may ever hold a credential.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * The domain this build's passkeys are bound to. The same variable drives the
 * iOS associated-domains entitlement in `app.config.ts`, so the entitlement and
 * this diagnostic cannot disagree.
 *
 * Read only for diagnostics: the relying-party id that actually drives a
 * ceremony arrives inside the options the server returns, so the client never
 * has to agree with it independently.
 */
export const BUILT_FOR_RP_ID = process.env.EXPO_PUBLIC_RP_ID ?? '';
