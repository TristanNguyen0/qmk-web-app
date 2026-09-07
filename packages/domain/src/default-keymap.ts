/**
 * Turns a keyboard's QMK default keymap (a catalog fact) into a starting-point set of
 * layers in the product's binding model.
 *
 * The catalog stores what QMK's parser reports: verbatim keycode tokens per position
 * of the layout the default keymap was written for. This module interprets those
 * tokens, and only in ways that are checkable against the pinned tree:
 *
 *  - Aliases resolve through QMK's own alias table (`Catalog.keycodeAliases`).
 *  - Plain keycodes bind only if they are in the product's supported catalog.
 *  - `MO(n)`, `TG(n)`, `LT(n,kc)` and the single-modifier tap-hold macros
 *    (`LCTL_T(kc)`, `MT(MOD_LSFT,kc)` …) map to the matching binding kinds. The
 *    macro names come from quantum/quantum_keycodes.h at the pinned revision.
 *  - Positions are carried across layouts by matrix coordinate — the same physical
 *    switch — so a default written for `LAYOUT_all` still seeds `LAYOUT_tkl_ansi`.
 *
 * Everything else is reported in `unmapped` and the position stays visibly unassigned
 * (claude.md § Visual keymap editor: "never silently remap"). Nothing is substituted.
 */
import type {
  CatalogCommunityKeymap,
  CatalogDefaultKeymap,
  CatalogDefaultKeymapLayer,
  CatalogLayout,
  SupportedCatalogKeyboard,
} from './catalog.ts';
import type { Binding, Layer } from './configuration.ts';
import { MOD_TAP_MODIFIERS, SUPPORTED_KEYCODE_NAMES } from './keycodes.ts';
import { LIMITS } from './limits.ts';

export interface UnmappedDefaultKey {
  layerIndex: number;
  position: number;
  /** The token as written in QMK's keymap, after whitespace removal. */
  keycode: string;
}

export interface DefaultKeymapImport {
  available: true;
  /** Path within the QMK tree the default came from, for attribution in the UI. */
  source: string;
  /** Layout the default keymap was written for; may differ from the target layout. */
  sourceLayout: string;
  layers: Layer[];
  /** Tokens the product cannot represent; their positions are left unassigned. */
  unmapped: UnmappedDefaultKey[];
  /** Layers beyond `LIMITS.maxLayers` that were not imported. */
  droppedLayers: number;
  /** Target positions that have no counterpart in the source layout. */
  unmatchedPositions: number;
}

export interface DefaultKeymapUnavailable {
  available: false;
  reason: string;
}

export interface ImportDefaultKeymapOptions {
  keyboard: SupportedCatalogKeyboard;
  layoutId: string;
  keycodeAliases: Readonly<Record<string, string>>;
  /** Injected so tests are deterministic. */
  newId?: () => string;
}

/**
 * Hold-modifier macro name → the `MOD_*` it expands to, per quantum_keycodes.h.
 * Multi-modifier forms (`LCS_T`, `MEH_T`, …) are absent on purpose: the product's
 * mod-tap supports one modifier (`MOD_TAP_MODIFIERS`).
 */
const MOD_TAP_MACRO_TO_MOD: Readonly<Record<string, string>> = Object.freeze({
  LCTL_T: 'MOD_LCTL',
  CTL_T: 'MOD_LCTL',
  LSFT_T: 'MOD_LSFT',
  SFT_T: 'MOD_LSFT',
  LALT_T: 'MOD_LALT',
  ALT_T: 'MOD_LALT',
  LOPT_T: 'MOD_LALT',
  OPT_T: 'MOD_LALT',
  LGUI_T: 'MOD_LGUI',
  GUI_T: 'MOD_LGUI',
  LCMD_T: 'MOD_LGUI',
  CMD_T: 'MOD_LGUI',
  LWIN_T: 'MOD_LGUI',
  WIN_T: 'MOD_LGUI',
  RCTL_T: 'MOD_RCTL',
  RSFT_T: 'MOD_RSFT',
  RALT_T: 'MOD_RALT',
  ROPT_T: 'MOD_RALT',
  ALGR_T: 'MOD_RALT',
  RGUI_T: 'MOD_RGUI',
  RCMD_T: 'MOD_RGUI',
  RWIN_T: 'MOD_RGUI',
});

