/**
 * Keymap editor state, as a pure reducer.
 *
 * claude.md § Visual keymap editor requires layer tabs, a selected-position
 * inspector, an allowlisted keycode picker, undo/redo, and validation feedback. The
 * state machine for all of that lives here, with no React and no fetching, so the
 * tricky parts — undo/redo boundaries, layer renumbering, macro reference integrity —
 * can be unit-tested directly.
 *
 * Undo/redo is snapshot-based over the *document* only. Selection and UI state are
 * deliberately excluded: undoing should reverse an edit, not move the cursor around.
 */
import {
  LIMITS,
  type Binding,
  type Layer,
  type Macro,
  type SocdConfiguration,
} from '@qmk-web-app/domain';

/** The editable part of a configuration. Server-controlled fields are not here. */
export interface EditorDocument {
  name: string;
  layers: Layer[];
  macros: Macro[];
  /** Null when the user has never configured SOCD for this keyboard. */
  socd: SocdConfiguration | null;
}

export interface EditorState {
  document: EditorDocument;
  activeLayerIndex: number;
  selectedPosition: number | null;
  /** Past document snapshots, oldest first. */
  past: EditorDocument[];
  future: EditorDocument[];
  /** Revision last confirmed saved by the server. */
  savedRevision: number;
  /** True when the document differs from the last saved server state. */
  dirty: boolean;
}

