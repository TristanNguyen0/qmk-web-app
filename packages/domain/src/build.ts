/**
 * Build and artifact records, plus the build state machine.
 *
 * claude.md § Deterministic generation: "State transitions must be atomic and
 * auditable." Encoding the legal transitions here means an illegal transition is a
 * programming error caught in one place, rather than a status field anyone can
 * overwrite.
 */
export const BUILD_STATUSES = [
  'queued',
  'preparing',
  'building',
  'uploading',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const;

export type BuildStatus = (typeof BUILD_STATUSES)[number];

/**
 * `queued` appears as a target from each in-flight state on purpose: that is a worker
 * losing its lease, not a worker moving backwards. Generation is deterministic and the
 * workspace is discarded on every attempt, so re-running an abandoned build produces
 * the same result as running it the first time. Without this edge, a worker that is
 * killed mid-compile would strand its build in `preparing` forever.
 */
const TRANSITIONS: Readonly<Record<BuildStatus, readonly BuildStatus[]>> = Object.freeze({
  queued: ['preparing', 'cancelled', 'failed'],
  preparing: ['building', 'queued', 'cancelled', 'failed'],
  building: ['uploading', 'queued', 'cancelled', 'failed'],
  uploading: ['succeeded', 'queued', 'failed'],
  // Terminal. `succeeded` may still expire when its artifact is reaped.
  succeeded: ['expired'],
  failed: [],
  cancelled: [],
  expired: [],
});

export function canTransition(from: BuildStatus, to: BuildStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BuildStatus, to: BuildStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal build state transition: ${from} -> ${to}`);
  }
}

export function isTerminal(status: BuildStatus): boolean {
  return TRANSITIONS[status].length === 0 || status === 'succeeded';
}

/** Why a build failed, in stable machine-readable form. */
export type BuildFailureCode =
  | 'COMPILE_FAILED'
  | 'TIMEOUT'
  | 'RESOURCE_LIMIT'
  | 'GENERATION_FAILED'
  | 'ARTIFACT_NOT_PRODUCED'
  | 'ARTIFACT_REJECTED'
  | 'SANDBOX_ERROR'
  | 'CANCELLED';

export interface BuildRecord {
  id: string;
  configurationId: string;
  configurationRevision: number;
  ownerId: string | null;
  catalogVersion: string;
  qmkCommit: string;
  generatorVersion: string;
  /** Recorded per build so a result can be reproduced (claude.md § Build isolation). */
  buildImageRef: string;
  buildImageDigest: string | null;
  status: BuildStatus;
  /** Client-supplied; makes build creation idempotent. */
  idempotencyKey: string;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  attemptCount: number;
  artifactId: string | null;
  outputFormat: string | null;
  logReference: string | null;
  failureCode: BuildFailureCode | null;
}

export interface ArtifactRecord {
  id: string;
  buildId: string;
  /** Internal storage key. Never leaves the server (claude.md § Error handling). */
  storageKey: string;
  originalFilename: string;
  byteSize: number;
  sha256: string;
  contentType: string;
  expiresAt: string;
  createdAt: string;
}
