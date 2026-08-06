import { expect, test } from '@playwright/test';
import { findCustomerId, fundCustomer } from '../src/harness/admin';
import { expectBalance, onboard } from '../src/harness/onboarding';

/**
 * The Phase 1 exit criteria, walked end to end through the real UI:
 *
 *   "A transfer moves value between two users with a balanced journal entry;
 *    balances reconcile; the flow is covered by integration and ledger-invariant
 *    tests; the action appears in the audit trail."
 *
 * One test rather than several, because this is one causal chain: a recipient
 * cannot be paid before they exist, and a sender cannot pay before an admin
 * has funded them. Split into independent tests, every one after the first
 * would be a fiction that silently depends on the others. `test.step` gives the
 * reporting granularity without the lie.
 *
 * Nothing here is stubbed. Passkeys are genuine WebAuthn ceremonies against
 * Chromium's virtual authenticator, verified by the server; funding runs the
 * real four-eyes path with two distinct operators; and the transfer clears the
 * SCA step-up whose challenge is bound to its exact parameters.
 */
test('a funded customer sends money to another customer', async ({ browser }) => {
  // A context each: separate cookie jars and separate authenticators, which is
  // what makes these two genuinely different users rather than two tabs.
  const senderContext = await browser.newContext();
  const recipientContext = await browser.newContext();

  try {
    const sender = await test.step('the sender onboards and enrols a passkey', () =>
      onboard(senderContext, 'sender'));

    const recipient = await test.step('the recipient onboards and enrols a passkey', () =>
      onboard(recipientContext, 'recipient'));

    await test.step('their accounts are provisioned with a zero balance', async () => {
      await expectBalance(sender.page, '€0.00');
      await expectBalance(recipient.page, '€0.00');
    });

    await test.step('the back office funds the sender under four eyes', async () => {
      // Two distinct operators: `super_admin` may approve but is denied the
      // request half, so a single admin cannot do this alone (ADR-0025).
      const senderId = await findCustomerId(sender.email);
      await fundCustomer(senderId, '10000');
      await expectBalance(sender.page, '€100.00');
    });

    await test.step('the sender signs out and back in with their passkey', async () => {
      await sender.page.getByRole('button', { name: 'Sign out' }).click();
      await expect(sender.page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

      await sender.page.getByLabel('Email address').fill(sender.email);
      await sender.page.getByRole('button', { name: 'Continue with passkey' }).click();

      await expect(sender.page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
      await expect(sender.page.getByText('€100.00', { exact: true })).toBeVisible();
    });

    await test.step('the sender pays the recipient through the SCA step-up', async () => {
      await sender.page.getByRole('link', { name: 'Send money' }).click();

      await sender.page.getByLabel('Recipient email').fill(recipient.email);
      await sender.page.getByLabel('Amount').fill('25.50');
      await sender.page.getByRole('button', { name: 'Continue' }).click();

      // The confirmation screen shows what the passkey is about to sign. The
      // server recomputes that hash from what it actually executes, so these
      // exact figures are what clears (ADR-0023).
      await expect(sender.page.getByText('Confirm this payment')).toBeVisible();
      await expect(sender.page.getByText('€25.50', { exact: true })).toBeVisible();
      await expect(sender.page.getByText(recipient.email)).toBeVisible();

      await sender.page.getByRole('button', { name: 'Confirm and send' }).click();

      await expect(sender.page.getByText(`Sent €25.50 to ${recipient.email}.`)).toBeVisible();
    });

    await test.step('the money left the sender and the movement is on their statement', async () => {
      await sender.page.getByRole('link', { name: 'Accounts' }).click();
      await expect(sender.page.getByText('€74.50', { exact: true })).toBeVisible();

      await sender.page.getByRole('link', { name: 'View activity' }).click();
      await expect(sender.page.getByRole('heading', { name: 'Activity' })).toBeVisible();
      // Signed as an outgoing movement, which is the ledger's view of it.
      await expect(sender.page.getByText('-€25.50', { exact: true }).first()).toBeVisible();
    });

    await test.step('and arrived with the recipient', async () => {
      await expectBalance(recipient.page, '€25.50');
    });
  } finally {
    await senderContext.close();
    await recipientContext.close();
  }
});
