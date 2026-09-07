import { describe, expect, it } from 'vitest';
import { readCatalogSample } from '@qmk-web-app/qmk-fixtures';
import { importDefaultKeymap, type Catalog, type Configuration, type Layer } from '@qmk-web-app/domain';
import { buildAssistantContext, renderAssistantContext } from './context.ts';
import { parseProposal, type AssistantProposal, type Operation } from './proposal.ts';
import { resolveKey, resolveKeycode, resolveLayer, rowsOf } from './refs.ts';
import { resolveProposal } from './resolve.ts';

const catalog = readCatalogSample() as Catalog;
const aliases = catalog.keycodeAliases;

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

function keyboardOf(id: string) {
  const kb = catalog.keyboards.find((k) => k.keyboardId === id);
  if (!kb?.supported) throw new Error(`fixture lacks ${id}`);
  return kb;
}

function configurationFor(keyboardId: string, layoutId: string, layers?: Layer[]): Configuration {
  const kb = keyboardOf(keyboardId);
  const imported = importDefaultKeymap({ keyboard: kb, layoutId, keycodeAliases: aliases, newId });
  if (!imported.available) throw new Error('fixture default unavailable');
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ownerId: null,
    schemaVersion: 1,
    catalogVersion: catalog.catalogVersion,
    qmkCommit: catalog.qmkCommit,
    keyboardId,
    layoutId,
    name: 'Test',
    revision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    layers: layers ?? imported.layers,
    macros: [],
    socd: null,
    generatorVersion: '1.1.0',
  };
}

const crkbd = () => configurationFor('crkbd/rev1', 'LAYOUT_split_3x6_3');
const planck = () => configurationFor('planck/rev6', 'LAYOUT_ortho_4x12');

function proposal(operations: Operation[], extra: Partial<AssistantProposal> = {}): AssistantProposal {
  return { summary: 'test', operations, unsupported: [], ...extra };
}

/** Position on the base layer bound to a keycode, from the real default. */
function positionOf(config: Configuration, keycode: string): number {
  const base = config.layers.find((l) => l.index === 0)!;
  const hits = Object.entries(base.bindings).filter(([, b]) => b.kind === 'keycode' && b.keycode === keycode);
  if (hits.length !== 1) throw new Error(`${keycode} bound ${hits.length} times`);
  return Number(hits[0]![0]);
}

