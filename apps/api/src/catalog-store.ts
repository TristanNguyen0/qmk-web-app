/**
 * Read-side of the catalog boundary.
 *
 * claude.md § Recommended project boundaries: catalog/discovery may "read and
 * normalize QMK keyboard/layout metadata" and must not "guess metadata or compile
 * user configurations". This store does neither — it serves already-published,
 * immutable catalog artifacts.
 *
 * Two backends, one interface:
 *
 *  - **Published** (production): a directory of `index.json` + sharded detail files.
 *    Only the index is held in memory; detail shards load on demand. The full pinned
 *    tree is ~3,750 keyboards and ~150 MB of detail, which must not sit in the heap.
 *  - **In-memory** (tests and small catalogs): a whole `Catalog` object.
 *
 * Detail lookups always go through a `detailPath` recorded in the index at publish
 * time — never a path built from a request. That is how claude.md rule 5 stays
 * satisfied even though keyboard ids look like filesystem paths.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Catalog,
  CatalogKeyboard,
  CatalogLayout,
  SupportedCatalogKeyboard,
  UnsupportedCatalogKeyboard,
} from '@qmk-web-app/domain';
import {
  openPublishedCatalog,
  type CatalogIndex,
  type CatalogIndexEntry,
  type PublishedCatalog,
} from '@qmk-web-app/qmk-catalog';

/** Summary projection for list responses — never ships full layout geometry. */
export interface KeyboardSummary {
  keyboardId: string;
  supported: boolean;
  displayName: string;
  manufacturer: string | null;
  processor: string | null;
  bootloader: string | null;
  layoutNames: readonly string[];
  unsupportedReason?: string;
}

export interface CatalogMeta {
  catalogVersion: string;
  qmkCommit: string;
  extractorVersion: number;
  normalizerVersion: number;
  keycodeSpecVersion: string;
  generatedAt: string;
  totalKeyboards: number;
  supportedKeyboards: number;
  unsupportedByReason: Readonly<Record<string, number>>;
}

export interface ListKeyboardsQuery {
  search?: string;
  includeUnsupported?: boolean;
  page?: number;
  pageSize?: number;
}

export interface Page<T> {
  items: readonly T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export class CatalogNotFoundError extends Error {}

interface Backend {
  meta: CatalogMeta;
  /** Summaries in catalog order, for listing and searching. */
  summaries: readonly KeyboardSummary[];
  getKeyboard(keyboardId: string): CatalogKeyboard | null;
}

function summarizeEntry(kb: CatalogKeyboard): KeyboardSummary {
  if (!kb.supported) {
    return {
      keyboardId: kb.keyboardId,
      supported: false,
      // Unsupported entries have no validated display name; show the id rather than
      // inventing one.
      displayName: kb.keyboardId,
      manufacturer: null,
      processor: null,
      bootloader: null,
      layoutNames: [],
      unsupportedReason: kb.reason,
    };
  }
  return {
    keyboardId: kb.keyboardId,
    supported: true,
    displayName: kb.displayName,
    manufacturer: kb.manufacturer,
    processor: kb.processor,
    bootloader: kb.bootloader,
    layoutNames: kb.layouts.map((l) => l.name),
  };
}

function summarizeIndexEntry(entry: CatalogIndexEntry): KeyboardSummary {
  const { detailPath: _detailPath, ...summary } = entry;
  return summary;
}

class InMemoryBackend implements Backend {
  readonly meta: CatalogMeta;
  readonly summaries: readonly KeyboardSummary[];
  readonly #byId: Map<string, CatalogKeyboard>;

  constructor(catalog: Catalog) {
    const unsupportedByReason: Record<string, number> = {};
    let supported = 0;
    for (const kb of catalog.keyboards) {
      if (kb.supported) supported += 1;
      else unsupportedByReason[kb.reason] = (unsupportedByReason[kb.reason] ?? 0) + 1;
    }
    this.meta = {
      catalogVersion: catalog.catalogVersion,
      qmkCommit: catalog.qmkCommit,
      extractorVersion: catalog.extractorVersion,
      normalizerVersion: catalog.normalizerVersion,
      keycodeSpecVersion: catalog.keycodeSpecVersion,
      generatedAt: catalog.generatedAt,
      totalKeyboards: catalog.keyboards.length,
      supportedKeyboards: supported,
      unsupportedByReason,
    };
    this.summaries = catalog.keyboards.map(summarizeEntry);
    this.#byId = new Map(catalog.keyboards.map((k) => [k.keyboardId, k]));
  }

