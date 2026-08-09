import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'services/**/*.test.ts', 'apps/**/*.test.ts'],
    // Integration tests that need Docker and the pinned checkout opt in explicitly by
    // checking QWA_INTEGRATION, so the default run stays fast and hermetic.
    testTimeout: 30_000,
  },
});