/** `MOD_*` → the modifier keycode the product's mod-tap binding uses as its hold. */
const MOD_TO_KEYCODE: Readonly<Record<string, string>> = Object.freeze({
  MOD_LCTL: 'KC_LEFT_CTRL',
  MOD_LSFT: 'KC_LEFT_SHIFT',
  MOD_LALT: 'KC_LEFT_ALT',
  MOD_LGUI: 'KC_LEFT_GUI',
  MOD_RCTL: 'KC_RIGHT_CTRL',
  MOD_RSFT: 'KC_RIGHT_SHIFT',
  MOD_RALT: 'KC_RIGHT_ALT',
  MOD_RGUI: 'KC_RIGHT_GUI',
});

const COMPOSITE = /^([A-Z][A-Z0-9_]*)\((.*)\)$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function canonical(token: string, aliases: Readonly<Record<string, string>>): string {
  return aliases[token] ?? token;
}

/** Splits `a,b` at the top level only — arguments may themselves contain parentheses. */
function splitArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of inner) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      args.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  args.push(current);
  return args;
}

interface LayerRefContext {
  /** Layer designators in array order, used to resolve `MO(_LOWER)`. */
  namesByIndex: readonly (string | null)[];
  layerCount: number;
}

/**
 * Resolves a layer argument to an index. A number is taken as written. A C identifier
 * resolves to the layer whose designator it is — `[_LOWER] = LAYOUT(...)` makes
 * `_LOWER` that layer's index by definition. `#define`d names have already become
 * numbers in the preprocessor, and an identifier not used as a designator (or a
 * reference beyond the imported layers) is unresolvable.
 */
function resolveLayer(arg: string, ctx: LayerRefContext): number | null {
  let index: number;
  if (/^\d+$/.test(arg)) {
    index = Number(arg);
  } else if (IDENTIFIER.test(arg)) {
    index = ctx.namesByIndex.indexOf(arg);
    if (index < 0) return null;
  } else {
    return null;
  }
  return index < ctx.layerCount ? index : null;
}

function plainKeycode(token: string, aliases: Readonly<Record<string, string>>): string | null {
  const name = canonical(token, aliases);
  return SUPPORTED_KEYCODE_NAMES.has(name) ? name : null;
}

/** Interprets one token, or returns null when the product cannot represent it. */
export function bindingFromQmkToken(
  rawToken: string,
  aliases: Readonly<Record<string, string>>,
  ctx: LayerRefContext,
): Binding | null {
  const token = rawToken.replace(/\s+/g, '');

  const plain = plainKeycode(token, aliases);
  if (plain === 'KC_TRANSPARENT') return { kind: 'transparent' };
  if (plain === 'KC_NO') return { kind: 'no_op' };
  if (plain) return { kind: 'keycode', keycode: plain };

  const composite = COMPOSITE.exec(token);
  if (!composite) return null;
  const [, fn, inner] = composite as unknown as [string, string, string];
  const args = splitArgs(inner);

  if ((fn === 'MO' || fn === 'TG') && args.length === 1) {
    const layer = resolveLayer(args[0] as string, ctx);
    if (layer === null) return null;
    return fn === 'MO' ? { kind: 'layer_momentary', layer } : { kind: 'layer_toggle', layer };
  }

  if (fn === 'LT' && args.length === 2) {
    const layer = resolveLayer(args[0] as string, ctx);
    const tap = plainKeycode(args[1] as string, aliases);
    if (layer === null || tap === null || tap === 'KC_TRANSPARENT' || tap === 'KC_NO') return null;
    return { kind: 'layer_tap', layer, tap };
  }

  let mod: string | undefined;
  let tapArg: string | undefined;
  if (fn === 'MT' && args.length === 2) {
    mod = args[0];
    tapArg = args[1];
  } else if (args.length === 1 && fn in MOD_TAP_MACRO_TO_MOD) {
    mod = MOD_TAP_MACRO_TO_MOD[fn];
    tapArg = args[0];
  }
  if (mod !== undefined && tapArg !== undefined) {
    const hold = MOD_TO_KEYCODE[mod];
    const tap = plainKeycode(tapArg, aliases);
    if (!hold || !MOD_TAP_MODIFIERS.has(hold) || tap === null) return null;
    if (tap === 'KC_TRANSPARENT' || tap === 'KC_NO') return null;
    return { kind: 'mod_tap', hold, tap };
  }

  return null;
}

