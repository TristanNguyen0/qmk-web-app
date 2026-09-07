/**
 * Publishes a normalized catalog to disk in a form the API can serve without holding
 * every keyboard in memory.
 *
 * The full pinned tree yields ~3,750 keyboards and ~150 MB of JSON. Loading that as
 * one object costs roughly a gigabyte of heap and makes startup slow, so a published
 * catalog is a directory:
 *
 *   <version>/index.json              catalog metadata + one summary per keyboard
 *   <version>/keyboards/<nnn>.json    full detail, loaded on demand
 *
 * The index records each keyboard's `detailPath`. Detail lookups use that stored
 * path, never a path built from a request — which is how claude.md rule 5 stays
 * satisfied even though keyboard ids look like paths.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalog, CatalogCommunityKeymap, CatalogKeyboard } from '@qmk-web-app/domain';

/** v2: `keycodeAliases` in the index. v3: `communityKeymaps` in the index. */
export const PUBLISH_FORMAT_VERSION = 3;

export interface CatalogIndexEntry {
  keyboardId: string;
  supported: boolean;
  displayName: string;
  manufacturer: string | null;
  processor: string | null;
  bootloader: string | null;
  layoutNames: readonly string[];
  unsupportedReason?: string;
  /**
   * Path of the detail file relative to the catalog directory. Written by us at
   * publish time; never derived from user input at read time.
   */
  detailPath: string;
}

export interface CatalogIndex {
  publishFormatVersion: number;
  catalogVersion: string;
  qmkCommit: string;
  extractorVersion: number;
  normalizerVersion: number;
  keycodeSpecVersion: string;
  /** QMK's alias → canonical keycode table; see `Catalog.keycodeAliases`. Absent in v1 indexes. */
  keycodeAliases?: Readonly<Record<string, string>>;
  /** QMK's community-layout keymaps; see `Catalog.communityKeymaps`. Absent before v3. */
  communityKeymaps?: Readonly<Record<string, CatalogCommunityKeymap>>;
  generatedAt: string;
  totalKeyboards: number;
  supportedKeyboards: number;
  unsupportedByReason: Record<string, number>;
  keyboards: CatalogIndexEntry[];
}

function summarize(kb: CatalogKeyboard, detailPath: string): CatalogIndexEntry {
  if (!kb.supported) {
    return {
      keyboardId: kb.keyboardId,
      supported: false,
      displayName: kb.keyboardId,
      manufacturer: null,
      processor: null,
      bootloader: null,
      layoutNames: [],
      unsupportedReason: kb.reason,
      detailPath,
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
    detailPath,
  };
}

/** Groups keyboards into shards so one directory does not hold thousands of files. */
const SHARD_SIZE = 250;

export function publishCatalog(catalog: Catalog, outDir: string): CatalogIndex {
  // A published catalog version is immutable; republishing replaces it wholesale
  // rather than merging into a half-written previous attempt.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'keyboards'), { recursive: true });

  const keyboards = [...catalog.keyboards].sort((a, b) =>
    a.keyboardId < b.keyboardId ? -1 : a.keyboardId > b.keyboardId ? 1 : 0,
  );

  const entries: CatalogIndexEntry[] = [];
  const unsupportedByReason: Record<string, number> = {};
  let supported = 0;

  for (let shardStart = 0; shardStart < keyboards.length; shardStart += SHARD_SIZE) {
    const shard = keyboards.slice(shardStart, shardStart + SHARD_SIZE);
    const shardIndex = Math.floor(shardStart / SHARD_SIZE);
    const detailPath = join('keyboards', `${String(shardIndex).padStart(4, '0')}.json`);

    // A shard is a map keyed by keyboard id, so a detail read is one file read plus
    // one object lookup.
    const shardBody: Record<string, CatalogKeyboard> = {};
    for (const kb of shard) {
      shardBody[kb.keyboardId] = kb;
      entries.push(summarize(kb, detailPath));
      if (kb.supported) supported += 1;
      else unsupportedByReason[kb.reason] = (unsupportedByReason[kb.reason] ?? 0) + 1;
    }
    writeFileSync(join(outDir, detailPath), JSON.stringify(shardBody), 'utf8');
  }

  const index: CatalogIndex = {
    publishFormatVersion: PUBLISH_FORMAT_VERSION,
    catalogVersion: catalog.catalogVersion,
    qmkCommit: catalog.qmkCommit,
    extractorVersion: catalog.extractorVersion,
    normalizerVersion: catalog.normalizerVersion,
    keycodeSpecVersion: catalog.keycodeSpecVersion,
    keycodeAliases: catalog.keycodeAliases,
    communityKeymaps: catalog.communityKeymaps,
    generatedAt: catalog.generatedAt,
    totalKeyboards: keyboards.length,
    supportedKeyboards: supported,
    unsupportedByReason,
    keyboards: entries,
  };

  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return index;
}
