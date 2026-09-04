import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repository root, derived from this file's location rather than `process.cwd()`. */
export const REPO_ROOT = resolve(HERE, '..', '..');

export interface QmkManifest {
  manifestVersion: number;
  upstreamUrl: string;
  tag: string;
  commit: string;
  fetchedAt: string;
  buildImage: { name: string; tag: string; digest: string | null };
  catalog: { version: string };
}

const FULL_SHA = /^[0-9a-f]{40}$/;

export function loadManifest(): QmkManifest {
  const raw: unknown = JSON.parse(
    readFileSync(resolve(HERE, 'manifest.json'), 'utf8'),
  );

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('infra/qmk/manifest.json is not an object');
  }
  const m = raw as Record<string, unknown>;

  // A partially-valid manifest is more dangerous than a missing one: it could point
  // discovery and builds at different trees. Validate every field we depend on.
  if (typeof m['commit'] !== 'string' || !FULL_SHA.test(m['commit'])) {
    throw new Error('manifest.commit must be a full 40-character lowercase SHA');
  }
  if (typeof m['upstreamUrl'] !== 'string' || !m['upstreamUrl'].startsWith('https://')) {
    throw new Error('manifest.upstreamUrl must be an https URL');
  }
  if (typeof m['tag'] !== 'string' || m['tag'].length === 0) {
    throw new Error('manifest.tag must be a non-empty string');
  }

  return raw as QmkManifest;
}

/**
 * Absolute path of the checked-out pinned tree. Keyed by commit so two pins can
 * coexist on disk and a stale checkout can never masquerade as the current one.
 *
 * `QMK_SOURCE_PATH` overrides the location. CI needs that: `actions/checkout` runs
 * `git clean -ffdx` at the start of every run, which deletes the gitignored
 * `.cache/`, so on the build host the pinned tree lives outside the workspace and is
 * provisioned by a human rather than fetched per run (docs/runbooks/ci-runner.md).
 */
export function qmkSourcePath(manifest: QmkManifest = loadManifest()): string {
  const override = process.env.QMK_SOURCE_PATH;
  if (override) return resolve(override);
  return resolve(REPO_ROOT, '.cache', 'qmk', manifest.commit);
}

/**
 * Absolute path of the published catalog directory this manifest names — the same
 * reasoning as `qmkSourcePath`, for the same reason: `/catalogs/` is gitignored and
 * does not survive a CI checkout either, so `QMK_CATALOG_PATH` overrides it.
 *
 * Deriving the default from `catalog.version` rather than repeating the version
 * string keeps the manifest the one place it is written.
 */
export function publishedCatalogPath(manifest: QmkManifest = loadManifest()): string {
  const override = process.env.QMK_CATALOG_PATH;
  if (override) return resolve(override);
  return resolve(REPO_ROOT, 'catalogs', manifest.catalog.version);
}

export function buildImageRef(manifest: QmkManifest = loadManifest()): string {
  return `${manifest.buildImage.name}:${manifest.buildImage.tag}`;
}
