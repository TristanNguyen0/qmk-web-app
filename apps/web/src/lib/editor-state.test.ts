import { describe, expect, it } from 'vitest';
import type { Layer, Macro } from '@qmk-web-app/domain';
import {
  canRedo,
  canUndo,
  createEditorState,
  describeBinding,
  editorReducer,
  MAX_HISTORY,
  type EditorDocument,
  type EditorState,
} from './editor-state.ts';

function layer(index: number, bindings: Layer['bindings'] = {}): Layer {
  return { id: `l${index}`, index, name: `Layer ${index}`, bindings };
}

function doc(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return { name: 'Test', layers: [layer(0)], macros: [], socd: null, ...overrides };
}

function state(document = doc()): EditorState {
  return createEditorState(document, 1);
}

function run(initial: EditorState, ...actions: Parameters<typeof editorReducer>[1][]): EditorState {
  return actions.reduce(editorReducer, initial);
}

describe('bindings', () => {
  it('sets a binding and marks the document dirty', () => {
    const next = run(state(), {
      type: 'set_binding',
      layerIndex: 0,
      position: 3,
      binding: { kind: 'keycode', keycode: 'KC_A' },
    });
    expect(next.document.layers[0]?.bindings['3']).toEqual({ kind: 'keycode', keycode: 'KC_A' });
    expect(next.dirty).toBe(true);
  });

  it('clearing a binding leaves the position unassigned, not KC_NO', () => {
    // Unassigned and KC_NO are different things the renderer shows differently;
    // conflating them would be a silent remap.
    const next = run(
      state(),
      { type: 'set_binding', layerIndex: 0, position: 3, binding: { kind: 'keycode', keycode: 'KC_A' } },
      { type: 'clear_binding', layerIndex: 0, position: 3 },
    );
    expect('3' in (next.document.layers[0]?.bindings ?? {})).toBe(false);
  });

  it('ignores edits to a layer that does not exist', () => {
    const before = state();
    const after = editorReducer(before, {
      type: 'set_binding',
      layerIndex: 5,
      position: 0,
      binding: { kind: 'keycode', keycode: 'KC_A' },
    });
    expect(after).toBe(before);
  });

  it('does not mutate the previous document', () => {
    const initial = state();
    const snapshot = structuredClone(initial.document);
    run(initial, {
      type: 'set_binding',
      layerIndex: 0,
      position: 1,
      binding: { kind: 'keycode', keycode: 'KC_B' },
    });
    expect(initial.document).toEqual(snapshot);
  });
});

describe('layers', () => {
  it('adds a layer and makes it active', () => {
    const next = run(state(), { type: 'add_layer' });
    expect(next.document.layers).toHaveLength(2);
    expect(next.activeLayerIndex).toBe(1);
  });

  it('refuses to exceed the layer limit', () => {
    let s = state();
    for (let i = 0; i < 20; i += 1) s = editorReducer(s, { type: 'add_layer' });
    expect(s.document.layers.length).toBe(8); // LIMITS.maxLayers
  });

  it('never removes the base layer', () => {
    const before = run(state(), { type: 'add_layer' });
    const after = editorReducer(before, { type: 'remove_layer', index: 0 });
    expect(after).toBe(before);
  });

  it('renumbers layers contiguously after a removal', () => {
    const s = run(state(), { type: 'add_layer' }, { type: 'add_layer' });
    expect(s.document.layers.map((l) => l.index)).toEqual([0, 1, 2]);

    const after = editorReducer(s, { type: 'remove_layer', index: 1 });
    // Contiguity matters: the generator emits a positional array, so a gap would
    // shift every later layer.
    expect(after.document.layers.map((l) => l.index)).toEqual([0, 1]);
  });

  it('repoints layer references when layers are renumbered', () => {
    const base = doc({
      layers: [
        layer(0, { '0': { kind: 'layer_momentary', layer: 2 } }),
        layer(1),
        layer(2),
      ],
    });
    const after = editorReducer(state(base), { type: 'remove_layer', index: 1 });
    // Old layer 2 became layer 1, so the reference must follow it.
    expect(after.document.layers[0]?.bindings['0']).toEqual({ kind: 'layer_momentary', layer: 1 });
  });

  it('drops bindings that referenced the deleted layer', () => {
    const base = doc({
      layers: [layer(0, { '0': { kind: 'layer_momentary', layer: 1 } }), layer(1)],
    });
    const after = editorReducer(state(base), { type: 'remove_layer', index: 1 });
    // Repointing it somewhere else would be inventing intent.
    expect('0' in (after.document.layers[0]?.bindings ?? {})).toBe(false);
  });
});

