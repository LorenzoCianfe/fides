import ports from '../../stack-ports.json';

/**
 * Where the stack listens.
 *
 * Deliberately its own module with **no runtime imports beyond the port file**.
 * `playwright.config.ts` needs the base URL, and Playwright loads that config
 * through its own transform; importing `stack.ts` there would drag
 * `testcontainers` -> `dockerode` -> `@grpc/grpc-js` into the config load and
 * fail before a single test runs.
 *
 * The numbers live in JSON because `scripts/build-stack.mjs` needs them too and
 * cannot import TypeScript. One file, both readers, no drift.
 *
 * Dedicated ports rather than the repo's 3000/3001 defaults: those are the most
 * contended ports on any development machine, and one unrelated dev server
 * would either block the suite or, worse, have it drive someone else's
 * application. The cost is that the web bundle must be built already knowing
 * this API origin, because `NEXT_PUBLIC_API_URL` is inlined at build time and
 * also feeds that app's CSP `connect-src` — which is what `build-stack.mjs`
 * exists to do.
 */
export const API_PORT: number = ports.api;
export const WEB_PORT: number = ports.web;
export const API_URL = `http://localhost:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
