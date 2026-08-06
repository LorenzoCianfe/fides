import { defineConfig, devices } from '@playwright/test';
// Constants only. Importing the stack here would pull testcontainers, and with
// it dockerode and @grpc/grpc-js, into Playwright's config load and break on
// CommonJS/ESM interop before any test runs.
import { WEB_URL } from './src/harness/ports';

/**
 * The stack is booted in global setup rather than through Playwright's
 * `webServer`: the API needs a `DATABASE_URL` that only exists once the
 * Testcontainers Postgres has started, which `webServer` has no way to await.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './src/harness/global-setup.ts',
  globalTeardown: './src/harness/global-teardown.ts',

  // The journey is one long causal chain against one database, and the suite
  // drives the back office as a shared singleton. Running it serially is
  // correctness, not caution.
  fullyParallel: false,
  workers: 1,

  // No retries. A flaky money-path test is a defect to investigate, and a retry
  // that passes on the second attempt hides exactly the race worth finding.
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },

  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      // Chromium only: the CDP virtual authenticator is what makes real
      // passkey ceremonies possible, and it has no equivalent elsewhere.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
