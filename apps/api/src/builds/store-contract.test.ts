/**
 * One suite, both build stores.
 *
 * Same reasoning as the configuration repository contract: the in-memory store exists
 * so route and worker tests stay hermetic, which is only safe if it behaves like the
 * real one. The properties checked here are the ones a lenient fake would hide —
 * idempotency, single-claimant queue semantics, lease-guarded writes, and ownership
 * scoping.
 *
 * The Postgres half is skipped unless a database is reachable:
 *   docker compose -f infra/deploy/docker-compose.yml up -d
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { BuildRecord, Configuration } from '@qmk-web-app/domain';
import { runMigrations } from '../db/migrate.ts';
import { InMemoryConfigurationRepository } from '../configurations/memory-repository.ts';
import { PostgresConfigurationRepository } from '../configurations/postgres-repository.ts';
import type { ConfigurationRecord, ConfigurationRepository } from '../configurations/types.ts';
import { InMemoryBuildStore, PostgresBuildStore } from '@qmk-web-app/build-queue';
import type { BuildQueue, BuildRepository } from '@qmk-web-app/build-queue';

const DATABASE_URL =
  process.env['QWA_TEST_DATABASE_URL'] ??
  process.env['QWA_DATABASE_URL'] ??
  'postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa';

async function postgresAvailable(): Promise<pg.Pool | null> {
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 1500,
  });
  try {
    await pool.query('SELECT 1');
    await runMigrations(pool);
    return pool;
  } catch {
    await pool.end().catch(() => {});
    return null;
  }
}

const pool = await postgresAvailable();

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const WORKER = 'worker-1';
const OTHER_WORKER = 'worker-2';

function configurationDocument(id: string, ownerId: string): Configuration {
  const now = new Date().toISOString();
  return {
    id,
    ownerId,
    schemaVersion: 1,
    catalogVersion: '0.33.13-1',
    qmkCommit: 'a'.repeat(40),
    keyboardId: 'crkbd/rev1',
    layoutId: 'LAYOUT_split_3x6_3',
    name: 'Test',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    layers: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        index: 0,
        name: 'Base',
        bindings: { '0': { kind: 'keycode', keycode: 'KC_A' } },
      },
    ],
    macros: [],
    socd: null,
    generatorVersion: '1',
  } as Configuration;
}

function configurationRecord(id: string, ownerId: string): ConfigurationRecord {
  const document = configurationDocument(id, ownerId);
  return {
    id,
    ownerId,
    schemaVersion: 1,
    catalogVersion: document.catalogVersion,
    qmkCommit: document.qmkCommit,
    keyboardId: document.keyboardId,
    layoutId: document.layoutId,
    name: document.name,
    revision: 1,
    isDraft: false,
    document,
    generatorVersion: '1',
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function buildRecord(
  configurationId: string,
  ownerId: string,
  overrides: Partial<BuildRecord> = {},
): BuildRecord {
  return {
    id: randomUUID(),
    configurationId,
    configurationRevision: 1,
    ownerId,
    catalogVersion: '0.33.13-1',
    qmkCommit: 'a'.repeat(40),
    generatorVersion: '1',
    socdModuleVersion: null,
    buildImageRef: 'qmk-web-app/qmk-build:test',
    buildImageDigest: null,
    status: 'queued',
    idempotencyKey: randomUUID(),
    requestedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    attemptCount: 0,
    artifactId: null,
    outputFormat: null,
    logReference: null,
    failureCode: null,
    ...overrides,
  };
}

interface Backend {
  builds: BuildRepository & BuildQueue;
  configurations: ConfigurationRepository;
  /** Seeds a configuration and returns its id, so builds have a revision to cite. */
  seedConfiguration(ownerId: string): Promise<string>;
}

function artifactArgs(buildId: string, overrides: { expiresAt?: string } = {}) {
  return {
    id: randomUUID(),
    storageKey: `builds/${buildId}/firmware`,
    originalFilename: 'crkbd_rev1_qwa_build.hex',
    byteSize: 20624,
    sha256: 'b'.repeat(64),
    contentType: 'application/octet-stream',
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString(),
  };
}

