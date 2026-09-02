/**
 * API entrypoint. Loads published catalogs, connects to Postgres, serves the API.
 *
 * Usage: node --experimental-strip-types apps/api/src/server.ts
 * Env:
 *   QWA_CATALOG_DIR    default <repo>/catalogs
 *   QWA_DATABASE_URL   default postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa
 *   QWA_ARTIFACT_DIR   default <repo>/var/artifacts — must be shared with the worker
 *   QWA_SESSION_SECRET required in production; a dev default is used otherwise
 *   PORT               default 3001
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { FilesystemArtifactStore } from '@qmk-web-app/artifact-store';
import { buildApp } from './app.ts';
import { PostgresBuildStore } from '@qmk-web-app/build-queue';
import { CatalogStore } from './catalog-store.ts';
import { PostgresConfigurationRepository } from './configurations/postgres-repository.ts';
import { runMigrations } from './db/migrate.ts';
import { buildImageRef, loadManifest, REPO_ROOT } from '../../../infra/qmk/manifest.ts';

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

// The API reads artifacts from the same store the worker writes to. On one host that
// is a shared directory; ADR 0004 replaces it with S3 behind the same interface when
// the two stop sharing a filesystem.
const artifactDir = process.env['QWA_ARTIFACT_DIR']
  ? resolve(process.env['QWA_ARTIFACT_DIR'])
  : resolve(REPO_ROOT, 'var', 'artifacts');
mkdirSync(artifactDir, { recursive: true, mode: 0o750 });

const manifest = loadManifest();

const app = buildApp({
  store,
  repository: new PostgresConfigurationRepository(pool),
  builds: {
    repository: new PostgresBuildStore(pool),
    artifacts: new FilesystemArtifactStore(artifactDir),
    // What a build of this configuration is *expected* to run in. The worker records
    // the image it actually used, including its digest, when the build finishes.
    environment: {
      imageRef: buildImageRef(manifest),
      imageDigest: manifest.buildImage.digest,
    },
  },
  sessionSecret,
  secureCookies: isProduction,
  logger: true,
});

app.log.info(
  { catalogDir, artifactDir, versions: store.versions, active: store.activeVersion },
  'catalogs loaded',
);

await app.listen({ port, host: '127.0.0.1' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => pool.end());
  });
}
