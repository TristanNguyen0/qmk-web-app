/**
 * PostgreSQL builds + queue.
 *
 * ADR 0001 chose a database-backed queue with `FOR UPDATE SKIP LOCKED`. The whole
 * point of that choice is concentrated in `claim()`: two workers polling at the same
 * instant take two different builds, and neither blocks on the other. Everything else
 * here exists to make the surrounding states equally hard to corrupt —
 *
 *  - every worker write is conditional on `claimed_by = $workerId` **and** the status
 *    it believes it is leaving, so a worker whose lease expired cannot finish a build
 *    another worker has since picked up;
 *  - `create()` relies on the unique index for idempotency rather than a read-then-
 *    write, which would race;
 *  - transitions are checked against the domain state machine before the query runs,
 *    so an illegal one is a thrown programming error rather than a silent no-op.
 */
import type { Pool, PoolClient } from 'pg';
import type { BuildRecord, BuildStatus, Configuration } from '@qmk-web-app/domain';
import { assertTransition, BUILD_LIMITS, isTerminal } from '@qmk-web-app/domain';
import { toSummary } from './memory-store.ts';
import type {
  BuildAdmissionCap,
  BuildQueue,
  BuildRepository,
  BuildSummary,
  CancelOutcome,
  ClaimedBuild,
  CompleteBuildArgs,
  CreateBuildResult,
  FailBuildArgs,
  ListPage,
  ReapResult,
} from './types.ts';

/** Non-terminal statuses that occupy a slot in the global and per-owner queue-depth caps. */
const ACTIVE_STATUSES = ['queued', 'preparing', 'building', 'uploading'] as const;

interface BuildRow {
  id: string;
  configuration_id: string;
  configuration_revision: number;
  owner_id: string;
  catalog_version: string;
  qmk_commit: string;
  generator_version: string;
  socd_module_version: string | null;
  build_image_ref: string;
  build_image_digest: string | null;
  status: BuildStatus;
  idempotency_key: string;
  requested_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  attempt_count: number;
  artifact_id: string | null;
  output_format: string | null;
  log_reference: string | null;
  failure_code: BuildRecord['failureCode'];
}

function toRecord(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    configurationId: row.configuration_id,
    configurationRevision: row.configuration_revision,
    ownerId: row.owner_id,
    catalogVersion: row.catalog_version,
    qmkCommit: row.qmk_commit,
    generatorVersion: row.generator_version,
    socdModuleVersion: row.socd_module_version,
    buildImageRef: row.build_image_ref,
    buildImageDigest: row.build_image_digest,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    requestedAt: row.requested_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    attemptCount: row.attempt_count,
    artifactId: row.artifact_id,
    outputFormat: row.output_format,
    logReference: row.log_reference,
    failureCode: row.failure_code,
  };
}

/** Statuses a worker may still be holding. Used by every lease-guarded write. */
const IN_FLIGHT = ['preparing', 'building', 'uploading'] as const;

/** Internal signal that a lease-guarded write matched no row, so its transaction must roll back. */
class LeaseLost extends Error {}

export class PostgresBuildStore implements BuildRepository, BuildQueue {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async #transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------- repository