export type EditorAction =
  | { type: 'select_position'; position: number | null }
  | { type: 'select_layer'; index: number }
  | { type: 'set_binding'; layerIndex: number; position: number; binding: Binding }
  | { type: 'clear_binding'; layerIndex: number; position: number }
  | { type: 'rename'; name: string }
  | { type: 'add_layer' }
  | { type: 'remove_layer'; index: number }
  | { type: 'rename_layer'; index: number; name: string }
  | { type: 'add_macro'; macro: Macro }
  | { type: 'update_macro'; macro: Macro }
  | { type: 'remove_macro'; macroId: string }
  | { type: 'set_socd'; socd: SocdConfiguration | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved'; revision: number };

export const MAX_HISTORY = 100;

export function createEditorState(document: EditorDocument, savedRevision: number): EditorState {
  return {
    document,
    activeLayerIndex: 0,
    selectedPosition: null,
    past: [],
    future: [],
    savedRevision,
    dirty: false,
  };
}

function clone(document: EditorDocument): EditorDocument {
  return structuredClone(document);
}

/** Applies a document change, pushing the previous document onto the undo stack. */
function withHistory(state: EditorState, next: EditorDocument): EditorState {
  const past = [...state.past, clone(state.document)];
  return {
    ...state,
    document: next,
    // Bound the history so a long session cannot grow without limit.
    past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past,
    // Any new edit invalidates the redo branch.
    future: [],
    dirty: true,
  };
}

function layerAt(document: EditorDocument, index: number): Layer | undefined {
  return document.layers.find((l) => l.index === index);
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'select_position':
      return { ...state, selectedPosition: action.position };

    case 'select_layer': {
      if (!layerAt(state.document, action.index)) return state;
      return { ...state, activeLayerIndex: action.index };
    }

    case 'set_binding': {
      const next = clone(state.document);
      const layer = layerAt(next, action.layerIndex);
      if (!layer) return state;
      layer.bindings[String(action.position)] = action.binding;
      return withHistory(state, next);
    }

    case 'clear_binding': {
      const next = clone(state.document);
      const layer = layerAt(next, action.layerIndex);
      if (!layer) return state;
      // Deleting the key leaves the position *unassigned*, which the renderer shows
      // distinctly. It is not the same as binding KC_NO, and must not become that
      // silently (claude.md: "never silently remap").
      if (!(String(action.position) in layer.bindings)) return state;
      delete layer.bindings[String(action.position)];
      return withHistory(state, next);
    }

    case 'rename': {
      if (action.name === state.document.name) return state;
      return withHistory(state, { ...clone(state.document), name: action.name });
    }

    case 'rename_layer': {
      const next = clone(state.document);
      const layer = layerAt(next, action.index);
      if (!layer || layer.name === action.name) return state;
      layer.name = action.name;
      return withHistory(state, next);
    }

    case 'add_layer': {
      if (state.document.layers.length >= LIMITS.maxLayers) return state;
      const next = clone(state.document);
      const index = next.layers.length;
      next.layers.push({
        id: crypto.randomUUID(),
        index,
        name: `Layer ${index}`,
        bindings: {},
      });
      return { ...withHistory(state, next), activeLayerIndex: index };
    }

    case 'remove_layer': {
      // Layer 0 is the base layer and always exists.
      if (action.index === 0 || state.document.layers.length <= 1) return state;
      const next = clone(state.document);
      const remaining = next.layers.filter((l) => l.index !== action.index);
      if (remaining.length === next.layers.length) return state;

      // Layer indices must stay contiguous (the generator emits a positional array),
      // so renumber and rewrite every binding that referenced a moved layer.
      const remap = new Map<number, number>();
      remaining
        .sort((a, b) => a.index - b.index)
        .forEach((layer, position) => {
          remap.set(layer.index, position);
          layer.index = position;
        });

      for (const layer of remaining) {
        for (const [key, binding] of Object.entries(layer.bindings)) {
          if (!('layer' in binding)) continue;
          const target = remap.get(binding.layer);
          if (target === undefined) {
            // Referenced the deleted layer: drop the binding rather than silently
            // repointing it at an unrelated layer.
            delete layer.bindings[key];
          } else {
            layer.bindings[key] = { ...binding, layer: target };
          }
        }
      }

      next.layers = remaining;
      const activeLayerIndex = Math.min(state.activeLayerIndex, remaining.length - 1);
      return { ...withHistory(state, next), activeLayerIndex };
    }

    case 'add_macro': {
      if (state.document.macros.length >= LIMITS.maxMacros) return state;
      const next = clone(state.document);
      next.macros.push(action.macro);
      return withHistory(state, next);
    }

    case 'update_macro': {
      const next = clone(state.document);
      const at = next.macros.findIndex((m) => m.id === action.macro.id);
      if (at === -1) return state;
      next.macros[at] = action.macro;
      return withHistory(state, next);
    }

    case 'remove_macro': {
      const next = clone(state.document);
      const at = next.macros.findIndex((m) => m.id === action.macroId);
      if (at === -1) return state;
      next.macros.splice(at, 1);
      // Bindings pointing at the removed macro would fail server validation, so drop
      // them here and let the user see the keys go blank.
      for (const layer of next.layers) {
        for (const [key, binding] of Object.entries(layer.bindings)) {
          if (binding.kind === 'macro' && binding.macroId === action.macroId) {
            delete layer.bindings[key];
          }
        }
      }
      return withHistory(state, next);
    }

    case 'set_socd': {
      const next = clone(state.document);
      next.socd = action.socd;
      // SOCD resolves the base-layer binding at each directional position, so those
      // bindings must actually be those keycodes — the server rejects the
      // configuration otherwise. Writing them here keeps the rendered keymap and the
      // SOCD panel showing the same thing, rather than letting the user save something
      // the server will refuse.
      if (action.socd?.enabled) {
        const base = layerAt(next, 0);
        if (base) {
          for (const [direction, position] of Object.entries(action.socd.directionalKeys)) {
            const keycode =
              action.socd.directionalKeycodes[
                direction as keyof typeof action.socd.directionalKeycodes
              ];
            base.bindings[String(position)] = { kind: 'keycode', keycode };
          }
        }
      }
      return withHistory(state, next);
    }

    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...state,
        document: previous,
        past: state.past.slice(0, -1),
        future: [clone(state.document), ...state.future],
        dirty: true,
      };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        document: next,
        past: [...state.past, clone(state.document)],
        future: state.future.slice(1),
        dirty: true,
      };
    }

    case 'saved':
      return { ...state, savedRevision: action.revision, dirty: false };

    default: {
      const never: never = action;
      throw new Error(`unhandled editor action: ${JSON.stringify(never)}`);
    }
  }
}

export function canUndo(state: EditorState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: EditorState): boolean {
  return state.future.length > 0;
}

/** Human-readable summary of a binding, for the inspector and key legends. */
export function describeBinding(
  binding: Binding | undefined,
  macros: readonly Macro[],
): string | null {
  if (!binding) return null;
  switch (binding.kind) {
    case 'keycode':
      return binding.keycode.replace(/^KC_/, '');
    case 'transparent':
      return '▽';
    case 'no_op':
      return '✕';
    case 'layer_momentary':
      return `MO${binding.layer}`;
    case 'layer_toggle':
      return `TG${binding.layer}`;
    case 'layer_tap':
      return `L${binding.layer}/${binding.tap.replace(/^KC_/, '')}`;
    case 'mod_tap':
      return `${binding.hold.replace(/^KC_/, '')}/${binding.tap.replace(/^KC_/, '')}`;
    case 'macro': {
      const macro = macros.find((m) => m.id === binding.macroId);
      return macro ? macro.name : 'macro';
    }
    default: {
      const never: never = binding;
      throw new Error(`unhandled binding: ${JSON.stringify(never)}`);
    }
  }
}
