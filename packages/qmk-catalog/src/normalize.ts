/**
 * Normalizes raw extractor output into an immutable catalog.
 *
 * See docs/adr/0002-catalog-derives-from-qmk-tooling.md. The extractor resolves what
 * QMK itself reports; this module decides what the *product* is willing to expose.
 *
 * The governing rule is claude.md rule 2 — never invent metadata — implemented as:
 * every field is either read from the extractor output and type-checked, or the
 * keyboard becomes `unsupported` with a reason. Nothing is defaulted, inferred, or
 * repaired. There is deliberately no `?? 'unknown'` anywhere in this file.
 */
import {
  LIMITS,
  isValidKeyboardIdShape,
  type Catalog,
  type CatalogCommunityKeyGeometry,
  type CatalogCommunityKeymap,
  type CatalogDocChunk,
  type CatalogCommunityLayoutRef,
  type CatalogDefaultKeymap,
  type CatalogDefaultKeymapLayer,
  type CatalogKeyboard,
  type CatalogKeyPosition,
  type CatalogLayout,
  type DefaultKeymapUnavailableReason,
  type UnsupportedCatalogKeyboard,
  type UnsupportedReason,
} from '@qmk-web-app/domain';

/**
 * v2: default keymaps and the keycode alias table (extractor v2 dumps).
 * v3: community-layout keymaps and per-keyboard `communityLayouts` (extractor v3).
 * v4: community keymaps carry their layout geometry (extractor v4).
 * v5: the curated QMK documentation, chunked (extractor v5).
 */
export const NORMALIZER_VERSION = 5;

/**
 * Longest keycode token we will carry. QMK's longest real composite in a default
 * keymap is well under this; anything longer is not a keycode we can reason about.
 */
const MAX_KEYCODE_TOKEN_LENGTH = 64;

export interface ExtractorProvenance {
  type: 'provenance';
  extractorVersion: number;
  qmkCommit: string;
  commitSource: string;
  extractedAt: string;
}

export interface ExtractorKeycodeSpec {
  type: 'keycode_spec';
  version: string;
  keycodes: Record<string, { key?: unknown; group?: unknown; aliases?: unknown }>;
}

export interface ExtractorDefaultKeymap {
  status: 'resolved' | 'not_found' | 'failed';
  source?: unknown;
  format?: unknown;
  layers?: unknown;
  error?: { kind: string; message: string };
}

export interface ExtractorKeyboardRecord {
  type: 'keyboard';
  keyboardId: string;
  status: 'resolved' | 'extraction_failed';
  info?: Record<string, unknown>;
  /** Absent in extractor v1 dumps. */
  default_keymap?: ExtractorDefaultKeymap;
  error?: { kind: string; message: string };
}

export interface ExtractorCommunityKeymapRecord {
  type: 'community_keymap';
  layout: string;
  status: 'resolved' | 'failed';
  source?: unknown;
  layers?: unknown;
  /** The layout's `layout` array from its info.json; absent in v3 dumps. */
  positions?: unknown;
  error?: { kind: string; message: string };
}

export interface ExtractorDocsRecord {
  type: 'docs';
  source?: unknown;
  files?: unknown;
  chunks?: unknown;
}

export type ExtractorRecord =
  | ExtractorProvenance
  | ExtractorKeycodeSpec
  | ExtractorKeyboardRecord
  | ExtractorCommunityKeymapRecord
  | ExtractorDocsRecord
  | { type: 'summary'; [k: string]: unknown };

export class CatalogNormalizationError extends Error {}

