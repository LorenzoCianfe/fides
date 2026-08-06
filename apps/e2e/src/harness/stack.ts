import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { API_PORT, API_URL, WEB_PORT, WEB_URL } from './ports';

/**
 * Boots the real stack the browser will drive: an ephemeral Postgres, the built
 * API, and the built web app.
 *
 * Deliberately the *built* artifacts rather than dev servers. This suite exists
 * to prove the deployable thing works end to end; a dev server differs from it
 * in exactly the ways (bundling, environment inlining, minification) that break
 * quietly in production.
 */

// `__dirname` rather than `import.meta.url`: this package is CommonJS on
// purpose (see package.json), so the ESM-only form is unavailable.
const REPO_ROOT = resolve(__dirname, '../../../..');
const API_DIR = resolve(REPO_ROOT, 'apps/api');
const WEB_DIR = resolve(REPO_ROOT, 'apps/web');

export { API_PORT, API_URL, WEB_PORT, WEB_URL } from './ports';

/**
 * The bootstrapped back-office account. It is the funding **checker**:
 * `super_admin` is deliberately denied the maker half (ADR-0025), so the suite
 * has to create a second operator to propose funding at all — which is the
 * segregation of duties being exercised rather than described.
 */
export const BOOTSTRAP_ADMIN = {
  email: 'ops@fides.local',
  password: 'e2e-bootstrap-password-not-a-secret',
} as const;

export interface Stack {
  readonly databaseUrl: string;
}

interface Running {
  container: StartedPostgreSqlContainer;
  api: ChildProcess;
  web: ChildProcess;
}

let running: Running | undefined;

/**
 * The connection string is handed to the test workers through the environment.
 *
 * Playwright runs specs in worker processes, so a module-level variable set in
 * global setup is simply not there when a spec reads it — the workers are
 * forked from the main process after setup completes, and inherit its `env`.
 * That inheritance is the supported channel for exactly this.
 */
const DATABASE_URL_VAR = 'FIDES_E2E_DATABASE_URL';

/** The booted stack. Throws rather than returning undefined so a mis-ordered import fails loudly. */
export function currentStack(): Stack {
  const databaseUrl = process.env[DATABASE_URL_VAR];
  if (!databaseUrl) {
    throw new Error('The E2E stack is not running; global setup did not complete');
  }
  return { databaseUrl };
}

function requireBuild(path: string, hint: string): void {
  if (existsSync(path)) return;
  throw new Error(
    `Missing build output at ${path}.\nThe E2E suite runs the built apps. Run: ${hint}`,
  );
}

/**
 * Confirm the web bundle was built for *this* suite's API origin.
 *
 * A plain `pnpm build` produces a perfectly valid bundle pointing at the
 * default port, and `requireBuild` cannot tell the difference — the directory
 * is there either way. Left undetected it surfaces as requests blocked by a CSP
 * naming the wrong origin, which looks nothing like its cause. Since
 * `NEXT_PUBLIC_API_URL` is inlined verbatim, the built chunks can simply be
 * searched for it.
 */
function requireBuildTargetsThisApi(hint: string): void {
  const chunks = resolve(WEB_DIR, '.next/static/chunks');
  if (!existsSync(chunks)) return;

  const found = readdirSync(chunks, { recursive: true, encoding: 'utf8' }).some((entry) => {
    if (!entry.endsWith('.js')) return false;
    try {
      return readFileSync(resolve(chunks, entry), 'utf8').includes(API_URL);
    } catch {
      return false;
    }
  });

  if (found) return;
  throw new Error(
    `The web bundle in ${WEB_DIR} was not built for ${API_URL}.\n` +
      'NEXT_PUBLIC_API_URL is inlined at build time (and feeds the app CSP), so a\n' +
      `plain \`pnpm build\` points it at the default port. Rebuild with: ${hint}`,
  );
}

/**
 * Fail early if something already owns the port. Without this the suite would
 * silently drive whatever is listening — a developer's own stack, against their
 * own database — and report failures that have nothing to do with the code.
 */
async function assertPortFree(port: number, what: string): Promise<void> {
  try {
    await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(1000) });
  } catch {
    return; // Nothing listening, which is what we want.
  }
  throw new Error(
    `Port ${port} is already in use, and the E2E suite needs it for the ${what}.\n` +
      'Stop your local stack (pnpm stack:down, or whatever is serving it) and re-run.',
  );
}

/** Resolve when the URL answers, or throw once the deadline passes. */
async function waitForHttp(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      // Any answer proves the listener is up; the status is the route's business.
      if (response.status > 0) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}

