import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next.js compiles TSX with the automatic runtime (no `import React`); component
  // render tests need the same setting or every .tsx import fails on `React`.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['packages/**/*.test.ts', 'services/**/*.test.ts', 'apps/**/*.test.ts'],
    // Integration tests that need Docker and the pinned checkout opt in explicitly by
    // checking QWA_INTEGRATION, so the default run stays fast and hermetic.
    testTimeout: 30_000,
    // Several suites (apps/api/src/builds/store-contract.test.ts,
    // apps/api/src/routes/builds.test.ts, apps/api/src/routes/configurations.test.ts,
    // apps/api/src/configurations/repository-contract.test.ts) share one live
    // Postgres instance and each clears its own tables in beforeEach. Running test
    // FILES concurrently — legal under Vitest's default file parallelism — lets one
    // file's DELETE race another file's still-in-flight assertions against the same
    // rows. Serializing file execution is the correct fix for a shared external
    // dependency with no per-file isolation, not a version-specific workaround.
    fileParallelism: false,
  },
});
