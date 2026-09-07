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

export interface CatalogDefaultKeymapLayer {
  /**
   * The layer's designator as written in QMK's keymap source — a C identifier such
   * as `_LOWER`, a number, or null when the source (keymap.json) names none.
   * Presentation and cross-reference only; never emitted into generated source.
   */
  name: string | null;
  /**
   * QMK keycode tokens verbatim, one per position of `layout`, exactly as QMK's own
   * keymap parser reports them. Aliases are NOT resolved (`KC_BSPC` stays `KC_BSPC`)
   * and composite keycodes are unparsed strings (`LT(1,KC_SPC)`). Interpreting them
   * is the product's job (see `default-keymap.ts`), not the catalog's.
   */
  keycodes: readonly string[];
}

/**
 * The keyboard's `default` keymap as shipped in the pinned QMK tree, resolved by
 * QMK's own locator and parser. A fact about the tree — the product uses it as a
 * starting point, clearly attributed, never as the user's own choices.
 */
export type CatalogDefaultKeymap =
  | {
      available: true;
      /** Path within the QMK tree, e.g. `keyboards/planck/keymaps/default/keymap.c`. */
      source: string;
      /** The layout macro every layer targets, resolved through QMK's layout aliases. */
      layout: string;
      layers: readonly CatalogDefaultKeymapLayer[];
    }
  | {
      available: false;
      reason: DefaultKeymapUnavailableReason;
      /** Operator-facing detail. Not shown to end users verbatim. */
      detail: string;
    };

/**
 * QMK's canonical keymap for one community layout (`layouts/default/<name>/…`), e.g.
 * the HHKB arrangement for `60_hhkb`. Global: which keyboards it applies to is each
 * keyboard's `communityLayouts`. Same verbatim-token contract as `CatalogDefaultKeymap`.
 */
export interface CatalogCommunityKeymap {
  /** Community layout name, e.g. `60_hhkb`. Also the layout macro minus `LAYOUT_`. */
  name: string;
  source: string;
  layers: readonly CatalogDefaultKeymapLayer[];
  /**
   * The layout's key geometry from `layouts/default/<name>/info.json`, one entry per
   * keymap position, in key units. Lets the keymap be laid onto a keyboard that does
   * not declare the layout, by matching physical positions exactly.
   */
  positions: readonly CatalogCommunityKeyGeometry[];
}

export interface CatalogCommunityKeyGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A community layout this keyboard supports, and the keyboard's own macro for it. */
export interface CatalogCommunityLayoutRef {
  /** e.g. `60_hhkb` — key into `Catalog.communityKeymaps`. */
  name: string;
  /** The keyboard's layout macro, after its `layout_aliases`; e.g. `LAYOUT_60_hhkb`. */
  layout: string;
}

export type DefaultKeymapUnavailableReason =
  | 'not_extracted'
  | 'not_found'
  | 'extraction_failed'
  | 'no_layers'
  | 'unknown_layout'
  | 'mixed_layouts'
  | 'layer_length_mismatch'
  | 'unreadable_keycode';

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
  defaultKeymap: CatalogDefaultKeymap;
  /**
   * Community layouts this keyboard declares AND for which the catalog holds a keymap
   * whose layers fit the keyboard's `LAYOUT_<name>` macro position for position. Each
   * is a grounded "layout preset" (HHKB, WKL, ISO, …) the product may offer.
   */
  communityLayouts: readonly CatalogCommunityLayoutRef[];
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
  /**
   * QMK's own alias table at the pinned revision: alias → canonical keycode name
   * (`KC_BSPC` → `KC_BACKSPACE`, `_______` → `KC_TRANSPARENT`). Read from the keycode
   * spec QMK ships, never hand-written. Needed to interpret default keymaps and any
   * other QMK-authored keycode text.
   */
  keycodeAliases: Readonly<Record<string, string>>;
  /** Keyed by community layout name. See `CatalogCommunityKeymap`. */
  communityKeymaps: Readonly<Record<string, CatalogCommunityKeymap>>;
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