/** Walks a claimed build to `uploading`, where `complete` is legal. */
async function toUploading(queue: BuildQueue, buildId: string, workerId = WORKER) {
  expect(await queue.advance({ buildId, workerId, from: 'preparing', to: 'building' })).toBe(true);
  expect(await queue.advance({ buildId, workerId, from: 'building', to: 'uploading' })).toBe(true);
}

function contractFor(name: string, makeBackend: () => Promise<Backend>) {
  describe(name, () => {
    let backend: Backend;
    let builds: BuildRepository & BuildQueue;
    let configurationId: string;

    beforeEach(async () => {
      backend = await makeBackend();
      builds = backend.builds;
      configurationId = await backend.seedConfiguration(ALICE);
    });

    describe('creation and idempotency', () => {
      it('creates a build and reports it as new', async () => {
        const result = await builds.create(buildRecord(configurationId, ALICE));
        expect(result.created).toBe(true);
        expect(result.build.status).toBe('queued');
      });

      it('returns the existing build for a repeated idempotency key', async () => {
        const record = buildRecord(configurationId, ALICE);
        const first = await builds.create(record);
        // A retried submission carries the same key but a fresh build id; the store
        // must return the original rather than creating a second compile.
        const second = await builds.create({ ...record, id: randomUUID() });

        expect(second.created).toBe(false);
        expect(second.build.id).toBe(first.build.id);
      });

      it('scopes idempotency keys per owner', async () => {
        const key = 'shared-key';
        const aliceConfig = configurationId;
        const bobConfig = await backend.seedConfiguration(BOB);

        await builds.create(buildRecord(aliceConfig, ALICE, { idempotencyKey: key }));
        const bob = await builds.create(buildRecord(bobConfig, BOB, { idempotencyKey: key }));

        // Otherwise one session could occupy another session's key namespace, or probe
        // which keys it had used.
        expect(bob.created).toBe(true);
      });
    });

    describe('ownership', () => {
      it('hides another owner’s build entirely', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        expect(await builds.get(build.id, BOB)).toBeNull();
        expect(await builds.getArtifact(build.id, BOB)).toBeNull();
        expect(await builds.requestCancellation(build.id, BOB)).toBeNull();
      });

      it('does not list another owner’s builds for the same configuration', async () => {
        await builds.create(buildRecord(configurationId, ALICE));
        const page = await builds.listForConfiguration(configurationId, BOB, {
          page: 1,
          pageSize: 10,
        });
        expect(page.totalItems).toBe(0);
      });

      it('refuses an artifact to a different owner even after success', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        await toUploading(builds, build.id);
        await builds.complete({
          buildId: build.id,
          workerId: WORKER,
          artifact: artifactArgs(build.id),
          outputFormat: 'hex',
          logReference: `builds/${build.id}/log`,
          buildImageRef: 'qmk-web-app/qmk-build:test',
          buildImageDigest: null,
          generatorVersion: '1',
          socdModuleVersion: null,
        });

        expect(await builds.getArtifact(build.id, ALICE)).not.toBeNull();
        expect(await builds.getArtifact(build.id, BOB)).toBeNull();
      });
    });

    describe('queue', () => {
      it('hands one build to exactly one worker', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));

        const first = await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        const second = await builds.claim({ workerId: OTHER_WORKER, leaseMs: 60_000 });

        expect(first?.buildId).toBe(build.id);
        // The queue is now empty; the second worker must get nothing rather than the
        // same build.
        expect(second).toBeNull();
      });

      it('claims in request order', async () => {
        const older = await builds.create(
          buildRecord(configurationId, ALICE, {
            requestedAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        );
        const newer = await builds.create(buildRecord(configurationId, ALICE));

        expect((await builds.claim({ workerId: WORKER, leaseMs: 60_000 }))?.buildId).toBe(
          older.build.id,
        );
        expect((await builds.claim({ workerId: OTHER_WORKER, leaseMs: 60_000 }))?.buildId).toBe(
          newer.build.id,
        );
      });

      it('records the attempt and moves the build to preparing', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        const claimed = await builds.claim({ workerId: WORKER, leaseMs: 60_000 });

        expect(claimed?.attemptCount).toBe(1);
        const stored = await builds.get(build.id, ALICE);
        expect(stored?.status).toBe('preparing');
        expect(stored?.startedAt).not.toBeNull();
      });

      it('returns null when the queue is empty', async () => {
        expect(await builds.claim({ workerId: WORKER, leaseMs: 60_000 })).toBeNull();
      });

      it('refuses writes from a worker that does not hold the lease', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });

        // This is the property that makes an expired lease safe: the old worker cannot
        // finish a build the new one has taken over.
        expect(
          await builds.advance({
            buildId: build.id,
            workerId: OTHER_WORKER,
            from: 'preparing',
            to: 'building',
          }),
        ).toBe(false);
        expect(
          await builds.heartbeat({ buildId: build.id, workerId: OTHER_WORKER, leaseMs: 1000 }),
        ).toBeNull();
        expect(
          await builds.fail({
            buildId: build.id,
            workerId: OTHER_WORKER,
            failureCode: 'COMPILE_FAILED',
            logReference: null,
          }),
        ).toBe(false);
      });

      it('refuses an advance from a status the build is not in', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        expect(
          await builds.advance({
            buildId: build.id,
            workerId: WORKER,
            from: 'building',
            to: 'uploading',
          }),
        ).toBe(false);
      });

      it('throws rather than performing an illegal transition', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        await expect(
          builds.advance({
            buildId: build.id,
            workerId: WORKER,
            from: 'preparing',
            to: 'succeeded',
          }),
        ).rejects.toThrow(/illegal build state transition/);
      });

      it('reports a cancellation request through the heartbeat', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });

        expect(
          (await builds.heartbeat({ buildId: build.id, workerId: WORKER, leaseMs: 60_000 }))
            ?.cancelRequested,
        ).toBe(false);

        expect(await builds.requestCancellation(build.id, ALICE)).toBe('requested');

        expect(
          (await builds.heartbeat({ buildId: build.id, workerId: WORKER, leaseMs: 60_000 }))
            ?.cancelRequested,
        ).toBe(true);
      });

      it('cancels a queued build outright, and it is never claimed', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        expect(await builds.requestCancellation(build.id, ALICE)).toBe('cancelled');

        expect(await builds.claim({ workerId: WORKER, leaseMs: 60_000 })).toBeNull();
        expect((await builds.get(build.id, ALICE))?.status).toBe('cancelled');
      });

      it('keeps the log of a build cancelled mid-compile', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        await builds.requestCancellation(build.id, ALICE);

        expect(
          await builds.cancel({
            buildId: build.id,
            workerId: WORKER,
            logReference: `builds/${build.id}/log`,
          }),
        ).toBe(true);

        // Referenced, so the owner can read it and the reaper can eventually delete it.
        expect((await builds.get(build.id, ALICE))?.logReference).toBe(`builds/${build.id}/log`);
      });

      it('treats cancelling a finished build as a no-op', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        await builds.fail({
          buildId: build.id,
          workerId: WORKER,
          failureCode: 'COMPILE_FAILED',
          logReference: null,
        });
        expect(await builds.requestCancellation(build.id, ALICE)).toBe('already_finished');
      });

      it('requeues a build whose lease expired, then fails it once attempts run out', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));

        // A lease of 0 ms is already expired when the reclaimer runs.
        await builds.claim({ workerId: WORKER, leaseMs: 0 });
        expect(await builds.reclaimExpiredLeases({ maxAttempts: 2 })).toEqual({
          requeued: 1,
          failed: 0,
        });
        expect((await builds.get(build.id, ALICE))?.status).toBe('queued');

        await builds.claim({ workerId: WORKER, leaseMs: 0 });
        expect(await builds.reclaimExpiredLeases({ maxAttempts: 2 })).toEqual({
          requeued: 0,
          failed: 1,
        });

        const finished = await builds.get(build.id, ALICE);
        expect(finished?.status).toBe('failed');
        expect(finished?.failureCode).toBe('SANDBOX_ERROR');
      });

      it('leaves a live lease alone', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        expect(await builds.reclaimExpiredLeases({ maxAttempts: 3 })).toEqual({
          requeued: 0,
          failed: 0,
        });
        expect((await builds.get(build.id, ALICE))?.status).toBe('preparing');
      });
    });

    describe('completion', () => {
      it('records the artifact and the reproducibility triple', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        await toUploading(builds, build.id);

        const artifact = artifactArgs(build.id);
        expect(
          await builds.complete({
            buildId: build.id,
            workerId: WORKER,
            artifact,
            outputFormat: 'hex',
            logReference: `builds/${build.id}/log`,
            buildImageRef: 'qmk-web-app/qmk-build:0.33.13-1',
            buildImageDigest: 'sha256:' + 'c'.repeat(64),
            generatorVersion: '1',
            socdModuleVersion: null,
          }),
        ).toBe(true);

        const stored = await builds.get(build.id, ALICE);
        expect(stored?.status).toBe('succeeded');
        expect(stored?.outputFormat).toBe('hex');
        expect(stored?.buildImageDigest).toBe('sha256:' + 'c'.repeat(64));
        expect(stored?.completedAt).not.toBeNull();

        const stored_artifact = await builds.getArtifact(build.id, ALICE);
        expect(stored_artifact?.sha256).toBe(artifact.sha256);
        expect(stored_artifact?.byteSize).toBe(artifact.byteSize);
      });

      it('records a SOCD module version and reports it on the summary', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        await toUploading(builds, build.id);

        expect(
          await builds.complete({
            buildId: build.id,
            workerId: WORKER,
            artifact: artifactArgs(build.id),
            outputFormat: 'hex',
            logReference: null,
            buildImageRef: 'qmk-web-app/qmk-build:0.33.13-1',
            buildImageDigest: null,
            generatorVersion: '1',
            socdModuleVersion: '1.0.0',
          }),
        ).toBe(true);

        const stored = await builds.get(build.id, ALICE);
        expect(stored?.socdModuleVersion).toBe('1.0.0');

        const summary = await builds.summarize(stored!, ALICE);
        expect(summary.socdModuleVersion).toBe('1.0.0');
      });

      it('records a null SOCD module version for a build that did not enable SOCD', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        await toUploading(builds, build.id);

        expect(
          await builds.complete({
            buildId: build.id,
            workerId: WORKER,
            artifact: artifactArgs(build.id),
            outputFormat: 'hex',
            logReference: null,
            buildImageRef: 'qmk-web-app/qmk-build:0.33.13-1',
            buildImageDigest: null,
            generatorVersion: '1',
            socdModuleVersion: null,
          }),
        ).toBe(true);

        const stored = await builds.get(build.id, ALICE);
        expect(stored?.socdModuleVersion).toBeNull();

        const summary = await builds.summarize(stored!, ALICE);
        expect(summary.socdModuleVersion).toBeNull();
      });

      it('refuses to complete a build that has not reached uploading', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });

        // Otherwise a worker could report success without ever collecting an artifact.
        expect(
          await builds.complete({
            buildId: build.id,
            workerId: WORKER,
            artifact: artifactArgs(build.id),
            outputFormat: 'hex',
            logReference: null,
            buildImageRef: 'x',
            buildImageDigest: null,
            generatorVersion: '1',
            socdModuleVersion: null,
          }),
        ).toBe(false);
        expect(await builds.getArtifact(build.id, ALICE)).toBeNull();
      });

      it('surfaces a failure code and its log reference', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        expect(
          await builds.fail({
            buildId: build.id,
            workerId: WORKER,
            failureCode: 'COMPILE_FAILED',
            logReference: `builds/${build.id}/log`,
          }),
        ).toBe(true);

        const stored = await builds.get(build.id, ALICE);
        expect(stored?.status).toBe('failed');
        expect(stored?.failureCode).toBe('COMPILE_FAILED');
        expect(stored?.logReference).toBe(`builds/${build.id}/log`);
      });
    });

    describe('quotas', () => {
      it('counts only in-flight builds as active', async () => {
        const first = await builds.create(buildRecord(configurationId, ALICE));
        await builds.create(buildRecord(configurationId, ALICE));
        expect(await builds.countActiveForOwner(ALICE)).toBe(2);

        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        await builds.fail({
          buildId: first.build.id,
          workerId: WORKER,
          failureCode: 'COMPILE_FAILED',
          logReference: null,
        });

        expect(await builds.countActiveForOwner(ALICE)).toBe(1);
        expect(await builds.countActiveForOwner(BOB)).toBe(0);
      });

      it('counts builds requested since a cutoff', async () => {
        await builds.create(
          buildRecord(configurationId, ALICE, {
            requestedAt: new Date(Date.now() - 7_200_000).toISOString(),
          }),
        );
        await builds.create(buildRecord(configurationId, ALICE));

        const oneHourAgo = new Date(Date.now() - 3_600_000);
        expect(await builds.countRequestedSince(ALICE, oneHourAgo)).toBe(1);
      });
    });

    describe('retention', () => {
      it('expires an artifact, marks the build expired, and hands back the key', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        await toUploading(builds, build.id);

        const artifact = artifactArgs(build.id, {
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        });
        await builds.complete({
          buildId: build.id,
          workerId: WORKER,
          artifact,
          outputFormat: 'hex',
          logReference: `builds/${build.id}/log`,
          buildImageRef: 'x',
          buildImageDigest: null,
          generatorVersion: '1',
          socdModuleVersion: null,
        });

        const reaped = await builds.reap({ logRetentionMs: 7 * 86_400_000 });
        expect(reaped.artifactKeys).toEqual([artifact.storageKey]);
        expect(reaped.buildsExpired).toBe(1);

        const stored = await builds.get(build.id, ALICE);
        expect(stored?.status).toBe('expired');
        expect(stored?.artifactId).toBeNull();
        // The build survives so a user learns the artifact expired rather than that it
        // never existed.
        expect(await builds.getArtifact(build.id, ALICE)).toBeNull();
      });

      it('drops log references past the retention window', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        await builds.fail({
          buildId: build.id,
          workerId: WORKER,
          failureCode: 'COMPILE_FAILED',
          logReference: `builds/${build.id}/log`,
        });

        // A retention window of 0 makes everything already completed eligible.
        const reaped = await builds.reap({ logRetentionMs: 0 });
        expect(reaped.logKeys).toEqual([`builds/${build.id}/log`]);
        expect((await builds.get(build.id, ALICE))?.logReference).toBeNull();
      });

      it('keeps a log that is still inside the window', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        await builds.claim({ workerId: WORKER, leaseMs: 60_000 });
        await builds.fail({
          buildId: build.id,
          workerId: WORKER,
          failureCode: 'COMPILE_FAILED',
          logReference: `builds/${build.id}/log`,
        });

        expect((await builds.reap({ logRetentionMs: 86_400_000 })).logKeys).toEqual([]);
      });
    });

    describe('build input', () => {
      it('returns the exact revision document the build cites', async () => {
        const { build } = await builds.create(buildRecord(configurationId, ALICE));
        const input = await builds.getBuildInput(build.id);
        expect(input?.configuration.keyboardId).toBe('crkbd/rev1');
        expect(input?.catalogVersion).toBe('0.33.13-1');
      });

      it('returns null for an unknown build', async () => {
        expect(await builds.getBuildInput(randomUUID())).toBeNull();
      });
    });
  });
}

