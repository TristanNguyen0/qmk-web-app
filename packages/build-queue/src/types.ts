/**
 * Build persistence and queue contract.
 *
 * Two interfaces, deliberately separate, over one table:
 *
 *  - `BuildRepository` is what the API uses. Every method takes an owner id, and
 *    ownership lives in the WHERE clause exactly as it does for configurations.
 *  - `BuildQueue` is what the worker uses. It takes no owner id, because a worker is
 *    not acting for a user — and it exposes no way to list, search, or read anything
 *    but the one build it has claimed.
 *
 * Splitting them means the worker's code cannot accidentally reach a user-scoped
 * query, and the narrow database role in `migrations/003_worker_role.sql` is a
 * mechanical consequence of this interface rather than a hopeful comment.
 */
import type {
  BuildFailureCode,
  BuildRecord,
  BuildStatus,
  Configuration,
} from '@qmk-web-app/domain';

/** Same shape the configuration API pages with, so clients see one pagination format. */
export interface ListPage<T> {
  items: readonly T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/** What a client is allowed to see about a build. Never a storage key or host path. */
export interface BuildSummary {
  id: string;
  configurationId: string;
  configurationRevision: number;
  status: BuildStatus;
  failureCode: BuildFailureCode | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  attemptCount: number;
  catalogVersion: string;
  qmkCommit: string;
  generatorVersion: string;
  /** Present only once the build has succeeded and the artifact has not expired. */
  artifact: {
    filename: string;
    byteSize: number;
    sha256: string;
    contentType: string;
    expiresAt: string;
  } | null;
}

export interface CreateBuildResult {
  build: BuildRecord;
  /**
   * False when an existing build was returned for the same idempotency key. The route
   * uses this to answer 200 instead of 201, so a retried request is visibly a retry.
   */
  created: boolean;
}

export type CancelOutcome =
  /** Was `queued`; moved straight to `cancelled`. */
  | 'cancelled'
  /** In flight; the worker will observe the request at its next checkpoint. */
  | 'requested'
  /** Already terminal. Cancelling is a no-op, not an error. */
  | 'already_finished';

export interface BuildRepository {
  /**
   * Idempotent on `(ownerId, idempotencyKey)`. Concurrent duplicate submissions must
   * result in exactly one build, with both callers seeing it.
   */
  create(record: BuildRecord): Promise<CreateBuildResult>;

  /** Null when the id is unknown OR owned by someone else — indistinguishable. */
  get(id: string, ownerId: string): Promise<BuildRecord | null>;

  /** The artifact row for a build the caller owns, or null. Includes the storage key. */
  getArtifact(
    buildId: string,
    ownerId: string,
  ): Promise<{
    storageKey: string;
    originalFilename: string;
    byteSize: number;
    sha256: string;
    contentType: string;
    expiresAt: string;
  } | null>;

  listForConfiguration(
    configurationId: string,
    ownerId: string,
    options: { page: number; pageSize: number },
  ): Promise<ListPage<BuildSummary>>;

  /** Builds this owner has queued or in flight. Enforces the concurrency quota. */
  countActiveForOwner(ownerId: string): Promise<number>;

  /** Builds this owner requested since `since`. Enforces the rate quota. */
  countRequestedSince(ownerId: string, since: Date): Promise<number>;

  /** Null when the build is unknown or owned by someone else. */
  requestCancellation(id: string, ownerId: string): Promise<CancelOutcome | null>;

  summarize(record: BuildRecord, ownerId: string): Promise<BuildSummary>;
}

/** A build a worker has taken a lease on. */
export interface ClaimedBuild {
  buildId: string;
  configurationId: string;
  configurationRevision: number;
  catalogVersion: string;
  qmkCommit: string;
  attemptCount: number;
  leaseExpiresAt: string;
}

export interface CompleteBuildArgs {
  buildId: string;
  workerId: string;
  artifact: {
    id: string;
    storageKey: string;
    originalFilename: string;
    byteSize: number;
    sha256: string;
    contentType: string;
    expiresAt: string;
  };
  outputFormat: string;
  logReference: string | null;
  buildImageRef: string;
  buildImageDigest: string | null;
  generatorVersion: string;
}

export interface FailBuildArgs {
  buildId: string;
  workerId: string;
  failureCode: BuildFailureCode;
  logReference: string | null;
  buildImageRef?: string;
  buildImageDigest?: string | null;
  generatorVersion?: string | null;
}

export interface ReapResult {
  /** Storage keys whose blobs the caller must now delete. */
  artifactKeys: readonly string[];
  logKeys: readonly string[];
  buildsExpired: number;
}

export interface BuildQueue {
  /**
   * Takes the oldest queued build, or null when the queue is empty. Concurrent
   * workers must never receive the same build: the Postgres implementation uses
   * `FOR UPDATE SKIP LOCKED` (ADR 0001).
   */
  claim(args: { workerId: string; leaseMs: number }): Promise<ClaimedBuild | null>;

  /**
   * Extends the lease and reports whether cancellation was requested. Null when the
   * lease is no longer held — the worker must then abandon the build rather than
   * finish it, since another worker may already have claimed it.
   */
  heartbeat(args: {
    buildId: string;
    workerId: string;
    leaseMs: number;
  }): Promise<{ cancelRequested: boolean } | null>;

  /**
   * Moves a claimed build to the next in-flight status. False when the lease was
   * lost or the transition is not legal from the stored status.
   */
  advance(args: {
    buildId: string;
    workerId: string;
    from: BuildStatus;
    to: BuildStatus;
  }): Promise<boolean>;

  /** The configuration document this build must compile, read from the revision log. */
  getBuildInput(buildId: string): Promise<{
    configuration: Configuration;
    catalogVersion: string;
    qmkCommit: string;
  } | null>;

  /** Writes the artifact row and marks the build succeeded, atomically. */
  complete(args: CompleteBuildArgs): Promise<boolean>;

  fail(args: FailBuildArgs): Promise<boolean>;

  /**
   * `logReference` is accepted here for the same reason `fail` takes one: a build
   * cancelled mid-compile has a log worth reading, and a log the build does not
   * reference is both unreachable by its owner and invisible to the reaper.
   */
  cancel(args: {
    buildId: string;
    workerId: string;
    logReference?: string | null;
  }): Promise<boolean>;

  /**
   * Returns builds whose worker stopped heartbeating to the queue, or fails them once
   * they have used up their attempts. Returns how many were requeued and failed.
   */
  reclaimExpiredLeases(args: {
    maxAttempts: number;
  }): Promise<{ requeued: number; failed: number }>;

  /**
   * Retention. Deletes expired artifact rows, marks their builds `expired`, and drops
   * log references past the retention window, returning the storage keys whose blobs
   * the caller must delete.
   */
  reap(args: { logRetentionMs: number }): Promise<ReapResult>;
}
