import { describe, expect, it } from 'vitest';
import { readCatalogSample } from '@qmk-web-app/qmk-fixtures';
import type { Catalog, Configuration, SupportedCatalogKeyboard } from '@qmk-web-app/domain';
import { generateKeymap, GenerationError, GENERATOR_VERSION } from './generate.ts';

const catalog = readCatalogSample() as Catalog;
const keyboard = catalog.keyboards.find(
  (k): k is SupportedCatalogKeyboard => k.supported && k.keyboardId === 'crkbd/rev1',
)!;
const layout = keyboard.layouts.find((l) => l.name === 'LAYOUT_split_3x6_3')!;

const BUILD_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const MACRO_ID = '11111111-1111-4111-8111-111111111111';

function config(overrides: Partial<Configuration> = {}): Configuration {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: '22222222-2222-4222-8222-222222222222',
    ownerId: null,
    schemaVersion: 1,
    catalogVersion: catalog.catalogVersion,
    qmkCommit: catalog.qmkCommit,
    keyboardId: 'crkbd/rev1',
    layoutId: 'LAYOUT_split_3x6_3',
    name: 'Test',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    layers: [
      {
        id: '33333333-3333-4333-8333-333333333331',
        index: 0,
        name: 'Base',
        bindings: { '0': { kind: 'keycode', keycode: 'KC_A' } },
      },
    ],
    macros: [],
    socd: null,
    generatorVersion: GENERATOR_VERSION,
    ...overrides,
  } as Configuration;
}

function generate(configuration: Configuration, buildId = BUILD_ID) {
  return generateKeymap({ configuration, keyboard, buildId });
}

function keymapJson(result: ReturnType<typeof generate>): Record<string, unknown> {
  const file = result.files.find((f) => f.path.endsWith('keymap.json'))!;
  return JSON.parse(file.contents);
}

describe('generated file allowlist', () => {
  it('emits only qmk.json and keymap.json — no C, no Make, no headers', () => {
    const files = generate(config()).files.map((f) => f.path.split('/').at(-1));
    expect(new Set(files)).toEqual(new Set(['qmk.json', 'keymap.json']));
  });

  it('places the keymap in an application-owned directory derived from the build id', () => {
    const result = generate(config());
    expect(result.keymapName).toBe('qwa_aaaaaaaa000040008000000000000001');
    expect(result.files.some((f) =>
      f.path === `keyboards/crkbd/rev1/keymaps/${result.keymapName}/keymap.json`,
    )).toBe(true);
  });
});

describe('determinism', () => {
  it('produces byte-identical output for the same input', () => {
    const a = generate(config());
    const b = generate(config());
    expect(a.files).toEqual(b.files);
  });

  it('is independent of macro and layer array ordering', () => {
    const macros = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'A', steps: [{ kind: 'tap' as const, keycode: 'KC_A' }] },
      { id: '11111111-1111-4111-8111-111111111112', name: 'B', steps: [{ kind: 'tap' as const, keycode: 'KC_B' }] },
    ];
    const layers = [
      { id: '33333333-3333-4333-8333-333333333331', index: 0, name: 'Base', bindings: {} },
      { id: '33333333-3333-4333-8333-333333333332', index: 1, name: 'Two', bindings: {} },
    ];
    const forward = generate(config({ macros, layers }));
    const reversed = generate(config({ macros: [...macros].reverse(), layers: [...layers].reverse() }));
    expect(forward.files).toEqual(reversed.files);
  });
});

