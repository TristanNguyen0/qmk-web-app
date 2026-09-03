/**
 * The worker loop: claim a build, run it, record the result.
 *
 * `run-build.ts` is deliberately pure — validated configuration in, artifact out, no
 * database and no object store. This module is the other half: everything that has to
 * happen *around* a compile, and nothing that happens *inside* one.
 *
 * Three properties are worth stating because they are easy to lose:
 *
 *  1. **A build never ends in a non-terminal state because of an exception.** Every
 *     path out of `#process` either completes, fails, or cancels the build; anything
 *     thrown becomes a `SANDBOX_ERROR` failure rather than a stuck `building` row.
 *  2. **The lease is the authority, not this process.** If a heartbeat reports the
 *     lease is gone, the worker stops touching the build immediately — another worker
 *     may already be compiling it, and two workers completing one build would race to
 *     write two different artifacts.
 *  3. **The configuration is re-validated here**, even though the API validated it
 *     before queueing. It arrives from the database, and claude.md § Claude Code
 *     working checklist is explicit that catalog and stored data are untrusted until
 *     validated.
 */
import { randomUUID } from 'node:crypto';
import { artifactKey, buildIdFromKey, logKey, type ArtifactStore } from '@qmk-web-app/artifact-store';
import type { BuildQueue, ClaimedBuild } from '@qmk-web-app/build-queue';
import {
  BUILD_LIMITS,
  DomainError,
  validateConfiguration,
  type BuildFailureCode,
  type Catalog,
} from '@qmk-web-app/domain';
import type { BuildSandbox, SandboxLimits } from '@qmk-web-app/qmk-sandbox';
import { runBuild } from './run-build.ts';
import { redactLog } from './redact.ts';

/** Supplies the catalog a build's configuration must be validated against. */
export type CatalogProvider = (catalogVersion: string, keyboardId: string) => Catalog | null;

/** The outcome of one reaped object's blob delete, for the retention record. */
export type RetentionOutcome = 'deleted' | 'already-absent' | 'failed';

/** One reaped object in a retention record — a build id, never the storage key. */
export interface RetentionObjectRecord {
  buildId: string;
  kind: 'artifact' | 'log';
  outcome: RetentionOutcome;
}

/**
 * What a retention sweep actually deleted, and when. Conditioned on what `reap()`
 * returned from the database — not on how many blob deletes succeeded — so a sweep
 * whose deletes all fail still produces one of these. Never carries a storage key: a
 * storage key is the one value the product promises never to expose, and an operator
 * holding a build id can reconstruct it with `artifactKey()`/`logKey()` if they need
 * to.
 */
export interface RetentionRecord {
  deletedAt: string;
  buildsExpired: number;
  objects: readonly RetentionObjectRecord[];
}

export interface QueueRunnerEvent {
  level: 'info' | 'warn' | 'error';
  message: string;
  buildId?: string;
  retention?: RetentionRecord;
  [key: string]: unknown;
}

export interface QueueRunnerOptions {
  /** Identifies this worker in the build's lease. Must be unique per process. */
  workerId: string;
  queue: BuildQueue;
  artifacts: ArtifactStore;
  sandbox: BuildSandbox;
  catalogs: CatalogProvider;
  /** How long to wait before polling again when the queue was empty. */
  pollIntervalMs?: number;
  leaseMs?: number;
  heartbeatMs?: number;
  workspaceRoot?: string;
  redactPaths?: readonly string[];
  limits?: Partial<SandboxLimits>;
  log?: (event: QueueRunnerEvent) => void;
}

export type ProcessOutcome = 'idle' | 'succeeded' | 'failed' | 'cancelled' | 'abandoned';

/** Raised internally when the lease is gone and the worker must stop touching a build. */
class LeaseLost extends Error {
  constructor() {
    super('lease lost');
    this.name = 'LeaseLost';
  }
}

export class QueueRunner {
  readonly #options: Required<
    Pick<QueueRunnerOptions, 'pollIntervalMs' | 'leaseMs' | 'heartbeatMs'>
  > &
    QueueRunnerOptions;
  #stopping = false;
  #running = false;