/** Heading anchors QMK generates ({#some-anchor}) are navigation noise, not content. */
function stripHeadingAnchor(heading: string): string {
  return heading.replace(/\s*\{#[^}]*\}/g, '').trim();
}

/** Parses the NDJSON dump. Malformed lines are fatal — a partial catalog is worse than none. */
export function parseExtractorDump(ndjson: string): ExtractorRecord[] {
  const records: ExtractorRecord[] = [];
  const lines = ndjson.split('\n');
  for (const [i, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (cause) {
      throw new CatalogNormalizationError(`extractor output line ${i + 1} is not valid JSON`, {
        cause,
      });
    }
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { type?: unknown }).type !== 'string') {
      throw new CatalogNormalizationError(`extractor output line ${i + 1} has no record type`);
    }
    records.push(parsed as ExtractorRecord);
  }
  return records;
}

function unsupported(
  keyboardId: string,
  reason: UnsupportedReason,
  detail: string,
): UnsupportedCatalogKeyboard {
  return { supported: false, keyboardId, reason, detail };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Converts one QMK layout entry. Returns null when any position is unusable — a
 * layout with an unreadable key would render a keyboard the user cannot trust.
 */
function normalizeLayout(name: string, raw: unknown): CatalogLayout | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const layoutArray = (raw as { layout?: unknown }).layout;
  if (!Array.isArray(layoutArray) || layoutArray.length === 0) return null;
  if (layoutArray.length > LIMITS.maxPositionsPerLayout) return null;

  const positions: CatalogKeyPosition[] = [];
  for (const [index, entry] of layoutArray.entries()) {
    if (typeof entry !== 'object' || entry === null) return null;
    const e = entry as Record<string, unknown>;

    const matrix = e['matrix'];
    if (!Array.isArray(matrix) || matrix.length !== 2) return null;
    const row = asFiniteNumber(matrix[0]);
    const col = asFiniteNumber(matrix[1]);
    if (row === null || col === null || !Number.isInteger(row) || !Number.isInteger(col)) return null;

    const x = asFiniteNumber(e['x']);
    const y = asFiniteNumber(e['y']);
    if (x === null || y === null) return null;

    // Width/height are genuinely optional in QMK and default to 1 key unit *in QMK's
    // own renderer*, so taking 1 here is reading QMK's documented meaning, not
    // inventing a value. Anything present but unreadable still rejects the layout.
    const rawW = e['w'];
    const rawH = e['h'];
    const w = rawW === undefined ? 1 : asFiniteNumber(rawW);
    const h = rawH === undefined ? 1 : asFiniteNumber(rawH);
    if (w === null || h === null || w <= 0 || h <= 0) return null;

    // Rotation is absent on almost every keyboard; QMK's documented default is no
    // rotation. A value that is present but unreadable still rejects the layout.
    const rawR = e['r'];
    const rawRx = e['rx'];
    const rawRy = e['ry'];
    const r = rawR === undefined ? 0 : asFiniteNumber(rawR);
    const rx = rawRx === undefined ? 0 : asFiniteNumber(rawRx);
    const ry = rawRy === undefined ? 0 : asFiniteNumber(rawRy);
    if (r === null || rx === null || ry === null) return null;

    const label = typeof e['label'] === 'string' ? e['label'] : null;

    positions.push({ index, matrix: [row, col], x, y, w, h, r, rx, ry, label });
  }

  return { name, positions };
}

function unavailableDefaultKeymap(
  reason: DefaultKeymapUnavailableReason,
  detail: string,
): CatalogDefaultKeymap {
  return { available: false, reason, detail };
}

/**
 * Converts the extractor's default-keymap report. The layer data must line up with a
 * layout this keyboard actually declares, position for position; anything else is
 * recorded as unavailable with the observed reason rather than trimmed to fit.
 */
function normalizeDefaultKeymap(
  raw: ExtractorDefaultKeymap | undefined,
  layouts: readonly CatalogLayout[],
  layoutAliases: unknown,
): CatalogDefaultKeymap {
  if (raw === undefined) {
    return unavailableDefaultKeymap('not_extracted', 'extractor did not report a default keymap');
  }
  if (raw.status === 'not_found') {
    return unavailableDefaultKeymap('not_found', 'QMK found no default keymap for this keyboard');
  }
  if (raw.status !== 'resolved') {
    return unavailableDefaultKeymap(
      'extraction_failed',
      raw.error ? `${raw.error.kind}: ${raw.error.message}` : 'default keymap could not be read',
    );
  }
  if (typeof raw.source !== 'string' || raw.source === '') {
    return unavailableDefaultKeymap('extraction_failed', 'default keymap has no source path');
  }
  if (!Array.isArray(raw.layers) || raw.layers.length === 0) {
    return unavailableDefaultKeymap('no_layers', `${raw.source} declares no layers`);
  }

  // Every layer must name the same layout macro. The extractor records each layer's
  // macro as QMK parsed it; a keymap mixing macros has no single position mapping.
  const layoutNames = new Set<string>();
  for (const layer of raw.layers as unknown[]) {
    const name = (layer as { layout?: unknown } | null)?.layout;
    if (typeof name === 'string' && name !== '') layoutNames.add(name);
  }
  if (layoutNames.size === 0) {
    return unavailableDefaultKeymap('unknown_layout', `${raw.source} names no layout macro`);
  }
  if (layoutNames.size > 1) {
    return unavailableDefaultKeymap(
      'mixed_layouts',
      `${raw.source} uses more than one layout macro: ${[...layoutNames].sort().join(', ')}`,
    );
  }
  const [rawLayoutName] = [...layoutNames] as [string];

  // Resolve through QMK's own `layout_aliases` (info.json), the same table its
  // build uses, so `LAYOUT_planck_grid` reaches `LAYOUT_ortho_4x12`.
  let layoutName = rawLayoutName;
  if (typeof layoutAliases === 'object' && layoutAliases !== null) {
    const alias = (layoutAliases as Record<string, unknown>)[rawLayoutName];
    if (typeof alias === 'string' && alias !== '') layoutName = alias;
  }
  const layout = layouts.find((l) => l.name === layoutName);
  if (!layout) {
    return unavailableDefaultKeymap(
      'unknown_layout',
      `${raw.source} targets ${rawLayoutName}, which this keyboard does not declare`,
    );
  }

  const layers = readKeymapLayers(raw.layers as unknown[], raw.source, layout.positions.length, layoutName);
  if ('reason' in layers) return unavailableDefaultKeymap(layers.reason, layers.detail);

  return { available: true, source: raw.source, layout: layoutName, layers: layers.layers };
}

/**
 * Reads parsed keymap layers, requiring every layer to have exactly `expectedLength`
 * usable string tokens. Shared by the keyboard default and community keymaps so the
 * two cannot drift in what they accept.
 */
function readKeymapLayers(
  rawLayers: unknown[],
  source: string,
  expectedLength: number,
  layoutName: string,
): { layers: CatalogDefaultKeymapLayer[] } | { reason: DefaultKeymapUnavailableReason; detail: string } {
  const layers: CatalogDefaultKeymapLayer[] = [];
  for (const [index, entry] of rawLayers.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return { reason: 'unreadable_keycode', detail: `${source} layer ${index} is not an object` };
    }
    const e = entry as { name?: unknown; keycodes?: unknown };
    if (!Array.isArray(e.keycodes)) {
      return { reason: 'unreadable_keycode', detail: `${source} layer ${index} has no keycode list` };
    }
    if (e.keycodes.length !== expectedLength) {
      return {
        reason: 'layer_length_mismatch',
        detail: `${source} layer ${index} has ${e.keycodes.length} keycodes but ${layoutName} has ${expectedLength} positions`,
      };
    }
    const keycodes: string[] = [];
    for (const token of e.keycodes as unknown[]) {
      if (typeof token !== 'string' || token === '' || token.length > MAX_KEYCODE_TOKEN_LENGTH) {
        return { reason: 'unreadable_keycode', detail: `${source} layer ${index} contains a keycode token that is not a usable string` };
      }
      keycodes.push(token);
    }
    const name = typeof e.name === 'string' && e.name !== '' ? e.name : null;
    layers.push({ name, keycodes });
  }
  return { layers };
}

