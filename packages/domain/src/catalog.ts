/**
 * The normalized catalog types the API serves and the generator consumes.
 *
 * Everything here is *proven* from the pinned QMK tree. There is no field that the
 * normalizer is allowed to invent or default (claude.md rule 2). Anything that could
 * not be proven makes the entry `unsupported` with a reason instead.
 */

export interface CatalogKeyPosition {
  /** Index within the layout array. This is the `positionId` used in configurations. */
  index: number;
  /** Matrix [row, col] as reported by QMK. */
  matrix: readonly [number, number];
  /** Physical placement in QMK key units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Rotation in degrees and its centre, per QMK's `r`/`rx`/`ry`
   * (data/schemas/keyboard.jsonschema). Zero for the vast majority of keyboards, but
   * ~15 in the pinned tree rotate keys, and dropping this would draw those boards
   * wrong. Carried through so the renderer shows what QMK actually describes.
   */
  r: number;
  rx: number;
  ry: number;
  /** QMK's label for the position, when it provides one. Presentation only. */
  label: string | null;
}

export interface CatalogLayout {
  /** The QMK LAYOUT macro name, e.g. `LAYOUT_split_3x6_3`. */
  name: string;
  positions: readonly CatalogKeyPosition[];
}

export interface CatalogKeyboardProvenance {
  /** Path within the QMK tree this record was resolved from. */
  keyboardFolder: string;
  qmkCommit: string;
  extractorVersion: number;
  /** Warnings QMK itself reported while resolving this keyboard. */
  parseWarnings: readonly string[];
}

export interface SupportedCatalogKeyboard {
  supported: true;
  keyboardId: string;
  displayName: string;
  manufacturer: string | null;
  url: string | null;
  processor: string;
  bootloader: string;
  platform: string | null;
  layouts: readonly CatalogLayout[];
  /** QMK feature flags as reported, used for capability gating. */
  features: Readonly<Record<string, boolean>>;
  provenance: CatalogKeyboardProvenance;
}

/**
 * Reasons a keyboard is excluded. Each maps to something observed, never guessed
 * (claude.md § Discovery process, step 5).
 */
export type UnsupportedReason =
  | 'extraction_failed'
  | 'qmk_parse_errors'
  | 'no_layouts'
  | 'missing_build_target'
  | 'layout_position_invalid'
  | 'layout_too_large';

export interface UnsupportedCatalogKeyboard {
  supported: false;
  keyboardId: string;
  reason: UnsupportedReason;
  /** Operator-facing detail. Not shown to end users verbatim. */
  detail: string;
}

export type CatalogKeyboard = SupportedCatalogKeyboard | UnsupportedCatalogKeyboard;

export interface Catalog {
  catalogVersion: string;
  qmkCommit: string;
  extractorVersion: number;
  normalizerVersion: number;
  generatedAt: string;
  /** Keycode spec version resolved from the pinned tree. */
  keycodeSpecVersion: string;
  keyboards: readonly CatalogKeyboard[];
}

export interface CatalogSummary {
  catalogVersion: string;
  qmkCommit: string;
  totalKeyboards: number;
  supportedKeyboards: number;
  unsupportedByReason: Readonly<Record<string, number>>;
}

export function summarizeCatalog(catalog: Catalog): CatalogSummary {
  const unsupportedByReason: Record<string, number> = {};
  let supported = 0;
  for (const kb of catalog.keyboards) {
    if (kb.supported) supported += 1;
    else unsupportedByReason[kb.reason] = (unsupportedByReason[kb.reason] ?? 0) + 1;
  }
  return {
    catalogVersion: catalog.catalogVersion,
    qmkCommit: catalog.qmkCommit,
    totalKeyboards: catalog.keyboards.length,
    supportedKeyboards: supported,
    unsupportedByReason,
  };
}
