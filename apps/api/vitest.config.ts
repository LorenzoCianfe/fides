import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
    setupFiles: ['reflect-metadata', './test/setup-env.ts'],
    // Boots one Postgres container for the run and applies migrations. Requires
    // a running Docker daemon (integration tests run under `pnpm test`).
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one database; run test files serially so they do
    // not truncate each other's data mid-run.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 60_000,
  },
  esbuild: {
    // NestJS relies on legacy decorators; enable them for the esbuild transform.
    tsconfigRaw: {
      compilerOptions: {
        target: 'es2022',
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
});
