import type { Page } from '@playwright/test';
import { API_URL } from './ports';

/**
 * Echo failed API calls into the test output.
 *
 * Without this, a rejected request surfaces only as the client's deliberately
 * vague "Something went wrong" — which is correct for a user and useless for
 * diagnosis. The server's canonical error envelope carries the code and the
 * correlation id, and printing it turns a mystery into a one-line answer.
 */
export function attachApiDiagnostics(page: Page): void {
  page.on('response', (response) => {
    const url = response.url();
    if (!url.startsWith(API_URL) || response.ok()) return;

    void response
      .text()
      .then((body) => {
        console.error(`[api ${response.status()}] ${response.request().method()} ${url} ${body}`);
      })
      .catch(() => {
        // A body that cannot be read is not worth failing the test over.
      });
  });

  page.on('pageerror', (error) => console.error(`[page error] ${error.message}`));
}