  constructor(options: QueueRunnerOptions) {
    this.#options = {
      pollIntervalMs: 1000,
      leaseMs: BUILD_LIMITS.buildLeaseMs,
      heartbeatMs: BUILD_LIMITS.buildHeartbeatMs,
      ...options,
    };
  }

  #log(event: QueueRunnerEvent): void {
    this.#options.log?.(event);
  }

  /**
   * Claims and processes at most one build. Returns `idle` when the queue was empty.
   * Exposed separately from `start()` so tests drive the loop deterministically rather
   * than racing a timer.
   */
  async runOnce(): Promise<ProcessOutcome> {
    const claimed = await this.#options.queue.claim({
      workerId: this.#options.workerId,
      leaseMs: this.#options.leaseMs,
    });
    if (!claimed) return 'idle';

    this.#log({
      level: 'info',
      message: 'claimed build',
      buildId: claimed.buildId,
      attempt: claimed.attemptCount,
    });

    try {
      return await this.#process(claimed);
    } catch (error) {
      if (error instanceof LeaseLost) {
        // Deliberately silent about the build's fate: it is no longer ours to decide.
        this.#log({ level: 'warn', message: 'lease lost; abandoning build', buildId: claimed.buildId });
        return 'abandoned';
      }

      // Any other escape is a bug in this worker. The build must still reach a terminal
      // state, or it occupies a queue slot and a quota slot forever.
      this.#log({
        level: 'error',
        message: 'unhandled worker error',
        buildId: claimed.buildId,
        error: (error as Error).message,
      });
      await this.#failQuietly(claimed.buildId, 'SANDBOX_ERROR', 'the build worker failed unexpectedly');
      return 'failed';
    }
  }

  /** Polls until `stop()` is called. */
  async start(): Promise<void> {
    if (this.#running) throw new Error('queue runner is already running');
    this.#running = true;
    this.#stopping = false;

    try {
      while (!this.#stopping) {
        const outcome = await this.runOnce();
        // Only sleep when there was nothing to do; a busy queue is drained back to back.
        if (outcome === 'idle' && !this.#stopping) {
          await sleep(this.#options.pollIntervalMs);
        }
      }
    } finally {
      this.#running = false;
    }
  }

  stop(): void {
    this.#stopping = true;
  }

  /**
   * Housekeeping a worker performs alongside its own builds: recovering builds from
   * dead workers, and deleting expired artifacts and logs from storage.
   */
  async maintain(): Promise<{
    requeued: number;
    failed: number;
    objectsDeleted: number;
    retention: RetentionRecord | null;
  }> {
    const reclaimed = await this.#options.queue.reclaimExpiredLeases({
      maxAttempts: BUILD_LIMITS.maxBuildAttempts,
    });

    // The database rows go first. If deleting a blob then fails, the result is an
    // orphaned object rather than a build row promising a download that is gone.
    const reaped = await this.#options.queue.reap({
      logRetentionMs: BUILD_LIMITS.logRetentionMs,
    });

    // Carry the kind alongside each key so a per-object outcome can be attributed,
    // rather than a flat concatenation that loses which array a key came from.
    const objects: Array<{ key: string; kind: 'artifact' | 'log' }> = [
      ...reaped.artifactKeys.map((key) => ({ key, kind: 'artifact' as const })),
      ...reaped.logKeys.map((key) => ({ key, kind: 'log' as const })),
    ];

    let objectsDeleted = 0;
    const objectRecords: RetentionObjectRecord[] = [];
    for (const { key, kind } of objects) {
      // reap() only ever returns keys this process derived from a build id via
      // artifactKey()/logKey(), so this should always resolve — but the key made a
      // round trip through the database, so it is validated rather than trusted, and
      // never falls back to the raw key: that would be exactly the leak this record
      // exists to prevent.
      const buildId = buildIdFromKey(key) ?? '(invalid-key)';
      let outcome: RetentionOutcome;
      try {
        outcome = (await this.#options.artifacts.delete(key)) ? 'deleted' : 'already-absent';
        if (outcome === 'deleted') objectsDeleted += 1;
      } catch (error) {
        outcome = 'failed';
        this.#log({
          level: 'warn',
          message: 'failed to delete expired object',
          error: (error as Error).message,
        });
      }
      objectRecords.push({ buildId, kind, outcome });
    }

    // Gated on what was reaped from the database, not on objectsDeleted: a sweep that
    // deletes rows and then fails every blob delete is exactly the case that must not
    // be silent, so the record's existence cannot depend on delete success.
    let retention: RetentionRecord | null = null;
    if (reaped.artifactKeys.length + reaped.logKeys.length + reaped.buildsExpired > 0) {
      retention = {
        deletedAt: new Date().toISOString(),
        buildsExpired: reaped.buildsExpired,
        objects: objectRecords,
      };
      this.#log({ level: 'info', message: 'retention', retention });
    }

    if (reclaimed.requeued > 0 || reclaimed.failed > 0 || objectsDeleted > 0) {
      this.#log({
        level: 'info',
        message: 'maintenance',
        requeued: reclaimed.requeued,
        failed: reclaimed.failed,
        objectsDeleted,
      });
    }

    return { ...reclaimed, objectsDeleted, retention };
  }

  async #process(claimed: ClaimedBuild): Promise<ProcessOutcome> {
    const { queue, workerId } = this.#options;
    const { buildId } = claimed;

    // Checkpoint 1: before any work is done.
    if (await this.#cancelRequested(buildId)) return this.#cancel(buildId);

    const input = await queue.getBuildInput(buildId);
    if (!input) {
      // The revision the build cites is gone. It cannot be rebuilt, and guessing a
      // replacement is exactly what claude.md forbids.
      await this.#fail(buildId, 'GENERATION_FAILED', 'the configuration revision for this build no longer exists');
      return 'failed';
    }

    const catalog = this.#options.catalogs(input.catalogVersion, input.configuration.keyboardId);
    if (!catalog) {
      await this.#fail(
        buildId,
        'GENERATION_FAILED',
        `this worker does not have catalog version ${input.catalogVersion}`,
      );
      return 'failed';
    }

    let validated;
    try {
      validated = validateConfiguration(input.configuration, { catalog });
    } catch (error) {
      if (error instanceof DomainError) {
        await this.#fail(buildId, 'GENERATION_FAILED', `configuration is not valid for this catalog: ${error.message}`);
        return 'failed';
      }
      throw error;
    }

    if (!(await queue.advance({ buildId, workerId, from: 'preparing', to: 'building' }))) {
      throw new LeaseLost();
    }

    // The compile is the long part, so the lease is extended in the background for its
    // duration. `cancelSeen` is checked afterwards rather than interrupting: the
    // sandbox is disposable, so letting it finish and discarding the result is simpler
    // and cannot leave a half-torn-down container behind.
    let cancelSeen = false;
    let leaseSeen = true;
    const heartbeat = setInterval(() => {
      void queue
        .heartbeat({ buildId, workerId, leaseMs: this.#options.leaseMs })
        .then((result) => {
          if (!result) leaseSeen = false;
          else if (result.cancelRequested) cancelSeen = true;
        })
        .catch(() => {
          // A transient database error is not proof the lease is gone; the next tick
          // decides. Losing the lease surfaces as a failed write later regardless.
        });
    }, this.#options.heartbeatMs);
    // Never let the heartbeat keep the process alive on its own.
    heartbeat.unref?.();

    let result;
    try {
      result = await runBuild({
        buildId,
        configuration: validated.configuration,
        keyboard: validated.keyboard,
        sandbox: this.#options.sandbox,
        ...(this.#options.workspaceRoot ? { workspaceRoot: this.#options.workspaceRoot } : {}),
        ...(this.#options.redactPaths ? { redactPaths: this.#options.redactPaths } : {}),
        ...(this.#options.limits ? { limits: this.#options.limits } : {}),
      });
    } finally {
      clearInterval(heartbeat);
    }

    if (!leaseSeen) throw new LeaseLost();

    // Checkpoint 2: after the compile, before anything is published. Still legal —
    // the state machine allows `building -> cancelled`, but not from `uploading`.
    if (cancelSeen || (await this.#cancelRequested(buildId))) {
      // The log is attached to the build, not merely stored: an unreferenced object is
      // unreadable by its owner and invisible to the reaper.
      const cancelLog = await this.#storeLog(buildId, result.log, claimed.attemptCount);
      return this.#cancel(buildId, cancelLog);
    }

    const logReference = await this.#storeLog(buildId, result.log, claimed.attemptCount);

    if (result.status !== 'succeeded') {
      this.#log({
        level: 'info',
        message: 'build failed',
        buildId,
        failureCode: result.failureCode,
        durationMs: result.durationMs,
      });
      const failed = await queue.fail({
        buildId,
        workerId,
        failureCode: result.failureCode,
        logReference,
        buildImageRef: result.imageRef,
        buildImageDigest: result.imageDigest,
        generatorVersion: result.generatorVersion,
      });
      if (!failed) throw new LeaseLost();
      return 'failed';
    }

    if (!(await queue.advance({ buildId, workerId, from: 'building', to: 'uploading' }))) {
      throw new LeaseLost();
    }

    const key = artifactKey(buildId);
    // A retry of the same build id writes the same key; the store refuses to overwrite,
    // so the stale object from the abandoned attempt is removed first.
    if (claimed.attemptCount > 1) await this.#options.artifacts.delete(key);
    await this.#options.artifacts.put({
      key,
      contents: result.artifact.contents,
      contentType: result.artifact.contentType,
    });

    const completed = await queue.complete({
      buildId,
      workerId,
      artifact: {
        id: randomUUID(),
        storageKey: key,
        originalFilename: result.artifact.filename,
        byteSize: result.artifact.byteSize,
        sha256: result.artifact.sha256,
        contentType: result.artifact.contentType,
        expiresAt: new Date(Date.now() + BUILD_LIMITS.artifactRetentionMs).toISOString(),
      },
      outputFormat: result.artifact.extension,
      logReference,
      buildImageRef: result.imageRef,
      buildImageDigest: result.imageDigest,
      generatorVersion: result.generatorVersion,
      socdModuleVersion: result.socdModuleVersion,
    });

    if (!completed) {
      // The lease went away between the artifact upload and the completion write. The
      // object is orphaned rather than attached to a build; the reaper does not know
      // about it, so remove it here.
      await this.#options.artifacts.delete(key).catch(() => {});
      throw new LeaseLost();
    }

    this.#log({
      level: 'info',
      message: 'build succeeded',
      buildId,
      bytes: result.artifact.byteSize,
      sha256: result.artifact.sha256,
      durationMs: result.durationMs,
    });
    return 'succeeded';
  }

  async #cancelRequested(buildId: string): Promise<boolean> {
    const beat = await this.#options.queue.heartbeat({
      buildId,
      workerId: this.#options.workerId,
      leaseMs: this.#options.leaseMs,
    });
    if (!beat) throw new LeaseLost();
    return beat.cancelRequested;
  }

  async #cancel(buildId: string, logReference: string | null = null): Promise<ProcessOutcome> {
    const cancelled = await this.#options.queue.cancel({
      buildId,
      workerId: this.#options.workerId,
      logReference,
    });
    if (!cancelled) throw new LeaseLost();
    this.#log({ level: 'info', message: 'build cancelled', buildId });
    return 'cancelled';
  }

  /**
   * Stores a message as the build's log and returns its reference, or null if it could
   * not be stored. A build's outcome must never depend on whether its log was saved.
   */
  async #storeLog(buildId: string, contents: string, attemptCount: number): Promise<string | null> {
    const key = logKey(buildId);
    try {
      if (attemptCount > 1) await this.#options.artifacts.delete(key);
      await this.#options.artifacts.put({
        key,
        contents: Buffer.from(contents, 'utf8'),
        contentType: 'text/plain; charset=utf-8',
      });
      return key;
    } catch (error) {
      this.#log({
        level: 'warn',
        message: 'failed to store build log',
        buildId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /** Fails a build with a short worker-generated log, redacted like any other. */
  async #fail(buildId: string, failureCode: BuildFailureCode, message: string): Promise<void> {
    const log = redactLog(message, { extraPaths: [...(this.#options.redactPaths ?? [])] });
    const logReference = await this.#storeLog(buildId, log, 1);
    const failed = await this.#options.queue.fail({
      buildId,
      workerId: this.#options.workerId,
      failureCode,
      logReference,
    });
    if (!failed) throw new LeaseLost();
    this.#log({ level: 'info', message: 'build failed', buildId, failureCode });
  }

  /** As `#fail`, but never throws — used on the unhandled-error path. */
  async #failQuietly(
    buildId: string,
    failureCode: BuildFailureCode,
    message: string,
  ): Promise<void> {
    try {
      await this.#fail(buildId, failureCode, message);
    } catch {
      // Nothing left to try. The lease will expire and the build be requeued or failed
      // by `maintain()`.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
