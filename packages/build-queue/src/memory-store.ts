/**
 * In-memory builds + queue.
 *
 * Exists for the same reason the in-memory configuration repository does: route tests
 * and the worker-loop test stay hermetic, while the shared contract test
 * (`store-contract.test.ts`) runs against this and the Postgres implementation so the
 * two cannot drift.
 *
 * The concurrency guarantees this fakes — one claimant per build, atomic idempotent
 * create — are trivially true here because JavaScript is single-threaded between
 * awaits. They are the interesting part of the Postgres implementation, and the
 * contract test is what checks the real one actually provides them.
 */
import type { ArtifactRecord, BuildRecord, BuildStatus, Configuration } from '@qmk-web-app/domain';
import { assertTransition, canTransition, isTerminal } from '@qmk-web-app/domain';
import type {
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

interface Lease {
  claimedBy: string;
  leaseExpiresAt: number;
}

/** How the store reads the immutable revision a build cites. */
export type RevisionLookup = (
  configurationId: string,
  revision: number,
) => Promise<Configuration | null>;

const IN_FLIGHT: readonly BuildStatus[] = ['preparing', 'building', 'uploading'];

export class InMemoryBuildStore implements BuildRepository, BuildQueue {
  readonly #builds = new Map<string, BuildRecord>();
  readonly #artifacts = new Map<string, ArtifactRecord>();
  readonly #leases = new Map<string, Lease>();
  readonly #cancelRequested = new Set<string>();
  readonly #revisionLookup: RevisionLookup;

  constructor(revisionLookup: RevisionLookup = async () => null) {
    this.#revisionLookup = revisionLookup;
  }

  // ---------------------------------------------------------------- repository

  async create(record: BuildRecord): Promise<CreateBuildResult> {
    const existing = [...this.#builds.values()].find(
      (b) => b.ownerId === record.ownerId && b.idempotencyKey === record.idempotencyKey,
    );
    if (existing) return { build: structuredClone(existing), created: false };

    this.#builds.set(record.id, structuredClone(record));
    return { build: structuredClone(record), created: true };
  }

  async get(id: string, ownerId: string): Promise<BuildRecord | null> {
    const build = this.#builds.get(id);
    if (!build || build.ownerId !== ownerId) return null;
    return structuredClone(build);
  }

  async getArtifact(buildId: string, ownerId: string) {
    const build = this.#builds.get(buildId);
    if (!build || build.ownerId !== ownerId || !build.artifactId) return null;
    const artifact = this.#artifacts.get(build.artifactId);
    if (!artifact) return null;
    return {
      storageKey: artifact.storageKey,
      originalFilename: artifact.originalFilename,
      byteSize: artifact.byteSize,
      sha256: artifact.sha256,
      contentType: artifact.contentType,
      expiresAt: artifact.expiresAt,
    };
  }

  async listForConfiguration(
    configurationId: string,
    ownerId: string,
    options: { page: number; pageSize: number },
  ): Promise<ListPage<BuildSummary>> {
    const owned = [...this.#builds.values()]
      .filter((b) => b.ownerId === ownerId && b.configurationId === configurationId)
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : a.requestedAt > b.requestedAt ? -1 : 0));

    const totalItems = owned.length;
    const totalPages = Math.max(Math.ceil(totalItems / options.pageSize), 1);
    const page = Math.min(Math.max(options.page, 1), totalPages);
    const start = (page - 1) * options.pageSize;

    const items = await Promise.all(
      owned.slice(start, start + options.pageSize).map((b) => this.summarize(b, ownerId)),
    );
    return { items, page, pageSize: options.pageSize, totalItems, totalPages };
  }

  async countActiveForOwner(ownerId: string): Promise<number> {
    return [...this.#builds.values()].filter(
      (b) => b.ownerId === ownerId && !isTerminal(b.status),
    ).length;
  }

  async countRequestedSince(ownerId: string, since: Date): Promise<number> {
    const cutoff = since.toISOString();
    return [...this.#builds.values()].filter(
      (b) => b.ownerId === ownerId && b.requestedAt >= cutoff,
    ).length;
  }

  async requestCancellation(id: string, ownerId: string): Promise<CancelOutcome | null> {
    const build = this.#builds.get(id);
    if (!build || build.ownerId !== ownerId) return null;

    if (isTerminal(build.status)) return 'already_finished';

    // A queued build has no worker to notice a request, so cancel it outright.
    if (build.status === 'queued') {
      assertTransition(build.status, 'cancelled');
      build.status = 'cancelled';
      build.failureCode = 'CANCELLED';
      build.completedAt = new Date().toISOString();
      this.#cancelRequested.add(id);
      return 'cancelled';
    }

    this.#cancelRequested.add(id);
    return 'requested';
  }

  async summarize(record: BuildRecord, ownerId: string): Promise<BuildSummary> {
    const artifact = await this.getArtifact(record.id, ownerId);
    return toSummary(record, artifact);
  }

  // --------------------------------------------------------------------- queue

  async claim(args: { workerId: string; leaseMs: number }): Promise<ClaimedBuild | null> {
    const next = [...this.#builds.values()]
      .filter((b) => b.status === 'queued' && !this.#cancelRequested.has(b.id))
      .sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0))[0];
    if (!next) return null;

    assertTransition(next.status, 'preparing');
    const now = Date.now();
    next.status = 'preparing';
    next.attemptCount += 1;
    next.startedAt ??= new Date(now).toISOString();
    this.#leases.set(next.id, { claimedBy: args.workerId, leaseExpiresAt: now + args.leaseMs });

    return {
      buildId: next.id,
      configurationId: next.configurationId,
      configurationRevision: next.configurationRevision,
      catalogVersion: next.catalogVersion,
      qmkCommit: next.qmkCommit,
      attemptCount: next.attemptCount,
      leaseExpiresAt: new Date(now + args.leaseMs).toISOString(),
    };
  }

  #heldBuild(buildId: string, workerId: string): BuildRecord | null {
    const build = this.#builds.get(buildId);
    const lease = this.#leases.get(buildId);
    if (!build || !lease || lease.claimedBy !== workerId) return null;
    return build;
  }

  async heartbeat(args: { buildId: string; workerId: string; leaseMs: number }) {
    const build = this.#heldBuild(args.buildId, args.workerId);
    if (!build || isTerminal(build.status)) return null;
    this.#leases.set(args.buildId, {
      claimedBy: args.workerId,
      leaseExpiresAt: Date.now() + args.leaseMs,
    });
    return { cancelRequested: this.#cancelRequested.has(args.buildId) };
  }

  async advance(args: {
    buildId: string;
    workerId: string;
    from: BuildStatus;
    to: BuildStatus;
  }): Promise<boolean> {
    // Throws on an illegal transition: that is a bug in the worker, not a lost race.
    assertTransition(args.from, args.to);
    const build = this.#heldBuild(args.buildId, args.workerId);
    if (!build || build.status !== args.from) return false;
    build.status = args.to;
    return true;
  }

  async getBuildInput(buildId: string) {
    const build = this.#builds.get(buildId);
    if (!build) return null;
    const configuration = await this.#revisionLookup(
      build.configurationId,
      build.configurationRevision,
    );
    if (!configuration) return null;
    return {
      configuration,
      catalogVersion: build.catalogVersion,
      qmkCommit: build.qmkCommit,
    };
  }

  async complete(args: CompleteBuildArgs): Promise<boolean> {
    const build = this.#heldBuild(args.buildId, args.workerId);
    if (!build || !canTransition(build.status, 'succeeded')) return false;

    this.#artifacts.set(args.artifact.id, {
      id: args.artifact.id,
      buildId: args.buildId,
      storageKey: args.artifact.storageKey,
      originalFilename: args.artifact.originalFilename,
      byteSize: args.artifact.byteSize,
      sha256: args.artifact.sha256,
      contentType: args.artifact.contentType,
      expiresAt: args.artifact.expiresAt,
      createdAt: new Date().toISOString(),
    });

    build.status = 'succeeded';
    build.artifactId = args.artifact.id;
    build.outputFormat = args.outputFormat;
    build.logReference = args.logReference;
    build.buildImageRef = args.buildImageRef;
    build.buildImageDigest = args.buildImageDigest;
    build.generatorVersion = args.generatorVersion;
    build.socdModuleVersion = args.socdModuleVersion;
    build.completedAt = new Date().toISOString();
    this.#leases.delete(args.buildId);
    return true;
  }

  async fail(args: FailBuildArgs): Promise<boolean> {
    const build = this.#heldBuild(args.buildId, args.workerId);
    if (!build || !canTransition(build.status, 'failed')) return false;
    build.status = 'failed';
    build.failureCode = args.failureCode;
    build.logReference = args.logReference;
    if (args.buildImageRef !== undefined) build.buildImageRef = args.buildImageRef;
    if (args.buildImageDigest !== undefined) build.buildImageDigest = args.buildImageDigest;
    if (args.generatorVersion != null) build.generatorVersion = args.generatorVersion;
    build.completedAt = new Date().toISOString();
    this.#leases.delete(args.buildId);
    return true;
  }

  async cancel(args: {
    buildId: string;
    workerId: string;
    logReference?: string | null;
  }): Promise<boolean> {
    const build = this.#heldBuild(args.buildId, args.workerId);
    if (!build || !canTransition(build.status, 'cancelled')) return false;
    build.status = 'cancelled';
    build.failureCode = 'CANCELLED';
    if (args.logReference != null) build.logReference = args.logReference;
    build.completedAt = new Date().toISOString();
    this.#leases.delete(args.buildId);
    return true;
  }

  async reclaimExpiredLeases(args: { maxAttempts: number }) {
    const now = Date.now();
    let requeued = 0;
    let failed = 0;

    for (const build of this.#builds.values()) {
      if (!IN_FLIGHT.includes(build.status)) continue;
      const lease = this.#leases.get(build.id);
      if (lease && lease.leaseExpiresAt > now) continue;

      if (build.attemptCount >= args.maxAttempts) {
        build.status = 'failed';
        build.failureCode = 'SANDBOX_ERROR';
        build.completedAt = new Date(now).toISOString();
        failed += 1;
      } else {
        build.status = 'queued';
        requeued += 1;
      }
      this.#leases.delete(build.id);
    }

    return { requeued, failed };
  }

  async reap(args: { logRetentionMs: number }): Promise<ReapResult> {
    const now = Date.now();
    const artifactKeys: string[] = [];
    const logKeys: string[] = [];
    let buildsExpired = 0;

    for (const artifact of [...this.#artifacts.values()]) {
      if (Date.parse(artifact.expiresAt) > now) continue;
      artifactKeys.push(artifact.storageKey);
      this.#artifacts.delete(artifact.id);

      const build = this.#builds.get(artifact.buildId);
      if (build) {
        build.artifactId = null;
        if (build.status === 'succeeded') {
          build.status = 'expired';
          buildsExpired += 1;
        }
      }
    }

    const logCutoff = now - args.logRetentionMs;
    for (const build of this.#builds.values()) {
      if (!build.logReference || !build.completedAt) continue;
      if (Date.parse(build.completedAt) > logCutoff) continue;
      logKeys.push(build.logReference);
      build.logReference = null;
    }

    return { artifactKeys, logKeys, buildsExpired };
  }
}

export function toSummary(
  record: BuildRecord,
  artifact: {
    originalFilename: string;
    byteSize: number;
    sha256: string;
    contentType: string;
    expiresAt: string;
  } | null,
): BuildSummary {
  return {
    id: record.id,
    configurationId: record.configurationId,
    configurationRevision: record.configurationRevision,
    status: record.status,
    failureCode: record.failureCode,
    requestedAt: record.requestedAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    attemptCount: record.attemptCount,
    catalogVersion: record.catalogVersion,
    qmkCommit: record.qmkCommit,
    generatorVersion: record.generatorVersion,
    socdModuleVersion: record.socdModuleVersion,
    artifact: artifact
      ? {
          filename: artifact.originalFilename,
          byteSize: artifact.byteSize,
          sha256: artifact.sha256,
          contentType: artifact.contentType,
          expiresAt: artifact.expiresAt,
        }
      : null,
  };
}
