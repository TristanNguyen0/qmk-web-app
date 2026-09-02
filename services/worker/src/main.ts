/**
 * Build worker entrypoint.
 *
 * Usage: node --experimental-strip-types services/worker/src/main.ts
 * Env:
 *   QWA_CATALOG_DIR     default <repo>/catalogs
 *   QWA_ARTIFACT_DIR    default <repo>/var/artifacts — must be shared with the API
 *   QWA_WORKSPACE_ROOT  default the OS temp directory
 *   QWA_DATABASE_URL    default postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa
 *                       In deployment this must be the narrow `qwa_worker` role from
 *                       apps/api/migrations/003_worker_role.sql, not the API's role.
 *   QWA_WORKER_ID       default a random id per process
 *
 * The worker never runs migrations: schema ownership belongs to the API, and a worker
 * with DDL rights would defeat the point of the restricted role.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import pg from 'pg';
import { FilesystemArtifactStore } from '@qmk-web-app/artifact-store';
import { PostgresBuildStore } from '@qmk-web-app/build-queue';
import { DockerSandbox } from '@qmk-web-app/qmk-sandbox';
import { loadPublishedCatalogs } from './catalog-provider.ts';
import { QueueRunner, type QueueRunnerEvent } from './queue-runner.ts';
import { buildImageRef, loadManifest, qmkSourcePath, REPO_ROOT } from '../../../infra/qmk/manifest.ts';

/** Housekeeping cadence: lease recovery and artifact expiry. */
const MAINTENANCE_INTERVAL_MS = 60_000;

const catalogDir = process.env['QWA_CATALOG_DIR']
  ? resolve(process.env['QWA_CATALOG_DIR'])
  : resolve(REPO_ROOT, 'catalogs');
const artifactDir = process.env['QWA_ARTIFACT_DIR']
  ? resolve(process.env['QWA_ARTIFACT_DIR'])
  : resolve(REPO_ROOT, 'var', 'artifacts');
const databaseUrl =
  process.env['QWA_DATABASE_URL'] ?? 'postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa';
const workerId = process.env['QWA_WORKER_ID'] ?? `${hostname()}-${randomUUID().slice(0, 8)}`;

function log(event: QueueRunnerEvent): void {
  // Structured JSON, per ADR 0001 — one line per event, no interpolation into a message.
  const { level, ...rest } = event;
  console.log(JSON.stringify({ level, worker: workerId, time: new Date().toISOString(), ...rest }));
}

if (!existsSync(catalogDir)) {
  console.error(
    `No catalog directory at ${catalogDir}.\n\n` +
      `  pnpm catalog:build --keyboard crkbd/rev1   # publish one to get going\n`,
  );
  process.exit(1);
}

const manifest = loadManifest();
const sourcePath = qmkSourcePath(manifest);
if (!existsSync(sourcePath)) {
  console.error(
    `No pinned QMK checkout at ${sourcePath}.\n\n` + `  pnpm qmk:fetch --submodules\n`,
  );
  process.exit(1);
}

const { provider, versions } = loadPublishedCatalogs(catalogDir);
if (versions.length === 0) {
  console.error(`No published catalogs found in ${catalogDir}.`);
  process.exit(1);
}

mkdirSync(artifactDir, { recursive: true, mode: 0o750 });

const sandbox = new DockerSandbox({
  imageRef: buildImageRef(manifest),
  qmkSourcePath: sourcePath,
});

try {
  // Fails fast on a missing image or an unusable pinned tree, rather than failing the
  // first real build a user submits.
  await sandbox.verify();
} catch (error) {
  console.error(
    `Build sandbox is not usable: ${(error as Error).message}\n\n` +
      `  docker build -t ${buildImageRef(manifest)} infra/qmk\n`,
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
try {
  await pool.query('SELECT 1');
} catch (error) {
  console.error(
    `Database not reachable: ${(error as Error).message}\n\n` +
      `  docker compose -f infra/deploy/docker-compose.yml up -d\n`,
  );
  process.exit(1);
}

const runner = new QueueRunner({
  workerId,
  queue: new PostgresBuildStore(pool),
  artifacts: new FilesystemArtifactStore(artifactDir),
  sandbox,
  catalogs: provider,
  ...(process.env['QWA_WORKSPACE_ROOT']
    ? { workspaceRoot: resolve(process.env['QWA_WORKSPACE_ROOT']) }
    : {}),
  // Absolute paths that must never appear in a log a user can read.
  redactPaths: [sourcePath, artifactDir, REPO_ROOT],
  log,
});

log({ level: 'info', message: 'worker started', catalogVersions: versions, artifactDir });

const maintenance = setInterval(() => {
  void runner.maintain().catch((error: Error) => {
    log({ level: 'warn', message: 'maintenance failed', error: error.message });
  });
}, MAINTENANCE_INTERVAL_MS);

// One pass at startup: a worker restarting after a crash is the most likely reason a
// build is sitting in `preparing` with nobody holding it.
await runner.maintain().catch(() => {});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log({ level: 'info', message: 'shutting down after the current build' });
    clearInterval(maintenance);
    runner.stop();
  });
}

await runner.start();
await pool.end();
log({ level: 'info', message: 'worker stopped' });
