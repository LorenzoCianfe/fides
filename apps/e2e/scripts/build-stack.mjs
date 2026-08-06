import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ports from '../stack-ports.json' with { type: 'json' };

/**
 * Builds the API and web app the E2E suite runs.
 *
 * This exists because `NEXT_PUBLIC_API_URL` is inlined into the web bundle at
 * build time — it is also what the app's CSP `connect-src` allows — so the
 * bundle has to be built already knowing the suite's API origin. A plain
 * `pnpm build` produces one pointing at the default port instead, and the
 * failure would surface as blocked requests in a browser rather than as
 * anything resembling its cause.
 *
 * A Node script rather than an inline environment prefix in the npm script:
 * `VAR=value cmd` is shell syntax that does not work on Windows.
 *
 * Turborepo is invoked rather than the two builds directly, so the workspace
 * packages they depend on are built first. `NEXT_PUBLIC_API_URL` is declared in
 * `turbo.json`'s `build` task, which puts it in the cache key — without that,
 * turbo would happily serve a cached bundle built for a different origin.
 */
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

const child = spawn(
  'pnpm',
  ['exec', 'turbo', 'run', 'build', '--filter=@fides/api', '--filter=@fides/web'],
  {
    cwd: repoRoot,
    env: { ...process.env, NEXT_PUBLIC_API_URL: `http://localhost:${ports.api}` },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);

child.on('exit', (code) => process.exit(code ?? 1));
