import { describe, expect, it } from 'vitest';
import type { CatalogLayout, SupportedCatalogKeyboard } from './catalog.ts';
import {
  bindingFromQmkToken,
  importCommunityKeymap,
  importDefaultKeymap,
  layerNameFromDesignator,
} from './default-keymap.ts';
import { LIMITS } from './limits.ts';

/** The subset of QMK's alias table these tests need, in the shape the catalog carries. */
const ALIASES: Record<string, string> = {
  _______: 'KC_TRANSPARENT',
  KC_TRNS: 'KC_TRANSPARENT',
  XXXXXXX: 'KC_NO',
  KC_BSPC: 'KC_BACKSPACE',
  KC_SPC: 'KC_SPACE',
  KC_ENT: 'KC_ENTER',
  KC_ESC: 'KC_ESCAPE',
  KC_LCTL: 'KC_LEFT_CTRL',
  KC_LSFT: 'KC_LEFT_SHIFT',
  KC_RSFT: 'KC_RIGHT_SHIFT',
  KC_SCLN: 'KC_SEMICOLON',
  KC_SLSH: 'KC_SLASH',
};

const CTX = { namesByIndex: ['_BASE', '_LOWER', '_RAISE'], layerCount: 3 };

function layout(name: string, matrices: [number, number][]): CatalogLayout {
  return {
    name,
    positions: matrices.map((matrix, index) => ({
      index,
      matrix,
      x: index,
      y: 0,
      w: 1,
      h: 1,
      r: 0,
      rx: 0,
      ry: 0,
      label: null,
    })),
  };
}

function keyboard(overrides: Partial<SupportedCatalogKeyboard> = {}): SupportedCatalogKeyboard {
  return {
    supported: true,
    keyboardId: 'test/board',
    displayName: 'Test',
    manufacturer: null,
    url: null,
    processor: 'atmega32u4',
    bootloader: 'caterina',
    platform: null,
    layouts: [
      layout('LAYOUT_all', [
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 0],
      ]),
      // A narrower layout: the same switches minus [0,2], in a different order.
      layout('LAYOUT_narrow', [
        [1, 0],
        [0, 0],
        [0, 1],
      ]),
    ],
    features: {},
    defaultKeymap: {
      available: true,
      source: 'keyboards/test/board/keymaps/default/keymap.c',
      layout: 'LAYOUT_all',
      layers: [
        { name: '_BASE', keycodes: ['KC_A', 'KC_BSPC', 'MO(_LOWER)', 'LT(2,KC_SPC)'] },
        { name: '_LOWER', keycodes: ['KC_1', '_______', 'QK_BOOT', 'XXXXXXX'] },
        { name: '_RAISE', keycodes: ['RGB_TOG', 'KC_TRNS', 'TG(_BASE)', 'LCTL_T(KC_ESC)'] },
      ],
    },
    communityLayouts: [],
    provenance: { keyboardFolder: 'test/board', qmkCommit: 'a'.repeat(40), extractorVersion: 2, parseWarnings: [] },
    ...overrides,
  };
}

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

