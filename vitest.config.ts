import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    // Jana pages.generated.ts (diperlukan oleh suite cloud) pada fresh clone.
    globalSetup: ['./vitest.setup.mts'],
    coverage: {
      provider: 'v8',
      include: ['packages/shared/src/**/*.ts'],
      reporter: ['text', 'json-summary']
    },
    environment: 'node',
    // better-sqlite3 native load + plugin registration can exceed the 10s
    // default hookTimeout when suites cold-start in parallel on Windows.
    hookTimeout: 60000
  }
});
