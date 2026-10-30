import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Keep test output readable: the app logger is silenced via LOG_LEVEL in tests/setup.ts
    setupFiles: ['tests/setup.ts'],
  },
});
