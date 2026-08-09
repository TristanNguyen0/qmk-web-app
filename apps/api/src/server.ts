/**
 * API entrypoint. Loads published catalogs, connects to Postgres, serves the API.
 *
 * Usage: node --experimental-strip-types apps/api/src/server.ts
 * Env:
 *   QWA_CATALOG_DIR    default <repo>/catalogs
 *   QWA_DATABASE_URL   default postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa
 *   QWA_SESSION_SECRET required in production; a dev default is used otherwise
 *   PORT               default 3001
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { buildApp } from './app.ts';
import { CatalogStore } from './catalog-store.ts';
import { PostgresConfigurationRepository } from './configurations/postgres-repository.ts';
import { runMigrations } from './db/migrate.ts';
import { REPO_ROOT } from '../../../infra/qmk/manifest.ts';

const isProduction = process.env['NODE_ENV'] === 'production';

// Resolve the default against the repo root, not the working directory: `pnpm dev`
// runs this script with cwd set to apps/api, where `catalogs` does not exist.
const catalogDir = process.env['QWA_CATALOG_DIR']
  ? resolve(process.env['QWA_CATALOG_DIR'])
  : resolve(REPO_ROOT, 'catalogs');
const port = Number(process.env['PORT'] ?? 3001);
const databaseUrl =
  process.env['QWA_DATABASE_URL'] ?? 'postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa';

// A hardcoded dev secret is fine locally and unacceptable in production: it would let
// anyone mint a session cookie for any owner id and read other users' configurations.
const sessionSecret = process.env['QWA_SESSION_SECRET'] ?? 'dev-only-insecure-session-secret-0123456789';
if (isProduction && !process.env['QWA_SESSION_SECRET']) {
  console.error('QWA_SESSION_SECRET must be set when NODE_ENV=production');
  process.exit(1);
}

if (!existsSync(catalogDir)) {
  // A missing catalog is the most likely first-run problem, so say exactly how to fix
  // it rather than throwing a bare ENOENT.
  console.error(
    `No catalog directory at ${catalogDir}.\n` +
      `Publish one first:\n\n` +
      `  pnpm catalog:build                       # all keyboards (~10 min)\n` +
      `  pnpm catalog:build --keyboard crkbd/rev1 # or just one, to get going\n`,
  );
  process.exit(1);
}

const store = CatalogStore.fromDirectory(catalogDir);

const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });

try {
  await runMigrations(pool, (message) => console.log(message));
} catch (error) {
  console.error(
    `Database not ready: ${(error as Error).message}\n\n` +
      `Start it with:\n\n  docker compose -f infra/deploy/docker-compose.yml up -d\n`,
  );
  process.exit(1);
}

const app = buildApp({
  store,
  repository: new PostgresConfigurationRepository(pool),
  sessionSecret,
  secureCookies: isProduction,
  logger: true,
});

app.log.info(
  { catalogDir, versions: store.versions, active: store.activeVersion },
  'catalogs loaded',
);

await app.listen({ port, host: '127.0.0.1' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => pool.end());
  });
}