describe('bindingFromQmkToken', () => {
  it('resolves aliases through the catalog table and binds supported keycodes', () => {
    expect(bindingFromQmkToken('KC_BSPC', ALIASES, CTX)).toEqual({ kind: 'keycode', keycode: 'KC_BACKSPACE' });
    expect(bindingFromQmkToken('KC_A', ALIASES, CTX)).toEqual({ kind: 'keycode', keycode: 'KC_A' });
  });

  it('maps transparent and no-op to their own binding kinds', () => {
    expect(bindingFromQmkToken('_______', ALIASES, CTX)).toEqual({ kind: 'transparent' });
    expect(bindingFromQmkToken('KC_TRNS', ALIASES, CTX)).toEqual({ kind: 'transparent' });
    expect(bindingFromQmkToken('XXXXXXX', ALIASES, CTX)).toEqual({ kind: 'no_op' });
    expect(bindingFromQmkToken('KC_NO', ALIASES, CTX)).toEqual({ kind: 'no_op' });
  });

  it('rejects keycodes outside the supported catalog rather than substituting', () => {
    expect(bindingFromQmkToken('QK_BOOT', ALIASES, CTX)).toBeNull();
    expect(bindingFromQmkToken('RGB_TOG', ALIASES, CTX)).toBeNull();
    expect(bindingFromQmkToken('KC_MPLY', ALIASES, CTX)).toBeNull();
  });

  it('maps layer keys with numeric and designator arguments', () => {
    expect(bindingFromQmkToken('MO(1)', ALIASES, CTX)).toEqual({ kind: 'layer_momentary', layer: 1 });
    expect(bindingFromQmkToken('MO(_RAISE)', ALIASES, CTX)).toEqual({ kind: 'layer_momentary', layer: 2 });
    expect(bindingFromQmkToken('TG(_LOWER)', ALIASES, CTX)).toEqual({ kind: 'layer_toggle', layer: 1 });
    expect(bindingFromQmkToken('LT(1, KC_SPC)', ALIASES, CTX)).toEqual({ kind: 'layer_tap', layer: 1, tap: 'KC_SPACE' });
    expect(bindingFromQmkToken('LT(_RAISE,KC_ENT)', ALIASES, CTX)).toEqual({ kind: 'layer_tap', layer: 2, tap: 'KC_ENTER' });
  });

  it('rejects layer references it cannot resolve', () => {
    expect(bindingFromQmkToken('MO(3)', ALIASES, CTX)).toBeNull(); // beyond imported layers
    expect(bindingFromQmkToken('MO(_ADJUST)', ALIASES, CTX)).toBeNull(); // no such designator
    expect(bindingFromQmkToken('LT(1,QK_BOOT)', ALIASES, CTX)).toBeNull(); // unsupported tap
    expect(bindingFromQmkToken('LT(1,_______)', ALIASES, CTX)).toBeNull();
  });

  it('maps single-modifier tap-hold macros to mod_tap', () => {
    expect(bindingFromQmkToken('LCTL_T(KC_ESC)', ALIASES, CTX)).toEqual({ kind: 'mod_tap', hold: 'KC_LEFT_CTRL', tap: 'KC_ESCAPE' });
    expect(bindingFromQmkToken('RSFT_T(KC_SLSH)', ALIASES, CTX)).toEqual({ kind: 'mod_tap', hold: 'KC_RIGHT_SHIFT', tap: 'KC_SLASH' });
    expect(bindingFromQmkToken('GUI_T(KC_A)', ALIASES, CTX)).toEqual({ kind: 'mod_tap', hold: 'KC_LEFT_GUI', tap: 'KC_A' });
    expect(bindingFromQmkToken('MT(MOD_LSFT,KC_A)', ALIASES, CTX)).toEqual({ kind: 'mod_tap', hold: 'KC_LEFT_SHIFT', tap: 'KC_A' });
  });

  it('rejects multi-modifier tap-hold, which the product does not support', () => {
    expect(bindingFromQmkToken('MT(MOD_LCTL|MOD_LSFT,KC_ESC)', ALIASES, CTX)).toBeNull();
    expect(bindingFromQmkToken('LCS_T(KC_ESC)', ALIASES, CTX)).toBeNull();
    expect(bindingFromQmkToken('HYPR_T(KC_ESC)', ALIASES, CTX)).toBeNull();
  });

  it('never produces a binding from malformed input', () => {
    expect(bindingFromQmkToken('', ALIASES, CTX)).toBeNull();
    expect(bindingFromQmkToken('MO(', ALIASES, CTX)).toBeNull();
    expect(bindingFromQmkToken('MO(1,2)', ALIASES, CTX)).toBeNull();
    expect(bindingFromQmkToken('KC_A; system("x")', ALIASES, CTX)).toBeNull();
    expect(bindingFromQmkToken('__proto__', ALIASES, CTX)).toBeNull();
  });
});

describe('layerNameFromDesignator', () => {
  it('turns C designators into readable names and numbers into positional names', () => {
    expect(layerNameFromDesignator('_QWERTY', 0)).toBe('Qwerty');
    expect(layerNameFromDesignator('_LOWER', 1)).toBe('Lower');
    expect(layerNameFromDesignator('MY_FN_LAYER', 2)).toBe('My fn layer');
    expect(layerNameFromDesignator('0', 0)).toBe('Base');
    expect(layerNameFromDesignator('3', 3)).toBe('Layer 3');
    expect(layerNameFromDesignator(null, 1)).toBe('Layer 1');
    expect(layerNameFromDesignator('___', 1)).toBe('Layer 1');
  });

  it('respects the layer name length limit', () => {
    expect(layerNameFromDesignator('X'.repeat(200), 0).length).toBe(LIMITS.maxLayerNameLength);
  });
});