/** Layer display name from a QMK designator: `_LOWER` → `Lower`, `0` → `Base`, `3` → `Layer 3`. */
export function layerNameFromDesignator(name: string | null, index: number): string {
  if (name === null || /^\d+$/.test(name)) return index === 0 ? 'Base' : `Layer ${index}`;
  const stripped = name.replace(/^_+/, '').replace(/_+/g, ' ').trim();
  if (stripped === '') return index === 0 ? 'Base' : `Layer ${index}`;
  const pretty = stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase();
  return pretty.slice(0, LIMITS.maxLayerNameLength);
}

function matrixKey(matrix: readonly [number, number]): string {
  return `${matrix[0]},${matrix[1]}`;
}

/**
 * Maps each target position to the source-layout index holding the same matrix
 * coordinate, or -1 when the source layout has no such switch.
 */
function positionMapping(target: CatalogLayout, source: CatalogLayout): number[] {
  if (target.name === source.name) return target.positions.map((p) => p.index);
  const bySwitch = new Map<string, number>();
  for (const p of source.positions) bySwitch.set(matrixKey(p.matrix), p.index);
  return target.positions.map((p) => bySwitch.get(matrixKey(p.matrix)) ?? -1);
}

/** A keymap as the catalog carries it, from either source, plus where it came from. */
interface KeymapSource {
  source: string;
  /** Layout the keymap was written for — a name for attribution. */
  layout: string;
  layers: readonly CatalogDefaultKeymapLayer[];
}

/** The shared core: carry `keymap` onto `layoutId` of `keyboard` through `mapping`, reporting everything it cannot represent. */
function importKeymap(
  keyboard: SupportedCatalogKeyboard,
  layoutId: string,
  keymap: KeymapSource,
  /** For each target position index, the keymap position holding the same physical key, or -1. */
  mappingFor: (target: CatalogLayout) => number[],
  keycodeAliases: Readonly<Record<string, string>>,
  newId: () => string,
): DefaultKeymapImport | DefaultKeymapUnavailable {
  const target = keyboard.layouts.find((l) => l.name === layoutId);
  if (!target) return { available: false, reason: 'unknown_layout' };

  const mapping = mappingFor(target);
  const unmatchedPositions = mapping.filter((i) => i < 0).length;

  const imported = keymap.layers.slice(0, LIMITS.maxLayers);
  const ctx: LayerRefContext = {
    namesByIndex: keymap.layers.map((l) => l.name),
    layerCount: imported.length,
  };

  const layers: Layer[] = [];
  const unmapped: UnmappedDefaultKey[] = [];
  for (const [layerIndex, sourceLayer] of imported.entries()) {
    const bindings: Layer['bindings'] = {};
    for (const position of target.positions) {
      const sourceIndex = mapping[position.index] as number;
      if (sourceIndex < 0) continue;
      const token = sourceLayer.keycodes[sourceIndex];
      if (token === undefined) continue;
      const binding = bindingFromQmkToken(token, keycodeAliases, ctx);
      if (binding) bindings[String(position.index)] = binding;
      else unmapped.push({ layerIndex, position: position.index, keycode: token.replace(/\s+/g, '') });
    }
    layers.push({
      id: newId(),
      index: layerIndex,
      name: layerNameFromDesignator(sourceLayer.name, layerIndex),
      bindings,
    });
  }

  return {
    available: true,
    source: keymap.source,
    sourceLayout: keymap.layout,
    layers,
    unmapped,
    droppedLayers: keymap.layers.length - imported.length,
    unmatchedPositions,
  };
}

export function importDefaultKeymap(
  options: ImportDefaultKeymapOptions,
): DefaultKeymapImport | DefaultKeymapUnavailable {
  const { keyboard, layoutId, keycodeAliases } = options;
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());

  // Catalogs published before default-keymap extraction have no field at all.
  const defaultKeymap: CatalogDefaultKeymap | undefined = keyboard.defaultKeymap;
  if (!defaultKeymap) {
    return { available: false, reason: 'this catalog version was published without default keymaps' };
  }
  if (!defaultKeymap.available) {
    return { available: false, reason: defaultKeymap.reason };
  }
  const source = keyboard.layouts.find((l) => l.name === defaultKeymap.layout);
  if (!source) return { available: false, reason: 'unknown_layout' };
  return importKeymap(keyboard, layoutId, defaultKeymap, (target) => positionMapping(target, source), keycodeAliases, newId);
}

export interface ImportCommunityKeymapOptions extends ImportDefaultKeymapOptions {
  /** Community layout name, e.g. `60_hhkb`. */
  name: string;
  communityKeymaps: Readonly<Record<string, CatalogCommunityKeymap>>;
}

