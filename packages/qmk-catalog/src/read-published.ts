/**
 * Reader for the published catalog directory format written by `publishCatalog`.
 *
 * Detail shards load on demand and are cached, so a consumer holds only the index
 * (~1.3 MB for the full pinned tree) rather than ~150 MB of keyboard detail.
 *
 * Lookups resolve through the `detailPath` recorded in the index at publish time,
 * never a path constructed from a caller-supplied id — the mechanism that keeps
 * claude.md rule 5 satisfied for ids that look like filesystem paths.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogKeyboard } from '@qmk-web-app/domain';
import type { CatalogIndex, CatalogIndexEntry } from './publish.ts';

export class PublishedCatalogError extends Error {}

export interface PublishedCatalog {
  readonly index: CatalogIndex;
  readonly entries: ReadonlyMap<string, CatalogIndexEntry>;
  getKeyboard(keyboardId: string): CatalogKeyboard | null;
}

export function openPublishedCatalog(dir: string): PublishedCatalog {
  const indexPath = join(dir, 'index.json');
  if (!existsSync(indexPath)) {
    throw new PublishedCatalogError(`no published catalog at ${dir} (missing index.json)`);
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as CatalogIndex;
  const entries = new Map(index.keyboards.map((k) => [k.keyboardId, k]));
  const shards = new Map<string, Record<string, CatalogKeyboard>>();

  return {
    index,
    entries,
    getKeyboard(keyboardId: string): CatalogKeyboard | null {
      const entry = entries.get(keyboardId);
      if (!entry) return null;

      let shard = shards.get(entry.detailPath);
      if (!shard) {
        shard = JSON.parse(readFileSync(join(dir, entry.detailPath), 'utf8')) as Record<
          string,
          CatalogKeyboard
        >;
        shards.set(entry.detailPath, shard);
      }
      return shard[keyboardId] ?? null;
    },
  };
}

export function isPublishedCatalogDir(dir: string): boolean {
  return existsSync(join(dir, 'index.json'));
}
