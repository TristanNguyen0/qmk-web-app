/**
 * Deterministic generation of an application-owned QMK keymap.
 *
 * claude.md rule 4: "Generate source from a typed internal configuration model and
 * approved templates. Do not concatenate free-form user text into C, Make, shell
 * commands, paths, or compiler arguments."
 *
 * The MVP satisfies that rule in the strongest available form: **it emits no C, no
 * Make, and no headers at all.** The pinned QMK revision's `keymap.jsonschema`
 * supports layers, layer actions, mod-taps and full structured macros (`tap`/`down`/
 * `up`/`delay`) directly in `keymap.json`, so every MVP feature is expressible as
 * pure JSON data that QMK itself compiles.
 *
 * Consequences worth keeping:
 *  - No user-controlled value is ever interpolated into a C string.
 *  - Every keycode token emitted comes from the domain allowlist.
 *  - Output is byte-for-byte reproducible: no timestamps, no map iteration order, no
 *    floating point, and stable key ordering.
 */
import {
  LIMITS,
  generatedKeymapName,
  isSupportedKeycode,
  type Binding,
  type Configuration,
  type Macro,
  type MacroStep,
  type SupportedCatalogKeyboard,
} from '@qmk-web-app/domain';

/**
 * Bumped whenever generated output could change for an unchanged configuration.
 * Persisted with every configuration and build (claude.md § Configuration model).
 */
export const GENERATOR_VERSION = '1.0.0';

/**
 * QMK defines QK_MACRO_0 through QK_MACRO_31 at the pinned revision
 * (data/constants/keycodes/keycodes_0.0.1_macro.hjson). This is a hard QMK ceiling,
 * distinct from the product's own lower `LIMITS.maxMacros`.
 */
export const MAX_JSON_MACROS = 32;

/** The complete set of files generation may ever write. Enforced, not documented. */
export const ALLOWED_GENERATED_FILES = Object.freeze([
  'qmk.json',
  'keymap.json',
] as const);

export type GeneratedFileName = (typeof ALLOWED_GENERATED_FILES)[number];

export interface GeneratedFile {
  /** Path relative to the userspace root. Always built from validated parts. */
  path: string;
  contents: string;
}

export interface GenerationResult {
  files: readonly GeneratedFile[];
  keymapName: string;
  /** The exact `qmk compile` target arguments the worker must use. */
  compileTarget: { keyboard: string; keymap: string };
  generatorVersion: string;
  totalBytes: number;
}

export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationError';
  }
}

/**
 * Renders a binding as a QMK keycode expression.
 *
 * Every branch produces a token built only from allowlisted keycode names and
 * integers we validated ourselves. There is no default/passthrough case: an
 * unhandled binding kind is a generation failure, never a guess.
 */
function renderBinding(binding: Binding, macroIndexById: ReadonlyMap<string, number>): string {
  switch (binding.kind) {
    case 'keycode':
      return assertKeycode(binding.keycode);
    case 'transparent':
      return 'KC_TRANSPARENT';
    case 'no_op':
      return 'KC_NO';
    case 'layer_momentary':
      return `MO(${assertLayerIndex(binding.layer)})`;
    case 'layer_toggle':
      return `TG(${assertLayerIndex(binding.layer)})`;
    case 'layer_tap':
      return `LT(${assertLayerIndex(binding.layer)},${assertKeycode(binding.tap)})`;
    case 'mod_tap':
      return `MT(MOD_${modSuffix(binding.hold)},${assertKeycode(binding.tap)})`;
    case 'macro': {
      const index = macroIndexById.get(binding.macroId);
      if (index === undefined) {
        throw new GenerationError(`binding references unknown macro ${binding.macroId}`);
      }
      // Verified against the pinned tree: lib/python/qmk/keymap.py:132 emits
      // `case QK_MACRO_{i}:` for the i-th JSON macro, and QK_MACRO_0..31 are defined
      // in data/constants/keycodes/keycodes_0.0.1_macro.hjson.
      if (index >= MAX_JSON_MACROS) {
        throw new GenerationError(
          `macro index ${index} exceeds QMK's QK_MACRO_0..${MAX_JSON_MACROS - 1} range`,
        );
      }
      return `QK_MACRO_${index}`;
    }
    default: {
      // Exhaustiveness: adding a binding kind without a renderer fails to typecheck.
      const never: never = binding;
      throw new GenerationError(`unhandled binding kind: ${JSON.stringify(never)}`);
    }
  }
}

const MOD_SUFFIXES: Readonly<Record<string, string>> = Object.freeze({
  KC_LEFT_CTRL: 'LCTL',
  KC_LEFT_SHIFT: 'LSFT',
  KC_LEFT_ALT: 'LALT',
  KC_LEFT_GUI: 'LGUI',
  KC_RIGHT_CTRL: 'RCTL',
  KC_RIGHT_SHIFT: 'RSFT',
  KC_RIGHT_ALT: 'RALT',
  KC_RIGHT_GUI: 'RGUI',
});

function modSuffix(keycode: string): string {
  const suffix = MOD_SUFFIXES[keycode];
  if (!suffix) {
    throw new GenerationError(`${keycode} is not usable as a mod-tap hold modifier`);
  }
  return suffix;
}

function assertKeycode(keycode: string): string {
  // Defence in depth: validation already guaranteed this, but generation is the last
  // point before a token reaches a compiler, so it re-checks rather than trusting.
  if (!isSupportedKeycode(keycode)) {
    throw new GenerationError(`refusing to emit unsupported keycode ${JSON.stringify(keycode)}`);
  }
  return keycode;
}

