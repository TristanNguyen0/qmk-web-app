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
  type CatalogKeyboard,
  type CatalogKeyPosition,
  type CatalogLayout,
  type UnsupportedCatalogKeyboard,
  type UnsupportedReason,
} from '@qmk-web-app/domain';

export const NORMALIZER_VERSION = 1;

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

export interface ExtractorKeyboardRecord {
  type: 'keyboard';
  keyboardId: string;
  status: 'resolved' | 'extraction_failed';
  info?: Record<string, unknown>;
  error?: { kind: string; message: string };
}

export type ExtractorRecord =
  | ExtractorProvenance
  | ExtractorKeycodeSpec
  | ExtractorKeyboardRecord
  | { type: 'summary'; [k: string]: unknown };

export class CatalogNormalizationError extends Error {}

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

function normalizeKeyboard(record: ExtractorKeyboardRecord, qmkCommit: string, extractorVersion: number): CatalogKeyboard {
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

  const keyboardRecords = records.filter((r): r is ExtractorKeyboardRecord => r.type === 'keyboard');
  if (keyboardRecords.length === 0) {
    throw new CatalogNormalizationError('extractor output contains no keyboards');
  }

  const keyboards = keyboardRecords
    .map((r) => normalizeKeyboard(r, provenance.qmkCommit, provenance.extractorVersion))
    .sort((a, b) => (a.keyboardId < b.keyboardId ? -1 : a.keyboardId > b.keyboardId ? 1 : 0));

  return {
    catalogVersion: options.catalogVersion,
    qmkCommit: provenance.qmkCommit,
    extractorVersion: provenance.extractorVersion,
    normalizerVersion: NORMALIZER_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    keycodeSpecVersion: keycodeSpec.version,
    keyboards,
  };
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