/**
 * A community keymap is usable only if every layer names `LAYOUT_<name>` and the
 * layers agree on length. The per-keyboard fit check (does this keyboard's
 * `LAYOUT_<name>` have that many positions?) happens in `communityLayoutsFor`.
 */
function normalizeCommunityKeymap(record: ExtractorCommunityKeymapRecord): CatalogCommunityKeymap | string {
  if (!/^[a-z0-9_]+$/.test(record.layout)) return `community layout name "${record.layout}" is not a usable identifier`;
  if (record.status !== 'resolved') return record.error ? `${record.error.kind}: ${record.error.message}` : 'not resolved';
  if (typeof record.source !== 'string' || record.source === '') return `${record.layout}: no source path`;
  if (!Array.isArray(record.layers) || record.layers.length === 0) return `${record.source} declares no layers`;
  const expectedMacro = `LAYOUT_${record.layout}`;
  for (const [i, layer] of (record.layers as unknown[]).entries()) {
    const macro = (layer as { layout?: unknown } | null)?.layout;
    if (macro !== expectedMacro) return `${record.source} layer ${i} uses ${String(macro)}, expected ${expectedMacro}`;
  }
  const first = (record.layers[0] as { keycodes?: unknown }).keycodes;
  const length = Array.isArray(first) ? first.length : -1;
  const layers = readKeymapLayers(record.layers as unknown[], record.source, length, expectedMacro);
  if ('reason' in layers) return layers.detail;

  // Some community defaults exist only to prove the macro compiles: `KC_A, KC_B, …`
  // repeated on every row (the ortho grids at the pinned revision). Offering one as a
  // "layout preset" would hand a user a keyboard that types abcdefghijkl. A real
  // arrangement binds nearly every base-layer key to something different (the lowest
  // genuine ratio at the pinned revision is 0.88; the patterns are at or below 0.25).
  const base = layers.layers[0]!.keycodes;
  const distinct = new Set(base).size / base.length;
  if (distinct <= PLACEHOLDER_DISTINCT_RATIO) {
    return `${record.source} is a placeholder pattern (${new Set(base).size} distinct keycodes across ${base.length} keys), not a usable arrangement`;
  }

  // Geometry, one entry per position. Width/height default to 1 as in QMK's own
  // renderer (the same reading normalizeLayout makes); anything unreadable rejects
  // the keymap, because a wrong geometry would lay keys onto the wrong switches.
  if (!Array.isArray(record.positions) || record.positions.length !== length) {
    return `${record.source}: layout geometry is missing or does not match the keymap (${Array.isArray(record.positions) ? record.positions.length : 'none'} vs ${length} keys)`;
  }
  const positions: CatalogCommunityKeyGeometry[] = [];
  for (const entry of record.positions as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return `${record.source}: unreadable key geometry`;
    const e = entry as Record<string, unknown>;
    const x = asFiniteNumber(e['x']);
    const y = asFiniteNumber(e['y']);
    const w = e['w'] === undefined ? 1 : asFiniteNumber(e['w']);
    const h = e['h'] === undefined ? 1 : asFiniteNumber(e['h']);
    if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return `${record.source}: unreadable key geometry`;
    positions.push({ x, y, w, h });
  }
  return { name: record.layout, source: record.source, layers: layers.layers, positions };
}

