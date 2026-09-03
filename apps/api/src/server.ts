/**
 * API entrypoint. Loads published catalogs, connects to Postgres, serves the API.
 *
 * Usage: node --experimental-strip-types apps/api/src/server.ts
 * Env:
 *   QWA_CATALOG_DIR    default <repo>/catalogs
 *   QWA_DATABASE_URL   default postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa
 *   QWA_ARTIFACT_DIR   default <repo>/var/artifacts — must be shared with the worker
 *   QWA_SESSION_SECRET required in every environment — there is no fallback. Generate
 *                      one with:
 *                        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   QWA_TRUST_PROXY    the reverse-proxy hop (an IP address, a CIDR, or a comma-
 *                      separated list of either) allowed to set X-Forwarded-For.
 *                      Required in production; unset means "trust nothing" in
 *                      development, so request.ip is the raw socket address. The API
 *                      must sit behind a reverse proxy that sets this header in
 *                      production — QWA_TRUST_PROXY must name that hop, never `true`.
 *   QWA_OTEL_EXPORTER_URL  OTLP/HTTP metrics collector endpoint. Unset disables
 *                      telemetry entirely (see apps/api/src/observability/otel.ts) —
 *                      no collector is required to run this process.
 *   PORT               default 3001
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { FilesystemArtifactStore } from '@qmk-web-app/artifact-store';
import { buildApp } from './app.ts';
import { parseTrustProxy, requireEnv } from './config.ts';
import { PostgresBuildStore } from '@qmk-web-app/build-queue';
import { CatalogStore } from './catalog-store.ts';
import { PostgresConfigurationRepository } from './configurations/postgres-repository.ts';
import { runMigrations } from './db/migrate.ts';
import { registerQueueDepthGauge } from './observability/metrics.ts';
import { shutdownTelemetry, startTelemetry } from './observability/otel.ts';
import { buildImageRef, loadManifest, REPO_ROOT } from '../../../infra/qmk/manifest.ts';

const isProduction = process.env['NODE_ENV'] === 'production';

// Started before buildApp: everything downstream that records a metric only ever does
// so lazily (see observability/metrics.ts's header for why), so start order relative to
// route registration does not matter — but starting here, once, up front is the
// simplest place that is unambiguously "before anything could try to record".
const telemetry = startTelemetry({
  log: (event) => console.warn(JSON.stringify({ source: 'telemetry', ...event })),
});

// Resolve the default against the repo root, not the working directory: `pnpm dev`
// runs this script with cwd set to apps/api, where `catalogs` does not exist.
const catalogDir = process.env['QWA_CATALOG_DIR']
  ? resolve(process.env['QWA_CATALOG_DIR'])
  : resolve(REPO_ROOT, 'catalogs');
const port = Number(process.env['PORT'] ?? 3001);
const databaseUrl =
  process.env['QWA_DATABASE_URL'] ?? 'postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa';

// No fallback in any environment: a guessable secret would let anyone mint a session
// cookie for any owner id and read another session's configurations (D-04).
let sessionSecret: string;
try {
  sessionSecret = requireEnv('QWA_SESSION_SECRET', process.env, {
    hint:
      'Generate one with:\n\n' +
      `  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"\n`,
  });
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

// D-14: request.ip is only as trustworthy as trustProxy is correctly configured.
// Unconfigured in production means every visitor collapses into the proxy's own
// address, silently defeating the session-issuance rate limit for everyone at once.
let trustProxy: string | string[] | false;
try {
  trustProxy = parseTrustProxy(process.env['QWA_TRUST_PROXY'], { production: isProduction });
} catch (error) {
  console.error((error as Error).message);
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
const buildRepository = new PostgresBuildStore(pool);

const app = buildApp({
  store,
  repository: new PostgresConfigurationRepository(pool),
  builds: {
    repository: buildRepository,
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
  trustProxy,
  logger: true,
});

// `countActiveGlobal()` is the same admission-cap read 05-01 added; the gauge is its
// second consumer, not a duplicate implementation.
registerQueueDepthGauge(buildRepository, {
  log: (event) => app.log.warn({ error: event.error }, event.message),
});

app.log.info(
  { catalogDir, artifactDir, versions: store.versions, active: store.activeVersion, telemetry: telemetry.enabled },
  'catalogs loaded',
);

await app.listen({ port, host: '127.0.0.1' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    // Flush the last export window before the process exits, alongside the existing
    // cleanup — otherwise a shutdown can drop up to one full collection interval.
    void app
      .close()
      .then(() => pool.end())
      .then(() => shutdownTelemetry());
  });
}
