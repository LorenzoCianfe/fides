import { expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { attachApiDiagnostics } from './diagnostics';
import { verificationCodeFor } from './verification-code';
import { addVirtualAuthenticator, type VirtualAuthenticator } from './webauthn';

export interface Customer {
  readonly email: string;
  readonly page: Page;
  readonly authenticator: VirtualAuthenticator;
}

/** A fresh address per run, so a re-run never collides with a previous one. */
export function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@fides.test`;
}

/**
 * Walks a new customer from the landing page to a funded-capable dashboard:
 * register, confirm the emailed code, create a passkey, arrive signed in.
 *
 * Every step goes through the real UI. The only thing the harness supplies out
 * of band is the verification code, which a real user reads from their inbox.
 */
export async function onboard(context: BrowserContext, label: string): Promise<Customer> {
  const page = await context.newPage();
  attachApiDiagnostics(page);
  const authenticator = await addVirtualAuthenticator(page);
  const email = uniqueEmail(label);

  await page.goto('/en/signup');

  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('First name').fill('Ada');
  await page.getByLabel('Last name').fill('Lovelace');
  await page.getByLabel('Date of birth').fill('1990-12-10');
  // Exact: 'Address' is otherwise also a substring of 'Email address'.
  await page.getByLabel('Address', { exact: true }).fill('12 Analytical Way');
  await page.getByLabel('City').fill('Dublin');
  await page.getByLabel('Postal code').fill('D02 XY45');
  await page.getByLabel('Country code').fill('IE');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();

  const code = await verificationCodeFor(email);
  await page.getByLabel('Verification code').fill(code);
  await page.getByRole('button', { name: 'Confirm email' }).click();

  await expect(page.getByRole('heading', { name: 'Add a passkey' })).toBeVisible();

  // The ceremony is real: Chromium's virtual authenticator signs the server's
  // challenge, and the server verifies the attestation before issuing a session.
  await page.getByRole('button', { name: 'Create passkey' }).click();

  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();

  return { email, page, authenticator };
}

/**
 * Wait for the balance to appear.
 *
 * Account provisioning is event-driven off `kyc.approved` and dispatched from
 * the outbox (ADR-0022), so a just-registered customer legitimately has no
 * wallet for a moment. The dashboard reads once on mount, so this reloads
 * rather than waiting on the open page.
 */
export async function expectBalance(page: Page, formatted: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByText(formatted, { exact: true }).isVisible();
      },
      {
        timeout: 30_000,
        intervals: [250, 500, 1000],
        message: `Expected the dashboard to show a balance of ${formatted}`,
      },
    )
    .toBe(true);
}
