import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/shared/src/**/*.ts'],
      reporter: ['text', 'json-summary']
    },
    environment: 'node'
  }
});
