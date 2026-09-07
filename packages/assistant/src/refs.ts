/**
 * Resolving the loose references a model emits into exact product values.
 *
 * Every function here answers with a value the rest of the system already trusts
 * (a supported keycode name, a layout position index, a layer index) or with a typed
 * failure carrying enough detail for a retry prompt. Nothing here guesses: an
 * ambiguous legend is a failure listing the candidates, not a coin flip.
 */
import {
  SUPPORTED_KEYCODES,
  SUPPORTED_KEYCODE_NAMES,
  type Binding,
  type CatalogLayout,
  type Layer,
} from '@qmk-web-app/domain';
import type { KeyRef, LayerRef } from './proposal.ts';

/**
 * Everyday names for supported keycodes. Presentation-side only — it maps *into* the
 * allowlist and can never widen it. Names QMK itself uses (aliases, canonical names)
 * are not repeated here; they come from the catalog's alias table.
 */
const COMMON_NAMES: Readonly<Record<string, string>> = Object.freeze({
  delete: 'KC_DELETE',
  del: 'KC_DELETE',
  backspace: 'KC_BACKSPACE',
  bksp: 'KC_BACKSPACE',
  bspc: 'KC_BACKSPACE',
  enter: 'KC_ENTER',
  return: 'KC_ENTER',
  escape: 'KC_ESCAPE',
  esc: 'KC_ESCAPE',
  space: 'KC_SPACE',
  spacebar: 'KC_SPACE',
  tab: 'KC_TAB',
  insert: 'KC_INSERT',
  ins: 'KC_INSERT',
  capslock: 'KC_CAPS_LOCK',
  caps: 'KC_CAPS_LOCK',
  ctrl: 'KC_LEFT_CTRL',
  control: 'KC_LEFT_CTRL',
  lctrl: 'KC_LEFT_CTRL',
  rctrl: 'KC_RIGHT_CTRL',
  shift: 'KC_LEFT_SHIFT',
  lshift: 'KC_LEFT_SHIFT',
  rshift: 'KC_RIGHT_SHIFT',
  alt: 'KC_LEFT_ALT',
  lalt: 'KC_LEFT_ALT',
  ralt: 'KC_RIGHT_ALT',
  altgr: 'KC_RIGHT_ALT',
  option: 'KC_LEFT_ALT',
  gui: 'KC_LEFT_GUI',
  lgui: 'KC_LEFT_GUI',
  rgui: 'KC_RIGHT_GUI',
  win: 'KC_LEFT_GUI',
  windows: 'KC_LEFT_GUI',
  cmd: 'KC_LEFT_GUI',
  command: 'KC_LEFT_GUI',
  super: 'KC_LEFT_GUI',
  meta: 'KC_LEFT_GUI',
  up: 'KC_UP',
  down: 'KC_DOWN',
  left: 'KC_LEFT',
  right: 'KC_RIGHT',
  home: 'KC_HOME',
  end: 'KC_END',
  pageup: 'KC_PAGE_UP',
  pgup: 'KC_PAGE_UP',
  pagedown: 'KC_PAGE_DOWN',
  pgdn: 'KC_PAGE_DOWN',
  numlock: 'KC_NUM_LOCK',
  minus: 'KC_MINUS',
  dash: 'KC_MINUS',
  hyphen: 'KC_MINUS',
  equal: 'KC_EQUAL',
  equals: 'KC_EQUAL',
  comma: 'KC_COMMA',
  period: 'KC_DOT',
  dot: 'KC_DOT',
  slash: 'KC_SLASH',
  backslash: 'KC_BACKSLASH',
  semicolon: 'KC_SEMICOLON',
  quote: 'KC_QUOTE',
  apostrophe: 'KC_QUOTE',
  grave: 'KC_GRAVE',
  backtick: 'KC_GRAVE',
  tilde: 'KC_GRAVE',
  lbracket: 'KC_LEFT_BRACKET',
  rbracket: 'KC_RIGHT_BRACKET',
  transparent: 'KC_TRANSPARENT',
  trns: 'KC_TRANSPARENT',
  none: 'KC_NO',
  noop: 'KC_NO',
});

const LABEL_TO_NAME: ReadonlyMap<string, string> = new Map(
  SUPPORTED_KEYCODES.map((k) => [k.label.toLowerCase(), k.name]),
);

