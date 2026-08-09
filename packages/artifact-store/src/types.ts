/**
 * Object storage for firmware artifacts and sanitized build logs.
 *
 * ADR 0001 chose S3-compatible storage with MinIO in development. This interface is
 * the seam that decision needs: the worker writes and the API reads through it, so the
 * filesystem implementation used today and an S3 implementation later are the only
 * things that ever have to change. It mirrors `BuildSandbox` — one narrow contract,
 * one place where a policy about the outside world is expressed.
 *
 * Two rules are part of the contract rather than any implementation:
 *
 *  1. **Keys are derived by `keys.ts`, never by a caller.** A key is composed from a
 *     build id and a fixed suffix, so no user-supplied text ever reaches a path or an
 *     object name (claude.md rule 4).
 *  2. **A key never leaves the server.** It is stored in `artifacts.storage_key` and
 *     used to serve a download; the client sees a build id and a filename only
 *     (claude.md § Error handling).
 */

export class ArtifactStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ArtifactStoreError';
  }
}

export interface PutObjectArgs {
  key: string;
  contents: Buffer;
  contentType: string;
}

export interface ArtifactStore {
  /**
   * Writes an object. Must fail rather than overwrite: a build writes its artifact
   * exactly once, and a second write to the same key means two builds believe they
   * own it.
   */
  put(args: PutObjectArgs): Promise<void>;

  /** Null when the key is absent — an expired or reaped artifact, not an error. */
  get(key: string): Promise<Buffer | null>;

  /** True when an object was deleted, false when the key was already absent. */
  delete(key: string): Promise<boolean>;
}
