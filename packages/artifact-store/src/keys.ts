/**
 * Storage key derivation.
 *
 * Every key this application ever stores is produced here, from a build id and a fixed
 * suffix. Nothing else composes one. That is what makes claude.md rule 4 ("do not
 * concatenate free-form user text into … paths") checkable rather than aspirational:
 * there is one function to audit, and it accepts a UUID and nothing else.
 *
 * The artifact's *display* filename is a separate field on the artifact record. It is
 * derived from validated catalog data by the generator, and it is never part of a key.
 */
import { ArtifactStoreError } from './types.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Keys this application may produce. Anything else is a bug, not a new feature. */
export const KEY_SUFFIXES = Object.freeze(['firmware', 'log'] as const);

export type KeySuffix = (typeof KEY_SUFFIXES)[number];

function assertBuildId(buildId: string): void {
  if (!UUID_RE.test(buildId)) {
    throw new ArtifactStoreError(`storage key requires a lowercase UUID build id`);
  }
}

/**
 * The firmware object for a build. The extension is recorded on the artifact row, not
 * in the key: a key that carried an extension would be a second source of truth about
 * what the build produced.
 */
export function artifactKey(buildId: string): string {
  assertBuildId(buildId);
  return `builds/${buildId}/firmware`;
}

/** The sanitized, capped build log. Present for successful and failed builds alike. */
export function logKey(buildId: string): string {
  assertBuildId(buildId);
  return `builds/${buildId}/log`;
}

/**
 * Validates a key read back from the database before it is used as a path or an object
 * name. Storage keys are written by this process, but they make a round trip through
 * the database, and a path is exactly the wrong place to extend trust.
 */
export function assertValidKey(key: string): void {
  const match = /^builds\/([0-9a-f-]{36})\/(firmware|log)$/.exec(key);
  if (!match || !UUID_RE.test(match[1] as string)) {
    throw new ArtifactStoreError('malformed storage key');
  }
}

/**
 * The inverse of `artifactKey`/`logKey`: recovers the build id a storage key was
 * derived from, or `null` if the key does not match one of the two shapes this module
 * produces. Used by the retention sweep to name build ids in its record instead of
 * storage keys — a key read back out of the database is untrusted input for the same
 * reason `assertValidKey` treats it that way, so this validates rather than trusting a
 * value that merely looks right.
 */
export function buildIdFromKey(key: string): string | null {
  const match = /^builds\/([0-9a-f-]{36})\/(?:firmware|log)$/.exec(key);
  if (!match) return null;
  const buildId = match[1] as string;
  return UUID_RE.test(buildId) ? buildId : null;
}