function fold(text: string): string {
  return text.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * A keycode reference → supported canonical name, or null. Accepts canonical names,
 * QMK aliases (via the catalog table), editor labels, and common names. Case matters
 * for nothing except that a bare single character means the letter/digit key.
 */
export function resolveKeycode(ref: string, aliases: Readonly<Record<string, string>>): string | null {
  const trimmed = ref.trim();
  if (trimmed === '') return null;

  const upper = trimmed.toUpperCase();
  if (SUPPORTED_KEYCODE_NAMES.has(upper)) return upper;
  const aliased = aliases[upper] ?? aliases[trimmed];
  if (aliased && SUPPORTED_KEYCODE_NAMES.has(aliased)) return aliased;

  if (/^[A-Za-z]$/.test(trimmed)) return `KC_${upper}`;
  if (/^[0-9]$/.test(trimmed)) return `KC_${trimmed}`;

  const byLabel = LABEL_TO_NAME.get(trimmed.toLowerCase());
  if (byLabel) return byLabel;

  const common = COMMON_NAMES[fold(trimmed)];
  if (common) return common;

  // `KC_`-less spellings of canonical names: `LEFT_CTRL`, `left ctrl`, `page up`.
  const asName = `KC_${trimmed.toUpperCase().replace(/[\s-]+/g, '_')}`;
  if (SUPPORTED_KEYCODE_NAMES.has(asName)) return asName;
  const asAlias = aliases[asName];
  if (asAlias && SUPPORTED_KEYCODE_NAMES.has(asAlias)) return asAlias;

  return null;
}

export interface LayerResolution {
  ok: true;
  index: number;
}
export interface RefFailure {
  ok: false;
  reason: string;
  /** Concrete alternatives a retry can use. */
  candidates?: string[];
}

export function resolveLayer(ref: LayerRef, layers: readonly Layer[]): LayerResolution | RefFailure {
  if (typeof ref === 'number') {
    if (layers.some((l) => l.index === ref)) return { ok: true, index: ref };
    return {
      ok: false,
      reason: `there is no layer ${ref}; the configuration has ${layers.length} layer${layers.length === 1 ? '' : 's'} (0–${layers.length - 1})`,
      candidates: layers.map((l) => `${l.index} (${l.name})`),
    };
  }
  const wanted = fold(ref);
  if (wanted === 'base' || wanted === 'default' || wanted === 'layer0') return { ok: true, index: 0 };
  const numeric = /^(?:layer)?(\d+)$/.exec(wanted);
  if (numeric) return resolveLayer(Number(numeric[1]), layers);

  const matches = layers.filter((l) => fold(l.name) === wanted);
  if (matches.length === 1) return { ok: true, index: matches[0]!.index };
  if (matches.length > 1) {
    return {
      ok: false,
      reason: `more than one layer is named "${ref}"; refer to it by index`,
      candidates: matches.map((l) => `${l.index} (${l.name})`),
    };
  }
  return {
    ok: false,
    reason: `no layer is named "${ref}"; add it first with add_layer, or refer to an existing layer`,
    candidates: layers.map((l) => `${l.index} (${l.name})`),
  };
}

export interface KeyResolution {
  ok: true;
  position: number;
}

/** The legends the resolver and the prompt context agree on. */
export function keycodeOfBinding(binding: Binding | undefined): string | null {
  if (!binding) return null;
  switch (binding.kind) {
    case 'keycode':
      return binding.keycode;
    case 'transparent':
      return 'KC_TRANSPARENT';
    case 'no_op':
      return 'KC_NO';
    default:
      return null;
  }
}

/** Tap keycode of a dual-role binding, for second-preference matching. */
function tapOfBinding(binding: Binding | undefined): string | null {
  if (!binding) return null;
  if (binding.kind === 'layer_tap' || binding.kind === 'mod_tap') return binding.tap;
  return null;
}

/** `position 36 (row 4, key 1)` — a hint a model can reason about. */
export function describePosition(position: number, layout: CatalogLayout): string {
  const rows = rowsOf(layout);
  for (const [r, row] of rows.entries()) {
    const c = row.findIndex((p) => p.index === position);
    if (c >= 0) return `position ${position} (row ${r + 1}, key ${c + 1})`;
  }
  return `position ${position}`;
}

/**
 * Positions grouped into physical rows and ordered by x. Rows are one key unit apart
 * while column stagger (Corne, Kyria, …) offsets keys within a row by well under half
 * a unit, so a key starts a new row when it sits more than half a unit below the key
 * that opened the current one.
 */
export function rowsOf(layout: CatalogLayout): CatalogLayout['positions'][number][][] {
  const sorted = [...layout.positions].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: CatalogLayout['positions'][number][][] = [];
  let rowStartY = Number.NEGATIVE_INFINITY;
  for (const p of sorted) {
    if (p.y - rowStartY > 0.5) {
      rows.push([]);
      rowStartY = p.y;
    }
    rows[rows.length - 1]!.push(p);
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x || a.index - b.index);
  return rows;
}

/**
 * A key reference → layout position. A `key` legend is matched against the base
 * layer's bindings first (what the user sees printed on the key in the editor), then
 * dual-role taps, then QMK's own labels from the catalog. One match resolves; several
 * are reported with their positions so the caller can ask for a `position` instead.
 */
export function resolveKey(
  ref: KeyRef,
  context: { layout: CatalogLayout; baseLayer: Layer | undefined; aliases: Readonly<Record<string, string>> },
): KeyResolution | RefFailure {
  const { layout, baseLayer, aliases } = context;
  const valid = new Set(layout.positions.map((p) => p.index));

  if ('position' in ref) {
    if (valid.has(ref.position)) return { ok: true, position: ref.position };
    return { ok: false, reason: `position ${ref.position} does not exist; this layout has positions 0–${layout.positions.length - 1}` };
  }

  const legend = ref.key.trim();
  const wantedKeycode = resolveKeycode(legend, aliases);
  const bindings = baseLayer?.bindings ?? {};

  const tiers: number[][] = [[], [], []];
  for (const p of layout.positions) {
    const binding = bindings[String(p.index)];
    if (wantedKeycode && keycodeOfBinding(binding) === wantedKeycode) tiers[0]!.push(p.index);
    else if (wantedKeycode && tapOfBinding(binding) === wantedKeycode) tiers[1]!.push(p.index);
    else if (p.label !== null && fold(p.label) === fold(legend)) tiers[2]!.push(p.index);
  }

  const matches = tiers.find((t) => t.length > 0);
  if (!matches) {
    return {
      ok: false,
      reason: wantedKeycode
        ? `no key on the base layer is bound to ${wantedKeycode} ("${legend}"); refer to it by position`
        : `"${legend}" is not a keycode or key label this product knows; refer to the key by position`,
    };
  }
  if (matches.length === 1) return { ok: true, position: matches[0]! };
  return {
    ok: false,
    reason: `"${legend}" matches ${matches.length} keys; use one of the positions instead`,
    candidates: matches.map((m) => describePosition(m, layout)),
  };
}
