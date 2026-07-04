import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
    setupFiles: ['reflect-metadata'],
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