describe('importDefaultKeymap', () => {
  it('imports the default keymap position for position on its own layout', () => {
    const result = importDefaultKeymap({ keyboard: keyboard(), layoutId: 'LAYOUT_all', keycodeAliases: ALIASES, newId });
    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.source).toBe('keyboards/test/board/keymaps/default/keymap.c');
    expect(result.sourceLayout).toBe('LAYOUT_all');
    expect(result.layers.map((l) => l.name)).toEqual(['Base', 'Lower', 'Raise']);
    expect(result.layers.map((l) => l.index)).toEqual([0, 1, 2]);
    expect(result.layers[0]?.bindings).toEqual({
      '0': { kind: 'keycode', keycode: 'KC_A' },
      '1': { kind: 'keycode', keycode: 'KC_BACKSPACE' },
      '2': { kind: 'layer_momentary', layer: 1 },
      '3': { kind: 'layer_tap', layer: 2, tap: 'KC_SPACE' },
    });
    expect(result.layers[1]?.bindings).toEqual({
      '0': { kind: 'keycode', keycode: 'KC_1' },
      '1': { kind: 'transparent' },
      // position 2 (QK_BOOT) is deliberately absent — unassigned, not remapped
      '3': { kind: 'no_op' },
    });
    expect(result.layers[2]?.bindings).toEqual({
      '1': { kind: 'transparent' },
      '2': { kind: 'layer_toggle', layer: 0 },
      '3': { kind: 'mod_tap', hold: 'KC_LEFT_CTRL', tap: 'KC_ESCAPE' },
    });
    expect(result.unmapped).toEqual([
      { layerIndex: 1, position: 2, keycode: 'QK_BOOT' },
      { layerIndex: 2, position: 0, keycode: 'RGB_TOG' },
    ]);
    expect(result.droppedLayers).toBe(0);
    expect(result.unmatchedPositions).toBe(0);
  });

  it('carries bindings to a different layout by matrix coordinate', () => {
    const result = importDefaultKeymap({ keyboard: keyboard(), layoutId: 'LAYOUT_narrow', keycodeAliases: ALIASES, newId });
    expect(result.available).toBe(true);
    if (!result.available) return;

    // LAYOUT_narrow position 0 is switch [1,0] = LAYOUT_all position 3, etc.
    expect(result.layers[0]?.bindings).toEqual({
      '0': { kind: 'layer_tap', layer: 2, tap: 'KC_SPACE' },
      '1': { kind: 'keycode', keycode: 'KC_A' },
      '2': { kind: 'keycode', keycode: 'KC_BACKSPACE' },
    });
    expect(result.unmatchedPositions).toBe(0);
    // Unmapped positions are reported in target-layout terms.
    expect(result.unmapped).toEqual([{ layerIndex: 2, position: 1, keycode: 'RGB_TOG' }]);
  });

  it('leaves target positions with no source switch unassigned and counts them', () => {
    const kb = keyboard();
    const wide = layout('LAYOUT_wide', [
      [0, 0],
      [5, 5],
    ]);
    const result = importDefaultKeymap({
      keyboard: { ...kb, layouts: [...kb.layouts, wide] },
      layoutId: 'LAYOUT_wide',
      keycodeAliases: ALIASES,
      newId,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.layers[0]?.bindings).toEqual({ '0': { kind: 'keycode', keycode: 'KC_A' } });
    expect(result.unmatchedPositions).toBe(1);
  });

  it('caps layers at the product limit and reports the remainder', () => {
    const kb = keyboard();
    const many = Array.from({ length: LIMITS.maxLayers + 2 }, (_, i) => ({
      name: String(i),
      keycodes: ['KC_A', 'KC_B', 'KC_C', `MO(${LIMITS.maxLayers + 1})`],
    }));
    const result = importDefaultKeymap({
      keyboard: {
        ...kb,
        defaultKeymap: { available: true, source: 's', layout: 'LAYOUT_all', layers: many },
      },
      layoutId: 'LAYOUT_all',
      keycodeAliases: ALIASES,
      newId,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.layers).toHaveLength(LIMITS.maxLayers);
    expect(result.droppedLayers).toBe(2);
    // References into dropped layers are unmapped rather than dangling.
    expect(result.unmapped.every((u) => u.keycode === `MO(${LIMITS.maxLayers + 1})`)).toBe(true);
    expect(result.unmapped).toHaveLength(LIMITS.maxLayers);
  });

  it('reports unavailability instead of inventing a keymap', () => {
    const kb = keyboard();
    expect(
      importDefaultKeymap({
        keyboard: { ...kb, defaultKeymap: { available: false, reason: 'not_found', detail: '' } },
        layoutId: 'LAYOUT_all',
        keycodeAliases: ALIASES,
      }),
    ).toEqual({ available: false, reason: 'not_found' });

    expect(importDefaultKeymap({ keyboard: kb, layoutId: 'LAYOUT_missing', keycodeAliases: ALIASES })).toEqual({
      available: false,
      reason: 'unknown_layout',
    });

    // A catalog published before default keymaps existed has no field at all.
    const legacy = { ...kb } as Partial<SupportedCatalogKeyboard>;
    delete legacy.defaultKeymap;
    const result = importDefaultKeymap({
      keyboard: legacy as SupportedCatalogKeyboard,
      layoutId: 'LAYOUT_all',
      keycodeAliases: ALIASES,
    });
    expect(result.available).toBe(false);
  });

  it('produces layers that pass the configuration schema', async () => {
    const { layerSchema } = await import('./configuration.ts');
    const result = importDefaultKeymap({ keyboard: keyboard(), layoutId: 'LAYOUT_all', keycodeAliases: ALIASES, newId });
    if (!result.available) throw new Error('expected available');
    for (const layer of result.layers) {
      expect(layerSchema.safeParse(layer).success).toBe(true);
    }
  });
});

describe('importCommunityKeymap', () => {
  const COMMUNITY = {
    tiny_3: {
      name: 'tiny_3',
      source: 'layouts/default/tiny_3/default_tiny_3/keymap.c',
      layers: [
        { name: '0', keycodes: ['KC_ESC', 'KC_LCTL', 'MO(1)'] },
        { name: '1', keycodes: ['_______', 'KC_DELETE', '_______'] },
      ],
    },
  };

  it('carries a supported community keymap onto the chosen layout through the keyboard’s own macro', () => {
    const kb = keyboard({ communityLayouts: [{ name: 'tiny_3', layout: 'LAYOUT_narrow' }] });
    const result = importCommunityKeymap({
      keyboard: kb,
      layoutId: 'LAYOUT_all',
      name: 'tiny_3',
      communityKeymaps: COMMUNITY,
      keycodeAliases: ALIASES,
      newId,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.source).toBe('layouts/default/tiny_3/default_tiny_3/keymap.c');
    expect(result.sourceLayout).toBe('LAYOUT_narrow');
    // LAYOUT_narrow positions are switches [1,0],[0,0],[0,1] → LAYOUT_all positions 3, 0, 1.
    expect(result.layers[0]?.bindings).toEqual({
      '3': { kind: 'keycode', keycode: 'KC_ESCAPE' },
      '0': { kind: 'keycode', keycode: 'KC_LEFT_CTRL' },
      '1': { kind: 'layer_momentary', layer: 1 },
    });
    expect(result.layers[1]?.bindings['0']).toEqual({ kind: 'keycode', keycode: 'KC_DELETE' });
    expect(result.unmatchedPositions).toBe(1); // LAYOUT_all's [0,2] has no key in the preset
  });

  it('refuses a layout the keyboard does not declare, or the catalog has no keymap for', () => {
    expect(
      importCommunityKeymap({ keyboard: keyboard(), layoutId: 'LAYOUT_all', name: 'tiny_3', communityKeymaps: COMMUNITY, keycodeAliases: ALIASES }),
    ).toMatchObject({ available: false, reason: expect.stringMatching(/does not support the tiny_3 layout/) });
    expect(
      importCommunityKeymap({
        keyboard: keyboard({ communityLayouts: [{ name: 'other', layout: 'LAYOUT_all' }] }),
        layoutId: 'LAYOUT_all',
        name: 'other',
        communityKeymaps: COMMUNITY,
        keycodeAliases: ALIASES,
      }),
    ).toMatchObject({ available: false, reason: expect.stringMatching(/no keymap for the other layout/) });
  });
});
