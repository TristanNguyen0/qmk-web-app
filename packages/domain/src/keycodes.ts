/**
 * The product's supported keycode catalog.
 *
 * claude.md § Visual keymap editor: "Start with a compact keycode catalog … Add
 * advanced QMK features incrementally behind capability flags."
 *
 * IMPORTANT: this file does not *define* keycodes — QMK does. Every name here is an
 * allowlisted selection from the keycode spec extracted from the pinned QMK revision.
 * `keycodes.test.ts` asserts that every name below exists in that extracted spec, so
 * a QMK bump that renames or removes a keycode fails the build instead of silently
 * generating a keymap that will not compile (claude.md rule 2).
 */

export type KeycodeGroup =
  | 'letters'
  | 'digits'
  | 'punctuation'
  | 'modifiers'
  | 'navigation'
  | 'editing'
  | 'function'
  | 'numpad'
  | 'special';

export interface SupportedKeycode {
  /** The QMK keycode name emitted into generated source, e.g. `KC_A`. */
  readonly name: string;
  readonly group: KeycodeGroup;
  /** Short label for the editor. Presentation only; never used in generation. */
  readonly label: string;
}

function kc(name: string, group: KeycodeGroup, label: string): SupportedKeycode {
  return { name, group, label };
}

const LETTERS: SupportedKeycode[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  .split('')
  .map((ch) => kc(`KC_${ch}`, 'letters', ch));

const DIGITS: SupportedKeycode[] = [
  kc('KC_1', 'digits', '1'),
  kc('KC_2', 'digits', '2'),
  kc('KC_3', 'digits', '3'),
  kc('KC_4', 'digits', '4'),
  kc('KC_5', 'digits', '5'),
  kc('KC_6', 'digits', '6'),
  kc('KC_7', 'digits', '7'),
  kc('KC_8', 'digits', '8'),
  kc('KC_9', 'digits', '9'),
  kc('KC_0', 'digits', '0'),
];

const PUNCTUATION: SupportedKeycode[] = [
  kc('KC_MINUS', 'punctuation', '-'),
  kc('KC_EQUAL', 'punctuation', '='),
  kc('KC_LEFT_BRACKET', 'punctuation', '['),
  kc('KC_RIGHT_BRACKET', 'punctuation', ']'),
  kc('KC_BACKSLASH', 'punctuation', '\\'),
  kc('KC_SEMICOLON', 'punctuation', ';'),
  kc('KC_QUOTE', 'punctuation', "'"),
  kc('KC_GRAVE', 'punctuation', '`'),
  kc('KC_COMMA', 'punctuation', ','),
  kc('KC_DOT', 'punctuation', '.'),
  kc('KC_SLASH', 'punctuation', '/'),
];

const MODIFIERS: SupportedKeycode[] = [
  kc('KC_LEFT_CTRL', 'modifiers', 'LCtrl'),
  kc('KC_LEFT_SHIFT', 'modifiers', 'LShift'),
  kc('KC_LEFT_ALT', 'modifiers', 'LAlt'),
  kc('KC_LEFT_GUI', 'modifiers', 'LGui'),
  kc('KC_RIGHT_CTRL', 'modifiers', 'RCtrl'),
  kc('KC_RIGHT_SHIFT', 'modifiers', 'RShift'),
  kc('KC_RIGHT_ALT', 'modifiers', 'RAlt'),
  kc('KC_RIGHT_GUI', 'modifiers', 'RGui'),
];

const NAVIGATION: SupportedKeycode[] = [
  kc('KC_UP', 'navigation', 'Up'),
  kc('KC_DOWN', 'navigation', 'Down'),
  kc('KC_LEFT', 'navigation', 'Left'),
  kc('KC_RIGHT', 'navigation', 'Right'),
  kc('KC_HOME', 'navigation', 'Home'),
  kc('KC_END', 'navigation', 'End'),
  kc('KC_PAGE_UP', 'navigation', 'PgUp'),
  kc('KC_PAGE_DOWN', 'navigation', 'PgDn'),
];

const EDITING: SupportedKeycode[] = [
  kc('KC_ENTER', 'editing', 'Enter'),
  kc('KC_ESCAPE', 'editing', 'Esc'),
  kc('KC_BACKSPACE', 'editing', 'Bksp'),
  kc('KC_TAB', 'editing', 'Tab'),
  kc('KC_SPACE', 'editing', 'Space'),
  kc('KC_DELETE', 'editing', 'Del'),
  kc('KC_INSERT', 'editing', 'Ins'),
  kc('KC_CAPS_LOCK', 'editing', 'Caps'),
];

const FUNCTION: SupportedKeycode[] = Array.from({ length: 12 }, (_, i) =>
  kc(`KC_F${i + 1}`, 'function', `F${i + 1}`),
);

const NUMPAD: SupportedKeycode[] = [
  kc('KC_KP_1', 'numpad', 'P1'),
  kc('KC_KP_2', 'numpad', 'P2'),
  kc('KC_KP_3', 'numpad', 'P3'),
  kc('KC_KP_4', 'numpad', 'P4'),
  kc('KC_KP_5', 'numpad', 'P5'),
  kc('KC_KP_6', 'numpad', 'P6'),
  kc('KC_KP_7', 'numpad', 'P7'),
  kc('KC_KP_8', 'numpad', 'P8'),
  kc('KC_KP_9', 'numpad', 'P9'),
  kc('KC_KP_0', 'numpad', 'P0'),
  kc('KC_KP_DOT', 'numpad', 'P.'),
  kc('KC_KP_PLUS', 'numpad', 'P+'),
  kc('KC_KP_MINUS', 'numpad', 'P-'),
  kc('KC_KP_ASTERISK', 'numpad', 'P*'),
  kc('KC_KP_SLASH', 'numpad', 'P/'),
  kc('KC_KP_ENTER', 'numpad', 'PEnt'),
  kc('KC_NUM_LOCK', 'numpad', 'NumLk'),
];

/**
 * `KC_TRANSPARENT` and `KC_NO` are modelled as their own binding kinds
 * (`transparent`, `no_op`) rather than as pickable keycodes, so the editor can render
 * them distinctly. They appear here because generation still emits these names.
 */
const SPECIAL: SupportedKeycode[] = [
  kc('KC_TRANSPARENT', 'special', 'Transparent'),
  kc('KC_NO', 'special', 'None'),
];

export const SUPPORTED_KEYCODES: readonly SupportedKeycode[] = Object.freeze([
  ...LETTERS,
  ...DIGITS,
  ...PUNCTUATION,
  ...MODIFIERS,
  ...NAVIGATION,
  ...EDITING,
  ...FUNCTION,
  ...NUMPAD,
  ...SPECIAL,
]);

export const SUPPORTED_KEYCODE_NAMES: ReadonlySet<string> = Object.freeze(
  new Set(SUPPORTED_KEYCODES.map((k) => k.name)),
);

export function isSupportedKeycode(name: unknown): name is string {
  return typeof name === 'string' && SUPPORTED_KEYCODE_NAMES.has(name);
}

/**
 * Modifiers usable as the hold action of a mod-tap. Deliberately the eight basic
 * modifiers only; modifier *combinations* are a later capability.
 */
export const MOD_TAP_MODIFIERS: ReadonlySet<string> = Object.freeze(
  new Set(MODIFIERS.map((m) => m.name)),
);

/**
 * Keycodes offered as SOCD directional inputs. SOCD resolution is only meaningful for
 * opposing pairs, so the editor offers exactly these (claude.md § SOCD Cleaner).
 */
export const SOCD_DIRECTIONAL_KEYCODES: ReadonlySet<string> = Object.freeze(
  new Set(['KC_W', 'KC_A', 'KC_S', 'KC_D', 'KC_UP', 'KC_DOWN', 'KC_LEFT', 'KC_RIGHT']),
);