describe('parseProposal', () => {
  it('accepts a well-formed proposal and defaults unsupported', () => {
    const result = parseProposal({ summary: 'x', operations: [{ op: 'disable_socd' }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposal.unsupported).toEqual([]);
  });

  it('rejects unknown operations, extra fields, and oversize payloads with readable errors', () => {
    for (const bad of [
      { summary: 'x', operations: [{ op: 'run_shell', cmd: 'rm -rf /' }] },
      { summary: 'x', operations: [{ op: 'disable_socd', extra: 1 }] },
      { summary: 'x', operations: [{ op: 'set_key', layer: 0, key: { position: 0 }, binding: { type: 'raw', c: 'KC_A' } }] },
      { summary: '', operations: [] },
      { summary: 'x', operations: Array.from({ length: 401 }, () => ({ op: 'disable_socd' })) },
    ]) {
      const result = parseProposal(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveKeycode', () => {
  it('accepts canonical names, QMK aliases, labels, common names, and single characters', () => {
    expect(resolveKeycode('KC_DELETE', aliases)).toBe('KC_DELETE');
    expect(resolveKeycode('KC_DEL', aliases)).toBe('KC_DELETE');
    expect(resolveKeycode('Del', aliases)).toBe('KC_DELETE');
    expect(resolveKeycode('delete', aliases)).toBe('KC_DELETE');
    expect(resolveKeycode('a', aliases)).toBe('KC_A');
    expect(resolveKeycode('7', aliases)).toBe('KC_7');
    expect(resolveKeycode('kc_bspc', aliases)).toBe('KC_BACKSPACE');
    expect(resolveKeycode('left ctrl', aliases)).toBe('KC_LEFT_CTRL');
    expect(resolveKeycode('page up', aliases)).toBe('KC_PAGE_UP');
    expect(resolveKeycode('_______', aliases)).toBe('KC_TRANSPARENT');
  });

  it('refuses anything outside the supported catalog, including real QMK keycodes', () => {
    expect(resolveKeycode('QK_BOOT', aliases)).toBeNull();
    expect(resolveKeycode('KC_MPLY', aliases)).toBeNull(); // real alias, unsupported group
    expect(resolveKeycode('RGB_TOG', aliases)).toBeNull();
    expect(resolveKeycode('KC_A; DROP TABLE', aliases)).toBeNull();
    expect(resolveKeycode('', aliases)).toBeNull();
  });
});

describe('resolveLayer', () => {
  const layers = crkbd().layers;
  it('resolves by index, name, and the words base/layerN', () => {
    expect(resolveLayer(2, layers)).toEqual({ ok: true, index: 2 });
    expect(resolveLayer('base', layers)).toEqual({ ok: true, index: 0 });
    expect(resolveLayer('Layer 3', layers)).toEqual({ ok: true, index: 3 });
    expect(resolveLayer('layer3', layers)).toEqual({ ok: true, index: 3 });
  });
  it('fails with candidates rather than guessing', () => {
    const r = resolveLayer('Fn', layers);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.candidates).toEqual(['0 (Base)', '1 (Layer 1)', '2 (Layer 2)', '3 (Layer 3)']);
    expect(resolveLayer(9, layers).ok).toBe(false);
  });
});

describe('resolveKey', () => {
  it('resolves a legend to the single base-layer key carrying it', () => {
    const config = crkbd();
    const ctx = { layout: keyboardOf('crkbd/rev1').layouts[1]!, baseLayer: config.layers[0], aliases };
    expect(ctx.layout.name).toBe('LAYOUT_split_3x6_3');
    expect(resolveKey({ key: 'A' }, ctx)).toEqual({ ok: true, position: positionOf(config, 'KC_A') });
    expect(resolveKey({ key: 'kc_tab' }, ctx)).toEqual({ ok: true, position: positionOf(config, 'KC_TAB') });
    expect(resolveKey({ position: 5 }, ctx)).toEqual({ ok: true, position: 5 });
  });

  it('reports ambiguity with positions instead of picking one', () => {
    const config = planck(); // the planck default has two KC_SPACE keys
    const ctx = { layout: keyboardOf('planck/rev6').layouts.find((l) => l.name === 'LAYOUT_ortho_4x12')!, baseLayer: config.layers[0], aliases };
    const r = resolveKey({ key: 'space' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/matches 2 keys/);
      expect(r.candidates).toEqual(['position 41 (row 4, key 6)', 'position 42 (row 4, key 7)']);
    }
  });

  it('fails clearly for unknown legends and out-of-range positions', () => {
    const config = crkbd();
    const ctx = { layout: keyboardOf('crkbd/rev1').layouts[1]!, baseLayer: config.layers[0], aliases };
    expect(resolveKey({ key: 'Delete' }, ctx)).toMatchObject({ ok: false, reason: expect.stringMatching(/no key on the base layer is bound to KC_DELETE/) });
    expect(resolveKey({ key: 'flux capacitor' }, ctx)).toMatchObject({ ok: false, reason: expect.stringMatching(/not a keycode or key label/) });
    expect(resolveKey({ position: 42 }, ctx)).toMatchObject({ ok: false });
  });
});

describe('resolveProposal', () => {
  it('handles the motivating request: default keymap, Fn layer, SOCD on WASD, toggle reported unsupported', () => {
    const configuration = configurationFor('crkbd/rev1', 'LAYOUT_split_3x6_3', [
      { id: newId(), index: 0, name: 'Base', bindings: {} },
    ]);
    const result = resolveProposal({
      configuration,
      catalog,
      newId,
      proposal: proposal(
        [
          { op: 'apply_default_keymap' },
          { op: 'remove_layer', layer: 3 },
          { op: 'remove_layer', layer: 2 },
          { op: 'add_layer', name: 'Fn', fill: 'transparent' },
          { op: 'set_key', layer: 'base', key: { key: 'LGUI' }, binding: { type: 'layer_momentary', layer: 'Fn' } },
          { op: 'set_key', layer: 'fn', key: { key: 'Q' }, binding: { type: 'keycode', keycode: 'delete' } },
          { op: 'set_socd', policy: 'neutral', up: { key: 'W' }, down: { key: 'S' }, left: { key: 'A' }, right: { key: 'D' } },
        ],
        {
          summary: 'QWERTY default with SOCD on WASD and an Fn layer.',
          unsupported: [
            { request: 'toggle SOCD with Fn+Del', reason: 'SOCD has no runtime on/off key and applies to the base layer only.' },
          ],
        },
      ),
    });

    expect(result.issues).toEqual([]);
    expect(result.validation).toEqual({ ok: true });
    expect(result.ok).toBe(true);

    const c = result.candidate;
    expect(c.layers.map((l) => l.name)).toEqual(['Base', 'Layer 1', 'Fn']);
    expect(c.layers[2]!.bindings[String(positionOf(c, 'KC_Q'))]).toEqual({ kind: 'keycode', keycode: 'KC_DELETE' });
    const gui = Object.values(c.layers[0]!.bindings).find((b) => b.kind === 'layer_momentary' && b.layer === 2);
    expect(gui).toBeDefined();
    expect(c.socd).toMatchObject({
      enabled: true,
      policyId: 'neutral',
      directionalKeycodes: { up: 'KC_W', down: 'KC_S', left: 'KC_A', right: 'KC_D' },
    });
    expect(result.unsupported).toHaveLength(1);
    expect(result.changes.map((ch) => ch.description)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Replaced all layers with QMK's default keymap \(keyboards\/crkbd\/keymaps\/default\/keymap\.c\): 4 layers/),
        'Added layer 2 "Fn" (transparent)',
        'SOCD enabled (Neutral) on up=KC_W, down=KC_S, left=KC_A, right=KC_D',
      ]),
    );
  });

  it('records an issue per failed operation and still applies the rest', () => {
    const result = resolveProposal({
      configuration: crkbd(),
      catalog,
      newId,
      proposal: proposal([
        { op: 'set_key', layer: 0, key: { key: 'Q' }, binding: { type: 'keycode', keycode: 'QK_BOOT' } },
        { op: 'set_key', layer: 'Nav', key: { key: 'Q' }, binding: { type: 'keycode', keycode: 'KC_A' } },
        { op: 'set_key', layer: 0, key: { key: 'W' }, binding: { type: 'keycode', keycode: 'KC_E' } },
      ]),
    });
    expect(result.ok).toBe(false);
    expect(result.validation).toEqual({ ok: true });
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toMatchObject({ operation: 0, op: 'set_key', reason: expect.stringMatching(/QK_BOOT.*not a keycode this product supports/) });
    expect(result.issues[1]).toMatchObject({ operation: 1, reason: expect.stringMatching(/no layer is named "Nav"/), candidates: expect.any(Array) });
    expect(result.changes).toHaveLength(1);
    const q = positionOf(crkbd(), 'KC_Q');
    expect(result.candidate.layers[0]!.bindings[String(q)]).toEqual({ kind: 'keycode', keycode: 'KC_Q' }); // untouched
  });

  it('applies each operation atomically — a set_socd with one bad key changes nothing', () => {
    const before = crkbd();
    const result = resolveProposal({
      configuration: before,
      catalog,
      newId,
      proposal: proposal([
        { op: 'set_socd', policy: 'neutral', up: { key: 'W' }, down: { key: 'S' }, left: { key: 'A' }, right: { key: 'Q' } },
      ]),
    });
    expect(result.issues[0]?.reason).toMatch(/SOCD right must be a key bound to one of/);
    expect(result.candidate.socd).toBeNull();
    expect(result.candidate.layers).toEqual(before.layers);
  });

  it('lets a SOCD request through to validation, where the registry refuses an unverified keyboard', () => {
    const result = resolveProposal({
      configuration: planck(),
      catalog,
      newId,
      proposal: proposal([
        { op: 'set_socd', policy: 'last input priority', up: { key: 'W' }, down: { key: 'S' }, left: { key: 'A' }, right: { key: 'D' } },
      ]),
    });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.validation).toMatchObject({ ok: false, code: 'CAPABILITY_UNAVAILABLE' });
  });

  it('refuses a mod_tap whose hold is not a modifier and a layer_tap onto a placeholder', () => {
    const result = resolveProposal({
      configuration: crkbd(),
      catalog,
      newId,
      proposal: proposal([
        { op: 'set_key', layer: 0, key: { key: 'Q' }, binding: { type: 'mod_tap', hold: 'A', tap: 'Q' } },
        { op: 'set_key', layer: 0, key: { key: 'Q' }, binding: { type: 'layer_tap', layer: 1, tap: 'transparent' } },
        { op: 'set_key', layer: 0, key: { key: 'Q' }, binding: { type: 'mod_tap', hold: 'shift', tap: 'q' } },
      ]),
    });
    expect(result.issues.map((i) => i.operation)).toEqual([0, 1]);
    const q = positionOf(crkbd(), 'KC_Q');
    expect(result.candidate.layers[0]!.bindings[String(q)]).toEqual({ kind: 'mod_tap', hold: 'KC_LEFT_SHIFT', tap: 'KC_Q' });
  });

  it('removing a layer renumbers references and drops those into the removed layer', () => {
    const config = crkbd(); // default: MO(1) and MO(2) on the thumbs
    const result = resolveProposal({
      configuration: config,
      catalog,
      newId,
      proposal: proposal([{ op: 'remove_layer', layer: 1 }]),
    });
    expect(result.ok).toBe(true);
    expect(result.candidate.layers.map((l) => l.index)).toEqual([0, 1, 2]);
    const base = result.candidate.layers[0]!.bindings;
    const layerRefs = Object.values(base).filter((b) => b.kind === 'layer_momentary').map((b) => (b as { layer: number }).layer);
    expect(layerRefs).toEqual([1]); // MO(2) became MO(1); MO(1) was dropped
    expect(result.changes[0]?.description).toMatch(/Removed layer 1 "Layer 1"; 1 key that switched to it left unassigned/);
    expect(
      resolveProposal({ configuration: config, catalog, newId, proposal: proposal([{ op: 'remove_layer', layer: 'base' }]) }).issues[0]?.reason,
    ).toMatch(/base layer and cannot be removed/);
  });

  it('adds macros, binds them by name, and rejects unbalanced or unknown steps', () => {
    const result = resolveProposal({
      configuration: crkbd(),
      catalog,
      newId,
      proposal: proposal([
        { op: 'add_macro', name: 'Hi', steps: [{ type: 'down', keycode: 'shift' }, { type: 'tap', keycode: 'h' }, { type: 'up', keycode: 'shift' }, { type: 'tap', keycode: 'i' }] },
        { op: 'set_key', layer: 0, key: { key: 'Q' }, binding: { type: 'macro', macro: 'hi' } },
        { op: 'add_macro', name: 'Bad', steps: [{ type: 'tap', keycode: 'KC_MPLY' }] },
        { op: 'set_key', layer: 0, key: { key: 'W' }, binding: { type: 'macro', macro: 'Nope' } },
      ]),
    });
    expect(result.issues.map((i) => i.operation)).toEqual([2, 3]);
    expect(result.validation).toEqual({ ok: true });
    const macro = result.candidate.macros[0]!;
    expect(macro.name).toBe('Hi');
    expect(macro.steps[0]).toEqual({ kind: 'key_down', keycode: 'KC_LEFT_SHIFT' });
    const q = positionOf(crkbd(), 'KC_Q');
    expect(result.candidate.layers[0]!.bindings[String(q)]).toEqual({ kind: 'macro', macroId: macro.id });
  });

  it('applies a layout preset from QMK’s community keymaps, matching loosely but uniquely', () => {
    const before = crkbd();
    const result = resolveProposal({
      configuration: before,
      catalog,
      newId,
      proposal: proposal([{ op: 'apply_layout_preset', preset: '3x6_3' }]),
    });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.changes[0]?.description).toMatch(
      /^Replaced all layers with QMK's split_3x6_3 layout preset \(layouts\/default\/split_3x6_3\/default_split_3x6_3\/keymap\.c\)/,
    );
    // The community keymap, not the Corne's own 4-layer default.
    expect(result.candidate.layers.length).not.toBe(before.layers.length);
    expect(result.candidate.layers[0]!.bindings['1']).toEqual({ kind: 'keycode', keycode: 'KC_Q' });
  });

  it('refuses a preset the keyboard does not offer, listing what it does', () => {
    const before = planck();
    const result = resolveProposal({
      configuration: before,
      catalog,
      newId,
      proposal: proposal([{ op: 'apply_layout_preset', preset: 'hhkb' }]),
    });
    expect(result.issues[0]).toMatchObject({
      op: 'apply_layout_preset',
      reason: '"hhkb" is not a layout preset that fits this keyboard',
      candidates: ['planck_mit', 'ortho_4x16 (fitted, 100% of keys)', 'ortho_4x6 (fitted, 50% of keys)'],
    });
    // A five-row arrangement is never offered for a four-row grid, however many keys coincide.
    expect(result.issues[0]?.candidates?.some((c) => c.startsWith('ortho_5x') || c.startsWith('60_'))).toBe(false);
    expect(result.candidate.layers).toEqual(before.layers);
  });

  it('fits an arrangement the keyboard does not declare by physical key position', () => {
    const result = resolveProposal({
      configuration: planck(),
      catalog,
      newId,
      proposal: proposal([{ op: 'apply_layout_preset', preset: 'ortho_4x16' }]),
    });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.changes[0]?.description).toMatch(/ortho_4x16 layout preset \(layouts\/default\/ortho_4x16\/default_ortho_4x16\/keymap\.c, fitted by physical key position\)/);
    // Every Planck key has a twin in the left 12 columns of a 4x16 grid.
    expect(Object.keys(result.candidate.layers[0]!.bindings).length).toBeGreaterThan(40);
  });

  it('fails apply_default_keymap honestly when the catalog has no default', () => {
    const kb = keyboardOf('crkbd/rev1');
    const stripped: Catalog = {
      ...catalog,
      keyboards: [{ ...kb, defaultKeymap: { available: false, reason: 'not_found', detail: '' } }],
    };
    const result = resolveProposal({ configuration: crkbd(), catalog: stripped, newId, proposal: proposal([{ op: 'apply_default_keymap' }]) });
    expect(result.issues[0]?.reason).toMatch(/no usable QMK default keymap in the catalog \(not_found\)/);
  });

  it('never mutates the input configuration', () => {
    const config = crkbd();
    const snapshot = JSON.stringify(config);
    resolveProposal({
      configuration: config,
      catalog,
      newId,
      proposal: proposal([{ op: 'apply_default_keymap' }, { op: 'add_layer', name: 'X', fill: 'transparent' }, { op: 'rename_configuration', name: 'Y' }]),
    });
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});

describe('rowsOf', () => {
  it('keeps a column-staggered row together and separates the thumb cluster', () => {
    const layout = keyboardOf('crkbd/rev1').layouts.find((l) => l.name === 'LAYOUT_split_3x6_3')!;
    const rows = rowsOf(layout).map((row) => row.map((p) => p.index));
    expect(rows).toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
      [24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35],
      [36, 37, 38, 39, 40, 41],
    ]);
  });
});