describe('macros', () => {
  const macro: Macro = { id: 'm1', name: 'Hi', steps: [{ kind: 'tap', keycode: 'KC_H' }] };

  it('adds and updates a macro', () => {
    let s = run(state(), { type: 'add_macro', macro });
    expect(s.document.macros).toHaveLength(1);

    s = editorReducer(s, { type: 'update_macro', macro: { ...macro, name: 'Renamed' } });
    expect(s.document.macros[0]?.name).toBe('Renamed');
  });

  it('removing a macro also removes bindings that referenced it', () => {
    const base = doc({
      layers: [layer(0, { '5': { kind: 'macro', macroId: 'm1' } })],
      macros: [macro],
    });
    const after = editorReducer(state(base), { type: 'remove_macro', macroId: 'm1' });
    expect(after.document.macros).toHaveLength(0);
    // A dangling macro reference would fail server validation on the next save.
    expect('5' in (after.document.layers[0]?.bindings ?? {})).toBe(false);
  });

  it('enforces the macro limit', () => {
    let s = state();
    for (let i = 0; i < 30; i += 1) {
      s = editorReducer(s, { type: 'add_macro', macro: { ...macro, id: `m${i}` } });
    }
    expect(s.document.macros.length).toBe(16); // LIMITS.maxMacros
  });
});

describe('undo and redo', () => {
  const edit = (position: number, keycode: string) =>
    ({ type: 'set_binding', layerIndex: 0, position, binding: { kind: 'keycode', keycode } }) as const;

  it('undoes and redoes an edit', () => {
    let s = run(state(), edit(0, 'KC_A'));
    expect(canUndo(s)).toBe(true);

    s = editorReducer(s, { type: 'undo' });
    expect(s.document.layers[0]?.bindings['0']).toBeUndefined();
    expect(canRedo(s)).toBe(true);

    s = editorReducer(s, { type: 'redo' });
    expect(s.document.layers[0]?.bindings['0']).toEqual({ kind: 'keycode', keycode: 'KC_A' });
  });

  it('is a no-op at the ends of the history', () => {
    const fresh = state();
    expect(editorReducer(fresh, { type: 'undo' })).toBe(fresh);
    expect(editorReducer(fresh, { type: 'redo' })).toBe(fresh);
  });

  it('discards the redo branch after a new edit', () => {
    let s = run(state(), edit(0, 'KC_A'), { type: 'undo' });
    expect(canRedo(s)).toBe(true);
    s = editorReducer(s, edit(1, 'KC_B'));
    expect(canRedo(s)).toBe(false);
  });

  it('does not treat selection changes as undoable', () => {
    // Undo should reverse an edit, not move the cursor.
    const s = run(state(), edit(0, 'KC_A'), { type: 'select_position', position: 9 });
    expect(s.past).toHaveLength(1);
  });

  it('bounds the history length', () => {
    let s = state();
    for (let i = 0; i < MAX_HISTORY + 40; i += 1) s = editorReducer(s, edit(0, `KC_${'A'}`));
    expect(s.past.length).toBeLessThanOrEqual(MAX_HISTORY);
  });

  it('undoes multiple steps in order', () => {
    let s = run(state(), edit(0, 'KC_A'), edit(1, 'KC_B'), edit(2, 'KC_C'));
    s = run(s, { type: 'undo' }, { type: 'undo' });
    const bindings = s.document.layers[0]?.bindings ?? {};
    expect('0' in bindings).toBe(true);
    expect('1' in bindings).toBe(false);
    expect('2' in bindings).toBe(false);
  });
});