/**
 * Both servers are Node scripts, so they are launched with `process.execPath`
 * and **no shell**. A shell would become the direct child, and killing it
 * leaves the actual server running — which on Windows means the next run finds
 * the port taken and refuses to start. `detached` on POSIX puts each server in
 * its own process group so the whole group can be signalled.
 */
function spawnProcess(
  script: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  label: string,
): ChildProcess {
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  // Surfaced with a prefix: when a spec fails because the API rejected
  // something, that server log is the fastest route to the cause.
  child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[${label}] ${chunk}`));
  // Without these, a server that fails to spawn or exits immediately shows up
  // only as an opaque timeout waiting for a port that was never going to open.
  child.on('error', (error) =>
    process.stderr.write(`[${label}] failed to start: ${String(error)}\n`),
  );
  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) process.stderr.write(`[${label}] exited with code ${code}\n`);
    else if (signal) process.stderr.write(`[${label}] terminated by ${signal}\n`);
  });
  return child;
}

/**
 * Kill a server and everything it spawned. `next start` in particular runs its
 * server in a child process, so signalling only the direct child would leave
 * the listener holding the port.
 */
function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null) return;

  if (process.platform === 'win32') {
    // No process groups on Windows; taskkill /T walks the tree instead.
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    // Negative pid signals the whole group, which `detached` created.
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGKILL');
  }
}

export async function startStack(): Promise<Stack> {
  // Both must come from `build:stack`, not a plain `pnpm build`: the web bundle
  // inlines the API origin, so one built for the default port cannot talk to
  // this suite's API and fails as blocked requests rather than as a clear error.
  const buildCommand = 'pnpm --filter @fides/e2e run build:stack';
  requireBuild(resolve(API_DIR, 'dist/main.js'), buildCommand);
  requireBuild(resolve(WEB_DIR, '.next'), buildCommand);
  requireBuildTargetsThisApi(buildCommand);

  await Promise.all([assertPortFree(API_PORT, 'API'), assertPortFree(WEB_PORT, 'web app')]);

  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const databaseUrl = container.getConnectionUri();

  // The committed migrations, so the suite runs against the real schema path.
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: resolve(API_DIR, 'drizzle') });
  } finally {
    await client.end();
  }

  const api = spawnProcess(
    'dist/main.js',
    [],
    API_DIR,
    {
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl,
      API_PORT: String(API_PORT),
      LOG_LEVEL: 'warn',
      // `localhost` is a secure context for WebAuthn, which is what lets the
      // virtual authenticator work without TLS.
      WEBAUTHN_RP_ID: 'localhost',
      WEBAUTHN_ORIGINS: WEB_URL,
      // Web and API differ only by port, so they are same-site and the
      // SameSite=Strict cookie pair from ADR-0027 is delivered.
      COOKIE_SECURE: 'false',
      COOKIE_SAMESITE: 'strict',
      SCHEDULERS_ENABLED: 'true',
      // Account provisioning is event-driven off `kyc.approved` (ADR-0022).
      // A short interval keeps the suite from waiting seconds on the dispatcher.
      OUTBOX_DISPATCH_INTERVAL_MS: '250',
      // Throttling off: the suite drives the same routes far faster than a human
      // would, and rate limiting is covered by the API's own integration tests.
      THROTTLE_ENABLED: 'false',
      ADMIN_BOOTSTRAP_EMAIL: BOOTSTRAP_ADMIN.email,
      ADMIN_BOOTSTRAP_PASSWORD: BOOTSTRAP_ADMIN.password,
    },
    'api',
  );

  // Resolved from the web app rather than assumed at the workspace root: pnpm
  // does not hoist, so `next` lives under `apps/web/node_modules` by way of the
  // virtual store, and a hard-coded root path simply does not exist.
  const nextBin = require.resolve('next/dist/bin/next', { paths: [WEB_DIR] });
  const web = spawnProcess(
    nextBin,
    ['start', '-p', String(WEB_PORT)],
    WEB_DIR,
    { NODE_ENV: 'production' },
    'web',
  );

  running = { container, api, web };

  await Promise.all([waitForHttp(`${API_URL}/v1/health`), waitForHttp(WEB_URL)]);

  // Set last, so a worker can never observe a URL for a stack that is not ready.
  process.env[DATABASE_URL_VAR] = databaseUrl;
  return { databaseUrl };
}

export async function stopStack(): Promise<void> {
  delete process.env[DATABASE_URL_VAR];
  if (!running) return;
  const { container, api, web } = running;
  running = undefined;

  killTree(api);
  killTree(web);
  await container.stop();
}