function assertLayerIndex(layer: number): number {
  if (!Number.isInteger(layer) || layer < 0 || layer >= LIMITS.maxLayers) {
    throw new GenerationError(`layer index out of range: ${layer}`);
  }
  return layer;
}

/**
 * Macro keycodes use QMK's SEND_STRING spelling, not the `KC_` spelling.
 *
 * `lib/python/qmk/keymap.py:117-126` emits `SS_TAP(X_{keycode})` by pasting the JSON
 * value straight after `X_`, so the JSON must carry `LEFT_SHIFT`, not `KC_LEFT_SHIFT`.
 * QMK's own fixture (`keyboards/handwired/pytest/macro/keymaps/default/keymap.json`)
 * confirms the bare form. Every `X_` name for our allowlisted keycodes was verified
 * to exist in `quantum/send_string/send_string_keycodes.h` at the pinned revision.
 */
function sendStringName(keycode: string): string {
  const validated = assertKeycode(keycode);
  if (!validated.startsWith('KC_')) {
    throw new GenerationError(`cannot derive a SEND_STRING name from ${validated}`);
  }
  return validated.slice('KC_'.length);
}

function renderMacroStep(step: MacroStep): unknown {
  switch (step.kind) {
    case 'tap':
      return { action: 'tap', keycodes: [sendStringName(step.keycode)] };
    case 'key_down':
      return { action: 'down', keycodes: [sendStringName(step.keycode)] };
    case 'key_up':
      return { action: 'up', keycodes: [sendStringName(step.keycode)] };
    case 'delay': {
      if (!Number.isInteger(step.durationMs) || step.durationMs < 1) {
        throw new GenerationError(`invalid macro delay: ${step.durationMs}`);
      }
      return { action: 'delay', duration: step.durationMs };
    }
    default: {
      const never: never = step;
      throw new GenerationError(`unhandled macro step: ${JSON.stringify(never)}`);
    }
  }
}

function renderMacros(macros: readonly Macro[]): unknown[] {
  return macros.map((macro) => macro.steps.map(renderMacroStep));
}

/**
 * Stable JSON serialisation. Object key order is fixed by construction (we build
 * every object literal in a fixed order) and a trailing newline keeps the output
 * diff-friendly for snapshot review.
 */
function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface GenerateOptions {
  configuration: Configuration;
  keyboard: SupportedCatalogKeyboard;
  /** Used only to derive a safe keymap directory name. Never the user's name. */
  buildId: string;
}

export function generateKeymap(options: GenerateOptions): GenerationResult {
  const { configuration, keyboard, buildId } = options;

  if (configuration.keyboardId !== keyboard.keyboardId) {
    throw new GenerationError('configuration and catalog keyboard record disagree');
  }
  if (configuration.socd?.enabled) {
    // claude.md rule 9: SOCD must be verified against the pinned revision first.
    throw new GenerationError('SOCD generation is not implemented for this QMK revision');
  }

  const layout = keyboard.layouts.find((l) => l.name === configuration.layoutId);
  if (!layout) {
    throw new GenerationError(`layout ${configuration.layoutId} is not part of this keyboard`);
  }

  const keymapName = generatedKeymapName(buildId);

  // Macro order defines the MACRO_nn indices, so it must be deterministic and shared
  // between the index map and the emitted array.
  const macros = [...configuration.macros].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const macroIndexById = new Map(macros.map((m, i) => [m.id, i]));

  const layers = [...configuration.layers].sort((a, b) => a.index - b.index);

  // Every layer is emitted as a dense array covering every position in the layout, in
  // layout order. Unassigned positions become KC_NO on the base layer and
  // KC_TRANSPARENT above it — the standard QMK meaning, applied explicitly rather
  // than left to chance.
  const renderedLayers = layers.map((layer) =>
    layout.positions.map((position) => {
      const binding = layer.bindings[String(position.index)];
      if (!binding) return layer.index === 0 ? 'KC_NO' : 'KC_TRANSPARENT';
      return renderBinding(binding, macroIndexById);
    }),
  );

  const keymapJson: Record<string, unknown> = {
    $schema: 'https://json.schemastore.org/qmk-keymap.json',
    keyboard: keyboard.keyboardId,
    keymap: keymapName,
    layout: layout.name,
    layers: renderedLayers,
  };
  if (macros.length > 0) {
    keymapJson['macros'] = renderMacros(macros);
  }

  const userspaceJson = {
    userspace_version: '1.1',
    // Build targets are supplied on the compile command line, not from this file, so
    // the manifest never encodes a path the worker did not construct itself.
    build_targets: [] as unknown[],
  };

  const keymapPath = `keyboards/${keyboard.keyboardId}/keymaps/${keymapName}/keymap.json`;
  const files: GeneratedFile[] = [
    { path: 'qmk.json', contents: stableJson(userspaceJson) },
    { path: keymapPath, contents: stableJson(keymapJson) },
  ];

  const totalBytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.contents, 'utf8'), 0);
  if (totalBytes > LIMITS.maxGeneratedBytes) {
    throw new GenerationError(
      `generated output is ${totalBytes} bytes, over the ${LIMITS.maxGeneratedBytes} byte limit`,
    );
  }

  return {
    files,
    keymapName,
    compileTarget: { keyboard: keyboard.keyboardId, keymap: keymapName },
    generatorVersion: GENERATOR_VERSION,
    totalBytes,
  };
}