describe('layer rendering', () => {
  it('emits a dense array covering every position in the layout', () => {
    const layers = keymapJson(generate(config()))['layers'] as string[][];
    expect(layers).toHaveLength(1);
    expect(layers[0]).toHaveLength(layout.positions.length);
  });

  it('fills unassigned base-layer positions with KC_NO and higher layers with KC_TRANSPARENT', () => {
    const result = generate(
      config({
        layers: [
          { id: '33333333-3333-4333-8333-333333333331', index: 0, name: 'Base', bindings: {} },
          { id: '33333333-3333-4333-8333-333333333332', index: 1, name: 'Two', bindings: {} },
        ],
      } as Partial<Configuration>),
    );
    const layers = keymapJson(result)['layers'] as string[][];
    expect(new Set(layers[0])).toEqual(new Set(['KC_NO']));
    expect(new Set(layers[1])).toEqual(new Set(['KC_TRANSPARENT']));
  });

  it('renders each binding kind in QMK syntax', () => {
    const result = generate(
      config({
        layers: [
          {
            id: '33333333-3333-4333-8333-333333333331',
            index: 0,
            name: 'Base',
            bindings: {
              '0': { kind: 'keycode', keycode: 'KC_A' },
              '1': { kind: 'transparent' },
              '2': { kind: 'no_op' },
              '3': { kind: 'layer_momentary', layer: 1 },
              '4': { kind: 'layer_toggle', layer: 1 },
              '5': { kind: 'layer_tap', layer: 1, tap: 'KC_SPACE' },
              '6': { kind: 'mod_tap', hold: 'KC_LEFT_CTRL', tap: 'KC_ESCAPE' },
            },
          },
          { id: '33333333-3333-4333-8333-333333333332', index: 1, name: 'Two', bindings: {} },
        ],
      } as Partial<Configuration>),
    );
    const layer0 = (keymapJson(result)['layers'] as string[][])[0]!;
    expect(layer0.slice(0, 7)).toEqual([
      'KC_A',
      'KC_TRANSPARENT',
      'KC_NO',
      'MO(1)',
      'TG(1)',
      'LT(1,KC_SPACE)',
      'MT(MOD_LCTL,KC_ESCAPE)',
    ]);
  });
});

describe('macros', () => {
  const macroConfig = config({
    layers: [
      {
        id: '33333333-3333-4333-8333-333333333331',
        index: 0,
        name: 'Base',
        bindings: { '0': { kind: 'macro', macroId: MACRO_ID } },
      },
    ],
    macros: [
      {
        id: MACRO_ID,
        name: 'Hi',
        steps: [
          { kind: 'key_down', keycode: 'KC_LEFT_SHIFT' },
          { kind: 'tap', keycode: 'KC_H' },
          { kind: 'key_up', keycode: 'KC_LEFT_SHIFT' },
          { kind: 'delay', durationMs: 50 },
        ],
      },
    ],
  } as Partial<Configuration>);

  it('references macros as QK_MACRO_<index>, matching QMK keymap.py', () => {
    const layer0 = (keymapJson(generate(macroConfig))['layers'] as string[][])[0]!;
    expect(layer0[0]).toBe('QK_MACRO_0');
  });

  it('emits macro keycodes in SEND_STRING form, without the KC_ prefix', () => {
    // QMK pastes these straight after `X_`, so `KC_LEFT_SHIFT` here would compile to
    // `X_KC_LEFT_SHIFT`, which does not exist. This test pins that behaviour.
    const macros = keymapJson(generate(macroConfig))['macros'] as unknown[][];
    expect(macros[0]).toEqual([
      { action: 'down', keycodes: ['LEFT_SHIFT'] },
      { action: 'tap', keycodes: ['H'] },
      { action: 'up', keycodes: ['LEFT_SHIFT'] },
      { action: 'delay', duration: 50 },
    ]);
  });

  it('omits the macros key entirely when there are none', () => {
    expect(keymapJson(generate(config()))).not.toHaveProperty('macros');
  });
});

describe('refusals', () => {
  it('refuses to emit a keycode outside the allowlist even if it reached generation', () => {
    const bad = config({
      layers: [
        {
          id: '33333333-3333-4333-8333-333333333331',
          index: 0,
          name: 'Base',
          bindings: { '0': { kind: 'keycode', keycode: 'RESET' } },
        },
      ],
    } as Partial<Configuration>);
    expect(() => generate(bad)).toThrow(GenerationError);
  });

  it('refuses to generate SOCD until it is verified for the pinned revision', () => {
    const withSocd = config({
      socd: {
        enabled: true,
        policyId: 'neutral',
        directionalKeys: { up: 0, down: 1, left: 2, right: 3 },
        directionalKeycodes: { up: 'KC_W', down: 'KC_S', left: 'KC_A', right: 'KC_D' },
      },
    } as Partial<Configuration>);
    expect(() => generate(withSocd)).toThrow(/SOCD/);
  });

  it('refuses when the configuration and catalog record disagree', () => {
    expect(() => generate(config({ keyboardId: 'planck/rev6' }))).toThrow(GenerationError);
  });

  it('refuses a layout that is not part of the keyboard', () => {
    expect(() => generate(config({ layoutId: 'LAYOUT_ortho_4x12' }))).toThrow(GenerationError);
  });

  it('refuses a build id that is not hex, so user text cannot become a directory name', () => {
    expect(() => generate(config(), 'my-keymap')).toThrow();
  });
});