  async create(record: BuildRecord): Promise<CreateBuildResult> {
    return this.#transaction(async (client) => {
      // Transaction-scoped: blocks concurrent admission decisions until this
      // transaction commits or rolls back, without locking the whole table, and
      // releases automatically with no unlock path to forget. `qwa:build-admission`
      // is a reserved lock key for this repository — no other pg_advisory_xact_lock
      // caller exists in this codebase today, and a collision would only
      // over-serialise unrelated work (fail safe), never under-serialise this one.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('qwa:build-admission'))");

      // A retry must never become a rejection — the same reasoning
      // ADR-0004-idempotency already applies. Check for an existing build under this
      // key before any cap is consulted; the row, once found here under the lock, is
      // safe to trust for the rest of this decision.
      const existing = await client.query<BuildRow>(
        'SELECT * FROM builds WHERE owner_id = $1 AND idempotency_key = $2',
        [record.ownerId, record.idempotencyKey],
      );
      const replay = existing.rows[0];
      if (replay) return { outcome: 'replayed', build: toRecord(replay) };

      // One pass over `builds` for all three counts. The lock above is what makes
      // reading these counts here and re-deriving them inside the INSERT's own SELECT
      // (below) consistent with each other — nothing else can write a competing row
      // in between. The cutoff for `owner_hourly` comes from the database clock,
      // inside this statement, inclusive at the lower bound — never from
      // `Date.now()` in the API process, which two skewed API processes could
      // disagree about.
      const counted = await client.query<{
        global_active: string;
        owner_active: string;
        owner_hourly: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE status = ANY($2::text[])) AS global_active,
           count(*) FILTER (WHERE owner_id = $1 AND status = ANY($2::text[])) AS owner_active,
           count(*) FILTER (WHERE owner_id = $1 AND requested_at >= now() - interval '1 hour')
             AS owner_hourly
         FROM builds`,
        [record.ownerId, ACTIVE_STATUSES],
      );
      const row = counted.rows[0]!;
      const globalActive = Number(row.global_active);
      const ownerActive = Number(row.owner_active);
      const ownerHourly = Number(row.owner_hourly);

      // Checked in this order deliberately: a global rejection is not the caller's
      // doing and must be named first, before either per-owner count is considered.
      const rejection = this.#firstRejection({
        globalActive,
        ownerActive,
        ownerHourly,
      });
      if (rejection) return rejection;

      // The predicates below are not redundant with the check just performed: D-11
      // requires the database to be the final authority on admission, independent of
      // the application code path, not merely informed by a TypeScript branch. Under
      // the advisory lock the two agree by construction, so a `WHERE`-rejected insert
      // here is a bug, not a legitimate outcome.
      const inserted = await client.query<BuildRow>(
        `INSERT INTO builds
           (id, configuration_id, configuration_revision, owner_id, catalog_version,
            qmk_commit, generator_version, build_image_ref, build_image_digest, status,
            idempotency_key, requested_at, attempt_count)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
         FROM (
           SELECT
             count(*) FILTER (WHERE status = ANY($16::text[])) AS global_active,
             count(*) FILTER (WHERE owner_id = $4 AND status = ANY($16::text[])) AS owner_active,
             count(*) FILTER (WHERE owner_id = $4 AND requested_at >= now() - interval '1 hour')
               AS owner_hourly
           FROM builds
         ) counts
         WHERE counts.global_active < $14
           AND counts.owner_active < $15
           AND counts.owner_hourly < $17
         ON CONFLICT (owner_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [
          record.id,
          record.configurationId,
          record.configurationRevision,
          record.ownerId,
          record.catalogVersion,
          record.qmkCommit,
          record.generatorVersion,
          record.buildImageRef,
          record.buildImageDigest,
          record.status,
          record.idempotencyKey,
          record.requestedAt,
          record.attemptCount,
          BUILD_LIMITS.maxGlobalActiveBuilds,
          BUILD_LIMITS.maxActiveBuildsPerOwner,
          ACTIVE_STATUSES,
          BUILD_LIMITS.maxBuildsPerOwnerPerHour,
        ],
      );

      const insertedRow = inserted.rows[0];
      if (!insertedRow) {
        // Impossible under the advisory lock, since the counts above just proved
        // room for this insert — a bug signal, not a user-facing condition.
        throw new Error(
          'build insert was rejected by its own admission predicates despite passing the ' +
            'identical counts under the same advisory lock',
        );
      }
      return { outcome: 'created', build: toRecord(insertedRow) };
    });
  }

  /** The first admission cap (global, then per-owner) that is at or over its limit. */
  #firstRejection(counts: {
    globalActive: number;
    ownerActive: number;
    ownerHourly: number;
  }): { outcome: 'rejected'; cap: BuildAdmissionCap; observed: number; limit: number } | null {
    if (counts.globalActive >= BUILD_LIMITS.maxGlobalActiveBuilds) {
      return {
        outcome: 'rejected',
        cap: 'global_active',
        observed: counts.globalActive,
        limit: BUILD_LIMITS.maxGlobalActiveBuilds,
      };
    }
    if (counts.ownerActive >= BUILD_LIMITS.maxActiveBuildsPerOwner) {
      return {
        outcome: 'rejected',
        cap: 'owner_active',
        observed: counts.ownerActive,
        limit: BUILD_LIMITS.maxActiveBuildsPerOwner,
      };
    }
    if (counts.ownerHourly >= BUILD_LIMITS.maxBuildsPerOwnerPerHour) {
      return {
        outcome: 'rejected',
        cap: 'owner_hourly',
        observed: counts.ownerHourly,
        limit: BUILD_LIMITS.maxBuildsPerOwnerPerHour,
      };
    }
    return null;
  }

  async get(id: string, ownerId: string): Promise<BuildRecord | null> {
    const result = await this.#pool.query<BuildRow>(
      'SELECT * FROM builds WHERE id = $1 AND owner_id = $2',
      [id, ownerId],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async getArtifact(buildId: string, ownerId: string) {
    // The join is the authorization: an artifact is only reachable through a build the
    // caller owns (claude.md § API/interface expectations).
    const result = await this.#pool.query<{
      storage_key: string;
      original_filename: string;
      byte_size: string;
      sha256: string;
      content_type: string;
      expires_at: Date;
    }>(
      `SELECT a.storage_key, a.original_filename, a.byte_size::text, a.sha256,
              a.content_type, a.expires_at
         FROM artifacts a
         JOIN builds b ON b.id = a.build_id
        WHERE a.build_id = $1 AND b.owner_id = $2`,
      [buildId, ownerId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      storageKey: row.storage_key,
      originalFilename: row.original_filename,
      byteSize: Number(row.byte_size),
      sha256: row.sha256,
      contentType: row.content_type,
      expiresAt: row.expires_at.toISOString(),
    };
  }

  async listForConfiguration(
    configurationId: string,
    ownerId: string,
    options: { page: number; pageSize: number },
  ): Promise<ListPage<BuildSummary>> {
    const countResult = await this.#pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM builds WHERE configuration_id = $1 AND owner_id = $2',
      [configurationId, ownerId],
    );
    const totalItems = Number(countResult.rows[0]?.count ?? '0');
    const totalPages = Math.max(Math.ceil(totalItems / options.pageSize), 1);
    const page = Math.min(Math.max(options.page, 1), totalPages);

    const result = await this.#pool.query<
      BuildRow & {
        a_original_filename: string | null;
        a_byte_size: string | null;
        a_sha256: string | null;
        a_content_type: string | null;
        a_expires_at: Date | null;
      }
    >(
      `SELECT b.*,
              a.original_filename AS a_original_filename,
              a.byte_size::text   AS a_byte_size,
              a.sha256            AS a_sha256,
              a.content_type      AS a_content_type,
              a.expires_at        AS a_expires_at
         FROM builds b
         LEFT JOIN artifacts a ON a.build_id = b.id
        WHERE b.configuration_id = $1 AND b.owner_id = $2
        ORDER BY b.requested_at DESC
        LIMIT $3 OFFSET $4`,
      [configurationId, ownerId, options.pageSize, (page - 1) * options.pageSize],
    );

    return {
      items: result.rows.map((row) =>
        toSummary(
          toRecord(row),
          row.a_original_filename && row.a_expires_at
            ? {
                originalFilename: row.a_original_filename,
                byteSize: Number(row.a_byte_size),
                sha256: row.a_sha256 ?? '',
                contentType: row.a_content_type ?? 'application/octet-stream',
                expiresAt: row.a_expires_at.toISOString(),
              }
            : null,
        ),
      ),
      page,
      pageSize: options.pageSize,
      totalItems,
      totalPages,
    };
  }

  async countActiveForOwner(ownerId: string): Promise<number> {
    const result = await this.#pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM builds
        WHERE owner_id = $1 AND status IN ('queued','preparing','building','uploading')`,
      [ownerId],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async countActiveGlobal(): Promise<number> {
    const result = await this.#pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM builds
        WHERE status IN ('queued','preparing','building','uploading')`,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async countRequestedSince(ownerId: string, since: Date): Promise<number> {
    const result = await this.#pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM builds WHERE owner_id = $1 AND requested_at >= $2',
      [ownerId, since],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async requestCancellation(id: string, ownerId: string): Promise<CancelOutcome | null> {
    return this.#transaction(async (client) => {
      const current = await client.query<BuildRow>(
        'SELECT * FROM builds WHERE id = $1 AND owner_id = $2 FOR UPDATE',
        [id, ownerId],
      );
      const row = current.rows[0];
      if (!row) return null;
      if (isTerminal(row.status)) return 'already_finished';

      // A queued build has no worker to notice the request, so it is cancelled here.
      // The row is locked, so a worker cannot claim it between this check and the write.
      if (row.status === 'queued') {
        assertTransition(row.status, 'cancelled');
        await client.query(
          `UPDATE builds
              SET status = 'cancelled', failure_code = 'CANCELLED',
                  cancel_requested = TRUE, completed_at = now()
            WHERE id = $1`,
          [id],
        );
        return 'cancelled';
      }

      await client.query('UPDATE builds SET cancel_requested = TRUE WHERE id = $1', [id]);
      return 'requested';
    });
  }

  async summarize(record: BuildRecord, ownerId: string): Promise<BuildSummary> {
    const artifact = await this.getArtifact(record.id, ownerId);
    return toSummary(record, artifact);
  }

  // --------------------------------------------------------------------- queue

  async claim(args: { workerId: string; leaseMs: number }): Promise<ClaimedBuild | null> {
    const result = await this.#pool.query<{
      id: string;
      configuration_id: string;
      configuration_revision: number;
      catalog_version: string;
      qmk_commit: string;
      attempt_count: number;
      lease_expires_at: Date;
    }>(
      `UPDATE builds b
          SET status = 'preparing',
              claimed_by = $1,
              claimed_at = now(),
              lease_expires_at = now() + make_interval(secs => $2),
              started_at = COALESCE(b.started_at, now()),
              attempt_count = b.attempt_count + 1
        WHERE b.id = (
                SELECT id FROM builds
                 WHERE status = 'queued' AND cancel_requested = FALSE
                 ORDER BY requested_at
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED
              )
      RETURNING b.id, b.configuration_id, b.configuration_revision, b.catalog_version,
                b.qmk_commit, b.attempt_count, b.lease_expires_at`,
      [args.workerId, args.leaseMs / 1000],
    );

    const row = result.rows[0];
    if (!row) return null;
    return {
      buildId: row.id,
      configurationId: row.configuration_id,
      configurationRevision: row.configuration_revision,
      catalogVersion: row.catalog_version,
      qmkCommit: row.qmk_commit,
      attemptCount: row.attempt_count,
      leaseExpiresAt: row.lease_expires_at.toISOString(),
    };
  }

  async heartbeat(args: { buildId: string; workerId: string; leaseMs: number }) {
    const result = await this.#pool.query<{ cancel_requested: boolean }>(
      `UPDATE builds
          SET lease_expires_at = now() + make_interval(secs => $3)
        WHERE id = $1 AND claimed_by = $2 AND status = ANY($4::text[])
      RETURNING cancel_requested`,
      [args.buildId, args.workerId, args.leaseMs / 1000, IN_FLIGHT],
    );
    const row = result.rows[0];
    return row ? { cancelRequested: row.cancel_requested } : null;
  }

  async advance(args: {
    buildId: string;
    workerId: string;
    from: BuildStatus;
    to: BuildStatus;
  }): Promise<boolean> {
    // Throws on an illegal transition: that is a bug in the worker, not a lost race.
    assertTransition(args.from, args.to);
    const result = await this.#pool.query(
      'UPDATE builds SET status = $4 WHERE id = $1 AND claimed_by = $2 AND status = $3',
      [args.buildId, args.workerId, args.from, args.to],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getBuildInput(buildId: string) {
    const result = await this.#pool.query<{
      document: Configuration;
      catalog_version: string;
      qmk_commit: string;
    }>(
      `SELECT r.document, b.catalog_version, b.qmk_commit
         FROM builds b
         JOIN configuration_revisions r
           ON r.configuration_id = b.configuration_id
          AND r.revision = b.configuration_revision
        WHERE b.id = $1`,
      [buildId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      configuration: row.document,
      catalogVersion: row.catalog_version,
      qmkCommit: row.qmk_commit,
    };
  }

  async complete(args: CompleteBuildArgs): Promise<boolean> {
    try {
      return await this.#transaction(async (client) => {
        // The artifact row must exist before `builds.artifact_id` can reference it.
        await client.query(
          `INSERT INTO artifacts
             (id, build_id, storage_key, original_filename, byte_size, sha256,
              content_type, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            args.artifact.id,
            args.buildId,
            args.artifact.storageKey,
            args.artifact.originalFilename,
            args.artifact.byteSize,
            args.artifact.sha256,
            args.artifact.contentType,
            args.artifact.expiresAt,
          ],
        );

        const updated = await client.query(
          `UPDATE builds
              SET status = 'succeeded',
                  artifact_id = $3,
                  output_format = $4,
                  log_reference = $5,
                  build_image_ref = $6,
                  build_image_digest = $7,
                  generator_version = $8,
                  socd_module_version = $9,
                  completed_at = now(),
                  claimed_by = NULL,
                  lease_expires_at = NULL
            WHERE id = $1 AND claimed_by = $2 AND status = 'uploading'`,
          [
            args.buildId,
            args.workerId,
            args.artifact.id,
            args.outputFormat,
            args.logReference,
            args.buildImageRef,
            args.buildImageDigest,
            args.generatorVersion,
            args.socdModuleVersion,
          ],
        );

        // Lease lost, or the build never reached `uploading`. Thrown rather than
        // returned so the transaction rolls back: otherwise the artifact row just
        // inserted would survive as the recorded output of a build that did not
        // succeed.
        if ((updated.rowCount ?? 0) === 0) throw new LeaseLost();
        return true;
      });
    } catch (error) {
      if (error instanceof LeaseLost) return false;
      throw error;
    }
  }

  async fail(args: FailBuildArgs): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE builds
          SET status = 'failed',
              failure_code = $3,
              log_reference = $4,
              build_image_ref = COALESCE($5, build_image_ref),
              build_image_digest = COALESCE($6, build_image_digest),
              generator_version = COALESCE($7, generator_version),
              completed_at = now(),
              claimed_by = NULL,
              lease_expires_at = NULL
        WHERE id = $1 AND claimed_by = $2 AND status = ANY($8::text[])`,
      [
        args.buildId,
        args.workerId,
        args.failureCode,
        args.logReference,
        args.buildImageRef ?? null,
        args.buildImageDigest ?? null,
        args.generatorVersion ?? null,
        IN_FLIGHT,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async cancel(args: {
    buildId: string;
    workerId: string;
    logReference?: string | null;
  }): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE builds
          SET status = 'cancelled',
              failure_code = 'CANCELLED',
              log_reference = COALESCE($3, log_reference),
              completed_at = now(),
              claimed_by = NULL,
              lease_expires_at = NULL
        WHERE id = $1 AND claimed_by = $2 AND status IN ('preparing','building')`,
      [args.buildId, args.workerId, args.logReference ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async reclaimExpiredLeases(args: { maxAttempts: number }) {
    return this.#transaction(async (client) => {
      const requeued = await client.query(
        `UPDATE builds
            SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
                lease_expires_at = NULL
          WHERE status = ANY($1::text[])
            AND (lease_expires_at IS NULL OR lease_expires_at < now())
            AND attempt_count < $2`,
        [IN_FLIGHT, args.maxAttempts],
      );

      const failed = await client.query(
        `UPDATE builds
            SET status = 'failed', failure_code = 'SANDBOX_ERROR', completed_at = now(),
                claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL
          WHERE status = ANY($1::text[])
            AND (lease_expires_at IS NULL OR lease_expires_at < now())
            AND attempt_count >= $2`,
        [IN_FLIGHT, args.maxAttempts],
      );

      return { requeued: requeued.rowCount ?? 0, failed: failed.rowCount ?? 0 };
    });
  }

  async reap(args: { logRetentionMs: number }): Promise<ReapResult> {
    return this.#transaction(async (client) => {
      const deleted = await client.query<{ storage_key: string; build_id: string }>(
        'DELETE FROM artifacts WHERE expires_at <= now() RETURNING storage_key, build_id',
      );

      let buildsExpired = 0;
      if (deleted.rows.length > 0) {
        // `builds.artifact_id` is already NULL via ON DELETE SET NULL. This records
        // that the *build* is expired, which is what a user sees.
        const expired = await client.query(
          `UPDATE builds SET status = 'expired'
            WHERE id = ANY($1::uuid[]) AND status = 'succeeded'`,
          [deleted.rows.map((r) => r.build_id)],
        );
        buildsExpired = expired.rowCount ?? 0;
      }

      // RETURNING on an UPDATE yields the *new* value, which is NULL here — so the old
      // keys are read in a CTE before the update clears them.
      const logs = await client.query<{ log_reference: string }>(
        `WITH stale AS (
             SELECT id, log_reference FROM builds
              WHERE log_reference IS NOT NULL
                AND completed_at IS NOT NULL
                AND completed_at <= now() - make_interval(secs => $1)
                FOR UPDATE
           ), cleared AS (
             UPDATE builds SET log_reference = NULL WHERE id IN (SELECT id FROM stale)
           )
           SELECT log_reference FROM stale`,
        [args.logRetentionMs / 1000],
      );

      return {
        artifactKeys: deleted.rows.map((r) => r.storage_key),
        logKeys: logs.rows.map((r) => r.log_reference),
        buildsExpired,
      };
    });
  }
}