  getKeyboard(keyboardId: string): CatalogKeyboard | null {
    return this.#byId.get(keyboardId) ?? null;
  }
}

class PublishedBackend implements Backend {
  readonly meta: CatalogMeta;
  readonly summaries: readonly KeyboardSummary[];
  readonly #published: PublishedCatalog;

  constructor(index: CatalogIndex, dir: string) {
    // Shard loading and caching live in @qmk-web-app/qmk-catalog so the API and the
    // build tooling read a published catalog through exactly one implementation.
    this.#published = openPublishedCatalog(dir);
    this.meta = {
      catalogVersion: index.catalogVersion,
      qmkCommit: index.qmkCommit,
      extractorVersion: index.extractorVersion,
      normalizerVersion: index.normalizerVersion,
      keycodeSpecVersion: index.keycodeSpecVersion,
      generatedAt: index.generatedAt,
      totalKeyboards: index.totalKeyboards,
      supportedKeyboards: index.supportedKeyboards,
      unsupportedByReason: index.unsupportedByReason,
    };
    this.summaries = index.keyboards.map(summarizeIndexEntry);
  }

  getKeyboard(keyboardId: string): CatalogKeyboard | null {
    return this.#published.getKeyboard(keyboardId);
  }
}

export class CatalogStore {
  readonly #backends = new Map<string, Backend>();
  #activeVersion: string | null = null;

  static fromDirectory(dir: string): CatalogStore {
    const store = new CatalogStore();
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        const indexPath = join(path, 'index.json');
        if (existsSync(indexPath)) {
          store.addPublished(JSON.parse(readFileSync(indexPath, 'utf8')) as CatalogIndex, path);
        }
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        store.add(JSON.parse(readFileSync(path, 'utf8')) as Catalog);
      }
    }
    if (store.#backends.size === 0) {
      throw new CatalogNotFoundError(`no catalogs found in ${dir}`);
    }
    return store;
  }

  add(catalog: Catalog): void {
    this.#register(catalog.catalogVersion, new InMemoryBackend(catalog));
  }

  addPublished(index: CatalogIndex, dir: string): void {
    this.#register(index.catalogVersion, new PublishedBackend(index, dir));
  }

  #register(version: string, backend: Backend): void {
    this.#backends.set(version, backend);
    // Last registered wins as active; a real deployment selects this explicitly
    // (claude.md § Source management: "publish a new catalog version, then select it").
    this.#activeVersion = version;
  }

  get activeVersion(): string {
    if (!this.#activeVersion) throw new CatalogNotFoundError('no catalog has been loaded');
    return this.#activeVersion;
  }

  get versions(): string[] {
    return [...this.#backends.keys()].sort();
  }

  #backend(version: string): Backend {
    const backend = this.#backends.get(version);
    if (!backend) throw new CatalogNotFoundError(`unknown catalog version: ${version}`);
    return backend;
  }

  getMeta(version: string): CatalogMeta {
    return this.#backend(version).meta;
  }

  listKeyboards(version: string, query: ListKeyboardsQuery = {}): Page<KeyboardSummary> {
    const backend = this.#backend(version);

    const search = query.search?.trim().toLowerCase();
    const includeUnsupported = query.includeUnsupported ?? false;

    let matches: readonly KeyboardSummary[] = backend.summaries;
    if (!includeUnsupported) matches = matches.filter((k) => k.supported);
    if (search) {
      matches = matches.filter(
        (k) =>
          k.keyboardId.toLowerCase().includes(search) ||
          k.displayName.toLowerCase().includes(search),
      );
    }

    const pageSize = Math.min(Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const totalItems = matches.length;
    const totalPages = Math.max(Math.ceil(totalItems / pageSize), 1);
    const page = Math.min(Math.max(query.page ?? 1, 1), totalPages);
    const start = (page - 1) * pageSize;

    return {
      items: matches.slice(start, start + pageSize),
      page,
      pageSize,
      totalItems,
      totalPages,
    };
  }

  getKeyboard(version: string, keyboardId: string): CatalogKeyboard | null {
    return this.#backend(version).getKeyboard(keyboardId);
  }

  getSupportedKeyboard(version: string, keyboardId: string): SupportedCatalogKeyboard | null {
    const entry = this.getKeyboard(version, keyboardId);
    return entry?.supported ? entry : null;
  }

  getUnsupportedKeyboard(version: string, keyboardId: string): UnsupportedCatalogKeyboard | null {
    const entry = this.getKeyboard(version, keyboardId);
    return entry && !entry.supported ? entry : null;
  }

  getLayout(version: string, keyboardId: string, layoutName: string): CatalogLayout | null {
    const kb = this.getSupportedKeyboard(version, keyboardId);
    return kb?.layouts.find((l) => l.name === layoutName) ?? null;
  }
}