/** At or below this share of distinct base-layer keycodes a community keymap is a test pattern. */
const PLACEHOLDER_DISTINCT_RATIO = 0.5;

/**
 * The community layouts this keyboard declares that the catalog can actually offer:
 * the keymap exists, the keyboard has the `LAYOUT_<name>` macro (directly or via its
 * own `layout_aliases`), and the keymap's layers fit that macro position for position.
 */
function communityLayoutsFor(
  info: Record<string, unknown>,
  layouts: readonly CatalogLayout[],
  communityKeymaps: Readonly<Record<string, CatalogCommunityKeymap>>,
): CatalogCommunityLayoutRef[] {
  const declared = asStringArray(info['community_layouts']);
  const aliases = info['layout_aliases'];
  const result: CatalogCommunityLayoutRef[] = [];
  for (const name of [...new Set(declared)].sort()) {
    const keymap = communityKeymaps[name];
    if (!keymap) continue;
    let macro = `LAYOUT_${name}`;
    if (typeof aliases === 'object' && aliases !== null) {
      const target = (aliases as Record<string, unknown>)[macro];
      if (typeof target === 'string' && target !== '') macro = target;
    }
    const layout = layouts.find((l) => l.name === macro);
    if (!layout) continue;
    if (keymap.layers.some((l) => l.keycodes.length !== layout.positions.length)) continue;
    result.push({ name, layout: layout.name });
  }
  return result;
}