describe('save tracking', () => {
  it('clears dirty and records the revision on save', () => {
    let s = run(state(), {
      type: 'set_binding',
      layerIndex: 0,
      position: 0,
      binding: { kind: 'keycode', keycode: 'KC_A' },
    });
    expect(s.dirty).toBe(true);

    s = editorReducer(s, { type: 'saved', revision: 2 });
    expect(s.dirty).toBe(false);
    expect(s.savedRevision).toBe(2);
  });

  it('a rename to the same value is not an edit', () => {
    const before = state();
    expect(editorReducer(before, { type: 'rename', name: 'Test' })).toBe(before);
  });
});

describe('describeBinding', () => {
  it('renders each binding kind compactly', () => {
    const macros: Macro[] = [{ id: 'm1', name: 'Sig', steps: [{ kind: 'tap', keycode: 'KC_A' }] }];
    expect(describeBinding({ kind: 'keycode', keycode: 'KC_A' }, macros)).toBe('A');
    expect(describeBinding({ kind: 'transparent' }, macros)).toBe('▽');
    expect(describeBinding({ kind: 'no_op' }, macros)).toBe('✕');
    expect(describeBinding({ kind: 'layer_momentary', layer: 2 }, macros)).toBe('MO2');
    expect(describeBinding({ kind: 'layer_toggle', layer: 1 }, macros)).toBe('TG1');
    expect(describeBinding({ kind: 'layer_tap', layer: 1, tap: 'KC_SPACE' }, macros)).toBe('L1/SPACE');
    expect(describeBinding({ kind: 'mod_tap', hold: 'KC_LEFT_CTRL', tap: 'KC_ESCAPE' }, macros)).toBe(
      'LEFT_CTRL/ESCAPE',
    );
    expect(describeBinding({ kind: 'macro', macroId: 'm1' }, macros)).toBe('Sig');
  });

  it('returns null for an unassigned position', () => {
    expect(describeBinding(undefined, [])).toBeNull();
  });
});

describe('SOCD', () => {
  const socd = {
    enabled: true,
    policyId: 'neutral',
    directionalKeys: { up: 0, down: 1, left: 2, right: 3 },
    directionalKeycodes: { up: 'KC_W', down: 'KC_S', left: 'KC_A', right: 'KC_D' },
  } as const;

  it('stores the SOCD configuration on the document', () => {
    const next = run(state(), { type: 'set_socd', socd });
    expect(next.document.socd?.enabled).toBe(true);
    expect(next.dirty).toBe(true);
  });

  it('binds the four directional positions on the base layer to match', () => {
    // The server refuses a SOCD configuration whose base layer disagrees, so the
    // editor keeps them in step rather than letting the user save something invalid.
    const next = run(state(), { type: 'set_socd', socd });
    const base = next.document.layers.find((l) => l.index === 0)!;
    expect(base.bindings['0']).toEqual({ kind: 'keycode', keycode: 'KC_W' });
    expect(base.bindings['1']).toEqual({ kind: 'keycode', keycode: 'KC_S' });
    expect(base.bindings['2']).toEqual({ kind: 'keycode', keycode: 'KC_A' });
    expect(base.bindings['3']).toEqual({ kind: 'keycode', keycode: 'KC_D' });
  });

  it('leaves the base layer alone when SOCD is turned off', () => {
    const withSocd = run(state(), { type: 'set_socd', socd });
    const off = run(withSocd, { type: 'set_socd', socd: null });
    expect(off.document.socd).toBeNull();
    // The keys stay bound; disabling SOCD is not a reason to blank someone's keymap.
    expect(off.document.layers[0]!.bindings['0']).toEqual({ kind: 'keycode', keycode: 'KC_W' });
  });

  it('is undoable like any other edit', () => {
    const next = run(state(), { type: 'set_socd', socd }, { type: 'undo' });
    expect(next.document.socd).toBeNull();
  });
});
