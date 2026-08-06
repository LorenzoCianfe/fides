import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config (Slice 8 Wave C).
 *
 * Native passkeys are bound to a domain at *build* time: iOS reads
 * `webcredentials:<rpId>` from the app's entitlements, and Android matches the
 * package name and signing certificate against the server's `assetlinks.json`.
 * Neither can be changed at runtime, so the domain has to enter here rather
 * than through a runtime setting.
 *
 * Driving it from the environment is what makes one codebase work in both
 * places: a production build points at the real domain, and a developer build
 * points at a stable HTTPS tunnel in front of the local API. The API serves the
 * matching association documents itself from whichever origin fronts it
 * (ADR-0027), so there is no second deployment to keep in step. See
 * `docs/mobile-passkeys.md` for the local setup.
 *
 * `EXPO_PUBLIC_RP_ID` rather than a private variable, so the same value reaches
 * the client bundle for diagnostics and the two cannot drift apart.
 */
const rpId = process.env.EXPO_PUBLIC_RP_ID ?? '';
const iosBundleId = process.env.IOS_BUNDLE_ID ?? 'com.fides.app';
const androidPackage = process.env.ANDROID_PACKAGE ?? 'com.fides.app';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'Fides',
  slug: config.slug ?? 'fides',
  ios: {
    ...config.ios,
    bundleIdentifier: iosBundleId,
    // An empty list rather than a placeholder domain: a wrong associated
    // domain fails the passkey ceremony on device with no useful diagnostic,
    // whereas none at all fails immediately and obviously.
    associatedDomains: rpId ? [`webcredentials:${rpId}`] : [],
  },
  android: {
    ...config.android,
    package: androidPackage,
  },
});