function normalizeKeyboard(
  record: ExtractorKeyboardRecord,
  qmkCommit: string,
  extractorVersion: number,
  communityKeymaps: Readonly<Record<string, CatalogCommunityKeymap>>,
): CatalogKeyboard {
  const { keyboardId } = record;

  if (!isValidKeyboardIdShape(keyboardId)) {
    return unsupported(keyboardId, 'extraction_failed', 'keyboard id is not a usable identifier');
  }
  if (record.status === 'extraction_failed' || !record.info) {
    return unsupported(
      keyboardId,
      'extraction_failed',
      record.error ? `${record.error.kind}: ${record.error.message}` : 'no info returned',
    );
  }

  const info = record.info;

  // QMK told us it had problems reading this keyboard. Trust that over our own
  // ability to make sense of the partial result (claude.md § Discovery, step 5).
  const parseErrors = asStringArray(info['parse_errors']);
  if (parseErrors.length > 0) {
    return unsupported(keyboardId, 'qmk_parse_errors', parseErrors.join('; '));
  }

  // A compile target needs all three of these. Missing any one means we cannot build
  // it, so it must not appear as selectable.
  const processor = info['processor'];
  const bootloader = info['bootloader'];
  if (typeof processor !== 'string' || processor === '') {
    return unsupported(keyboardId, 'missing_build_target', 'no processor reported');
  }
  if (typeof bootloader !== 'string' || bootloader === '') {
    return unsupported(keyboardId, 'missing_build_target', 'no bootloader reported');
  }

  const rawLayouts = info['layouts'];
  if (typeof rawLayouts !== 'object' || rawLayouts === null) {
    return unsupported(keyboardId, 'no_layouts', 'no layouts reported');
  }

  const layouts: CatalogLayout[] = [];
  const rejected: string[] = [];
  // Sorted for deterministic catalog output.
  for (const name of Object.keys(rawLayouts as Record<string, unknown>).sort()) {
    const normalized = normalizeLayout(name, (rawLayouts as Record<string, unknown>)[name]);
    if (normalized) layouts.push(normalized);
    else rejected.push(name);
  }

  if (layouts.length === 0) {
    return unsupported(
      keyboardId,
      rejected.length > 0 ? 'layout_position_invalid' : 'no_layouts',
      rejected.length > 0
        ? `every layout had unusable position data: ${rejected.join(', ')}`
        : 'no layouts reported',
    );
  }

  const features: Record<string, boolean> = {};
  const rawFeatures = info['features'];
  if (typeof rawFeatures === 'object' && rawFeatures !== null) {
    for (const [key, value] of Object.entries(rawFeatures as Record<string, unknown>).sort()) {
      if (typeof value === 'boolean') features[key] = value;
    }
  }

  const keyboardName = info['keyboard_name'];
  const manufacturer = info['manufacturer'];
  const url = info['url'];
  const keyboardFolder = info['keyboard_folder'];

  return {
    supported: true,
    keyboardId,
    // Display name falls back to the id — that is not invention, it is showing the
    // identifier we already know rather than inventing a friendly name.
    displayName: typeof keyboardName === 'string' && keyboardName !== '' ? keyboardName : keyboardId,
    manufacturer: typeof manufacturer === 'string' && manufacturer !== '' ? manufacturer : null,
    url: typeof url === 'string' && url !== '' ? url : null,
    processor,
    bootloader,
    platform: typeof info['platform'] === 'string' ? (info['platform'] as string) : null,
    layouts,
    features,
    defaultKeymap: normalizeDefaultKeymap(record.default_keymap, layouts, info['layout_aliases']),
    communityLayouts: communityLayoutsFor(info, layouts, communityKeymaps),
    provenance: {
      keyboardFolder: typeof keyboardFolder === 'string' ? keyboardFolder : keyboardId,
      qmkCommit,
      extractorVersion,
      parseWarnings: asStringArray(info['parse_warnings']),
    },
  };
}

export interface NormalizeOptions {
  catalogVersion: string;
  /** The commit the caller pinned. Must match the extractor's provenance. */
  expectedQmkCommit: string;
  /** Injected so catalog output is reproducible in tests. */
  generatedAt?: string;
}