describe('assistant context', () => {
  it('renders positions with the legends the resolver matches on', () => {
    const config = crkbd();
    const ctx = buildAssistantContext({ configuration: config, catalog });
    const text = renderAssistantContext(ctx);

    expect(ctx.keyboard).toEqual({ id: 'crkbd/rev1', displayName: 'Corne', layout: 'LAYOUT_split_3x6_3', positions: 42 });
    expect(ctx.rows.flat()).toHaveLength(42);
    expect(text).toContain(`[${positionOf(config, 'KC_A')}:KC_A]`);
    expect(text).toContain('SOCD: available on this keyboard');
    expect(text).toMatch(/QMK default keymap: available \(keyboards\/crkbd\/keymaps\/default\/keymap\.c, 4 layers\)/);
    expect(text).toContain('Supported keycodes');
    expect(text).toContain('KC_DELETE (Del)');
    // Layers above the base are rendered too, so the model can edit them.
    expect(text).toContain('Layer 1 "Layer 1"');
    expect(text).toContain('MO(1)');
    expect(ctx.layoutPresets).toEqual(['split_3x5_3', 'split_3x6_3']);
    expect(ctx.fittedPresets).toEqual([]); // nothing else is a 3-row split
    expect(text).toContain('exact fit for this keyboard: split_3x5_3, split_3x6_3');
  });

  it('lists arrangements that fit by physical position, with their coverage', () => {
    const ctx = buildAssistantContext({ configuration: planck(), catalog });
    expect(ctx.layoutPresets).toEqual(['planck_mit']);
    expect(ctx.fittedPresets[0]).toEqual({ name: 'ortho_4x16', fit: 1 });
    expect(ctx.fittedPresets.some((f) => f.name.startsWith('60_'))).toBe(false);
    const text = renderAssistantContext(ctx);
    expect(text).toContain('by physical key position');
    expect(text).toContain('ortho_4x16 [100%]');
  });

  it('says plainly when SOCD is unavailable', () => {
    const text = renderAssistantContext(buildAssistantContext({ configuration: planck(), catalog }));
    expect(text).toMatch(/SOCD: NOT available on this keyboard/);
  });
});