contractFor('InMemoryBuildStore', async () => {
  const configurations = new InMemoryConfigurationRepository();
  const documents = new Map<string, Configuration>();
  const builds = new InMemoryBuildStore(async (configurationId, revision) =>
    documents.get(`${configurationId}@${revision}`) ?? null,
  );
  return {
    builds,
    configurations,
    async seedConfiguration(ownerId: string) {
      const id = randomUUID();
      const record = configurationRecord(id, ownerId);
      await configurations.create({ record });
      documents.set(`${id}@1`, record.document);
      return id;
    },
  };
});

if (pool) {
  contractFor('PostgresBuildStore', async () => {
    // Each backend starts from an empty slate. Artifacts cascade from builds, and
    // revisions from configurations.
    await pool.query('DELETE FROM builds');
    await pool.query('DELETE FROM configurations');
    const configurations = new PostgresConfigurationRepository(pool);
    return {
      builds: new PostgresBuildStore(pool),
      configurations,
      async seedConfiguration(ownerId: string) {
        const id = randomUUID();
        await configurations.create({ record: configurationRecord(id, ownerId) });
        return id;
      },
    };
  });
} else {
  describe.skip('PostgresBuildStore (no database reachable)', () => {
    it('is skipped', () => {});
  });
}

afterAll(async () => {
  await pool?.end();
});