/**
 * QMK's canonical keymap for a community layout (the HHKB arrangement, WKL, ISO, …),
 * carried onto this keyboard's chosen layout. Offered only when the catalog recorded
 * that this keyboard supports the layout and the keymap fits it (`communityLayouts`).
 */
export function importCommunityKeymap(
  options: ImportCommunityKeymapOptions,
): DefaultKeymapImport | DefaultKeymapUnavailable {
  const { keyboard, layoutId, keycodeAliases, name } = options;
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const keymap = options.communityKeymaps[name];
  if (!keymap) return { available: false, reason: `the catalog has no keymap for the ${name} layout` };

  // Exact: the keyboard declares the layout, so its own macro says which switch is
  // which. Positions map by matrix through that macro, as for the default keymap.
  const ref = (keyboard.communityLayouts ?? []).find((c) => c.name === name);
  if (ref) {
    const source = keyboard.layouts.find((l) => l.name === ref.layout);
    if (!source) return { available: false, reason: 'unknown_layout' };
    return importKeymap(
      keyboard,
      layoutId,
      { source: keymap.source, layout: ref.layout, layers: keymap.layers },
      (target) => positionMapping(target, source),
      keycodeAliases,
      newId,
    );
  }

  // Geometric: the keyboard does not declare the layout, but the layout's own
  // geometry says where each of its keys sits, in key units from the top-left. A
  // target key binds only to a preset key at exactly the same place and size — a 2u
  // backspace is not the HHKB's two 1u keys, and guessing which one it "means" is not
  // this code's call. Everything without an exact twin stays unassigned and is counted.
  if (!keymap.positions || keymap.positions.length === 0) {
    return { available: false, reason: `this keyboard does not declare the ${name} layout and the catalog has no geometry to fit it by` };
  }
  const bySpot = new Map<string, number>();
  keymap.positions.forEach((g, index) => bySpot.set(geometryKey(g), index));
  return importKeymap(
    keyboard,
    layoutId,
    { source: keymap.source, layout: `${name} (fitted by physical key position)`, layers: keymap.layers },
    (target) => target.positions.map((p) => (p.r === 0 ? bySpot.get(geometryKey(p)) ?? -1 : -1)),
    keycodeAliases,
    newId,
  );
}

/** Physical footprint to a hundredth of a key unit, so 1.25 and 1.2500001 agree. */
function geometryKey(g: { x: number; y: number; w: number; h: number }): string {
  const q = (n: number) => Math.round(n * 100);
  return `${q(g.x)},${q(g.y)},${q(g.w)},${q(g.h)}`;
}

/**
 * How well a community keymap would fit a layout by physical position, as the share of
 * the layout's keys that get a key — or 0 when the fit is not meaningful at all:
 *
 *  - The two must be the same height in rows. "Same place, same role" holds between a
 *    60% and a 65% (both five rows) but not between a 4-row grid and a 5-row one, where
 *    the grid would take the top four rows of a keymap and lose its modifiers.
 *  - Most of the arrangement's own keys must land (at least half). Otherwise the layout
 *    is borrowing a corner of a much larger keymap, not adopting an arrangement.
 *
 * Used to decide which arrangements are worth offering for a keyboard that does not
 * declare them; exact declared layouts do not go through this.
 */
export function communityKeymapFit(layout: CatalogLayout, keymap: CatalogCommunityKeymap): number {
  if (!keymap.positions || keymap.positions.length === 0 || layout.positions.length === 0) return 0;
  const height = (ps: readonly { y: number; h: number }[]) => Math.round(Math.max(...ps.map((p) => p.y + p.h)) * 100);
  if (height(layout.positions) !== height(keymap.positions)) return 0;

  const spots = new Set(keymap.positions.map(geometryKey));
  const boardSpots = new Set(layout.positions.filter((p) => p.r === 0).map(geometryKey));
  const boardHits = layout.positions.filter((p) => p.r === 0 && spots.has(geometryKey(p))).length;
  const presetHits = keymap.positions.filter((g) => boardSpots.has(geometryKey(g))).length;
  if (presetHits / keymap.positions.length < MIN_PRESET_SHARE_USED) return 0;
  return boardHits / layout.positions.length;
}

/** At least this share of an arrangement's keys must land on the board for the fit to count. */
const MIN_PRESET_SHARE_USED = 0.5;
