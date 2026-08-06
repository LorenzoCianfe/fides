import type { Page } from '@playwright/test';

/**
 * A CDP virtual authenticator: a real WebAuthn implementation inside Chromium,
 * driven by the browser rather than stubbed in page script.
 *
 * This matters for what the suite actually proves. The server verifies genuine
 * attestations and assertions — signature, challenge, origin, relying-party id,
 * user-verification flag, and the signature counter. A mocked `navigator
 * .credentials` would satisfy the UI while proving nothing about any of that.
 *
 * `hasUserVerification` and `isUserVerified` are required rather than
 * cosmetic: the relying party demands user verification (ADR-0020), so an
 * authenticator that cannot assert UV is rejected outright.
 */
export interface VirtualAuthenticator {
  /** Removes the authenticator, so a later ceremony finds no credential. */
  remove: () => Promise<void>;
}

export async function addVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');

  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      // `internal` models a platform authenticator — Face ID, Touch ID, Windows
      // Hello — which is what this product's passkeys actually are.
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      // The ceremony completes without a real gesture; without this every
      // create/get would hang waiting for a user who cannot arrive.
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  return {
    remove: async () => {
      await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    },
  };
}
