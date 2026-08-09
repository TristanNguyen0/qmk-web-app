/**
 * The worker's read-only view of published catalogs.
 *
 * The API has `CatalogStore`, which serves listings, search, and detail to the UI. The
 * worker needs exactly one thing — the single-keyboard catalog a configuration must be
 * validated against — so it reads published directories directly rather than depending
 * on the API application. That keeps the boundary in claude.md § Recommended project
 * boundaries intact: the worker does not import the configuration API.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalog } from '@qmk-web-app/domain';
import { isPublishedCatalogDir, openPublishedCatalog, type PublishedCatalog } from '@qmk-web-app/qmk-catalog';
import type { CatalogProvider } from './queue-runner.ts';

export interface LoadedCatalogs {
  provider: CatalogProvider;
  versions: string[];
}

/**
 * Opens every published catalog under `dir`. Indexes are held in memory; keyboard
 * detail loads on demand, so a worker with the full pinned tree available still starts
 * in well under a second.
 */
export function loadPublishedCatalogs(dir: string): LoadedCatalogs {
  const published = new Map<string, PublishedCatalog>();

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    if (!isPublishedCatalogDir(path)) continue;
    const catalog = openPublishedCatalog(path);
    published.set(catalog.index.catalogVersion, catalog);
  }

  const provider: CatalogProvider = (catalogVersion, keyboardId) => {
    const source = published.get(catalogVersion);
    // A version this worker does not have is null rather than a fallback to the newest:
    // building against a different catalog than the one requested is precisely what
    // claude.md § Source management forbids.
    if (!source) return null;

    const keyboard = source.getKeyboard(keyboardId);
    return {
      catalogVersion: source.index.catalogVersion,
      qmkCommit: source.index.qmkCommit,
      extractorVersion: source.index.extractorVersion,
      normalizerVersion: source.index.normalizerVersion,
      generatedAt: source.index.generatedAt,
      keycodeSpecVersion: source.index.keycodeSpecVersion,
      keyboards: keyboard ? [keyboard] : [],
    } satisfies Catalog;
  };

  return { provider, versions: [...published.keys()].sort() };
}