export function normalizeCatalog(records: readonly ExtractorRecord[], options: NormalizeOptions): Catalog {
  const provenance = records.find((r): r is ExtractorProvenance => r.type === 'provenance');
  if (!provenance) {
    throw new CatalogNormalizationError('extractor output has no provenance record');
  }
  if (provenance.qmkCommit !== options.expectedQmkCommit) {
    throw new CatalogNormalizationError(
      `extractor reported commit ${provenance.qmkCommit}, expected ${options.expectedQmkCommit}`,
    );
  }

  const keycodeSpec = records.find((r): r is ExtractorKeycodeSpec => r.type === 'keycode_spec');
  if (!keycodeSpec) {
    throw new CatalogNormalizationError('extractor output has no keycode spec record');
  }

  const docChunks: CatalogDocChunk[] = [];
  const docsRecord = records.find((r): r is ExtractorDocsRecord => r.type === 'docs');
  if (docsRecord) {
    if (!Array.isArray(docsRecord.chunks)) throw new CatalogNormalizationError('docs record has no chunk list');
    for (const entry of docsRecord.chunks as unknown[]) {
      if (typeof entry !== 'object' || entry === null) {
        throw new CatalogNormalizationError('docs record contains a chunk that is not an object');
      }
      const e = entry as Record<string, unknown>;
      const doc = e['doc'];
      const heading = stripHeadingAnchor(typeof e['heading'] === 'string' ? e['heading'] : '');
      const text = e['text'];
      if (typeof doc !== 'string' || !/^[a-z0-9_]+$/.test(doc) || heading === '' || typeof text !== 'string' || text === '') {
        throw new CatalogNormalizationError('docs record contains an unusable chunk');
      }
      if (text.length > 4000) throw new CatalogNormalizationError(`docs chunk from ${doc} is unexpectedly large`);
      docChunks.push({ doc, heading, text });
    }
    docChunks.sort((a, b) => (a.doc + a.heading < b.doc + b.heading ? -1 : 1));
  }

  const keyboardRecords = records.filter((r): r is ExtractorKeyboardRecord => r.type === 'keyboard');
  if (keyboardRecords.length === 0) {
    throw new CatalogNormalizationError('extractor output contains no keyboards');
  }

  // Global first, so each keyboard can be checked against the keymaps that exist.
  const communityKeymaps: Record<string, CatalogCommunityKeymap> = {};
  for (const r of records) {
    if (r.type !== 'community_keymap') continue;
    const normalized = normalizeCommunityKeymap(r);
    // A failed community keymap is simply not offered; it is not a catalog error.
    if (typeof normalized !== 'string') communityKeymaps[normalized.name] = normalized;
  }

  const keyboards = keyboardRecords
    .map((r) => normalizeKeyboard(r, provenance.qmkCommit, provenance.extractorVersion, communityKeymaps))
    .sort((a, b) => (a.keyboardId < b.keyboardId ? -1 : a.keyboardId > b.keyboardId ? 1 : 0));

  return {
    catalogVersion: options.catalogVersion,
    qmkCommit: provenance.qmkCommit,
    extractorVersion: provenance.extractorVersion,
    normalizerVersion: NORMALIZER_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    keycodeSpecVersion: keycodeSpec.version,
    keycodeAliases: keycodeAliasesFromSpec(keycodeSpec),
    communityKeymaps: Object.fromEntries(Object.entries(communityKeymaps).sort(([a], [b]) => (a < b ? -1 : 1))),
    docChunks,
    keyboards,
  };
}

/**
 * QMK's alias table: alias → canonical `key` name, exactly as the spec lists it. Sorted
 * so catalog output is deterministic.
 */
export function keycodeAliasesFromSpec(spec: ExtractorKeycodeSpec): Record<string, string> {
  const pairs: [string, string][] = [];
  for (const entry of Object.values(spec.keycodes)) {
    if (typeof entry.key !== 'string') continue;
    for (const alias of asStringArray(entry.aliases)) {
      // QMK uses "!reset!" as a sentinel in alias lists, not a keycode name.
      if (!alias.startsWith('!')) pairs.push([alias, entry.key]);
    }
  }
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(pairs);
}

/** The set of keycode names QMK defines at the pinned revision, for allowlist checks. */
export function keycodeNamesFromSpec(spec: ExtractorKeycodeSpec): Set<string> {
  const names = new Set<string>();
  for (const entry of Object.values(spec.keycodes)) {
    if (typeof entry.key === 'string') names.add(entry.key);
    for (const alias of asStringArray(entry.aliases)) {
      // QMK uses "!reset!" as a sentinel in alias lists, not a keycode name.
      if (!alias.startsWith('!')) names.add(alias);
    }
  }
  return names;
}
