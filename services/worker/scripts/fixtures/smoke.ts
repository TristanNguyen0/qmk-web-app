/**
 * The curated smoke fixture set: toolchain and bootloader diversity (D-08), plus the
 * one designated reproducibility entry (D-10).
 *
 * Selection criteria and the coverage arithmetic behind this membership are written
 * down in `docs/matrix-selection.md` — read that document before adding or removing a
 * member here.
 */
import { validateConfiguration, type Catalog } from '@qmk-web-app/domain';
import { GENERATOR_VERSION } from '@qmk-web-app/qmk-generator';
import { syntheticBaseLayer, type MatrixFixture } from '../../src/matrix-fixtures.ts';
import type { FixtureSet } from '../run-matrix.ts';

const NOW = new Date('2026-01-01T00:00:00.000Z').toISOString();

/**
 * `crkbd/rev1` / `LAYOUT_split_3x6_3` — today's rich hand-written fixture, carried
 * verbatim from `smoke-build.ts`'s Phase 0 reproducibility spike: three layers, a
 * layer-tap, a mod-tap, and a structured macro — every MVP binding kind that
 * generates something interesting. This is the matrix's one designated
 * reproducibility entry (D-10): AVR / `caterina`, and the only member with a real
 * multi-position split-ergo layout.
 */
const CRKBD_BASE_KEYS = [
  'KC_TAB', 'KC_Q', 'KC_W', 'KC_E', 'KC_R', 'KC_T', 'KC_Y', 'KC_U', 'KC_I', 'KC_O', 'KC_P', 'KC_BACKSPACE',
  'KC_LEFT_CTRL', 'KC_A', 'KC_S', 'KC_D', 'KC_F', 'KC_G', 'KC_H', 'KC_J', 'KC_K', 'KC_L', 'KC_SEMICOLON', 'KC_QUOTE',
  'KC_LEFT_SHIFT', 'KC_Z', 'KC_X', 'KC_C', 'KC_V', 'KC_B', 'KC_N', 'KC_M', 'KC_COMMA', 'KC_DOT', 'KC_SLASH', 'KC_ESCAPE',
  'KC_LEFT_GUI', 'KC_TAB', 'KC_SPACE', 'KC_ENTER', 'KC_DELETE', 'KC_LEFT_ALT',
];

const CRKBD_MACRO_ID = '11111111-1111-4111-8111-111111111111';

const crkbdFixture: MatrixFixture = {
  keyboardId: 'crkbd/rev1',
  layoutId: 'LAYOUT_split_3x6_3',
  label: 'crkbd/rev1',
  assertDoubleReproducible: true,
  buildInput: (context) => {
    const positionCount = context.layout.positions.length;
    const baseBindings: Record<string, unknown> = {};
    CRKBD_BASE_KEYS.forEach((keycode, i) => {
      if (i >= positionCount) return;
      baseBindings[String(i)] = { kind: 'keycode', keycode };
    });
    // Replace a few positions with the richer binding kinds.
    baseBindings['37'] = { kind: 'layer_momentary', layer: 1 };
    baseBindings['40'] = { kind: 'layer_tap', layer: 2, tap: 'KC_DELETE' };
    baseBindings['12'] = { kind: 'mod_tap', hold: 'KC_LEFT_CTRL', tap: 'KC_ESCAPE' };
    baseBindings['0'] = { kind: 'macro', macroId: CRKBD_MACRO_ID };

    const numberBindings: Record<string, unknown> = {};
    ['KC_1', 'KC_2', 'KC_3', 'KC_4', 'KC_5', 'KC_6', 'KC_7', 'KC_8', 'KC_9', 'KC_0'].forEach((keycode, i) => {
      numberBindings[String(i + 1)] = { kind: 'keycode', keycode };
    });

    return {
      id: '22222222-2222-4222-8222-222222222221',
      ownerId: null,
      schemaVersion: 1,
      catalogVersion: context.catalog.catalogVersion,
      qmkCommit: context.catalog.qmkCommit,
      keyboardId: 'crkbd/rev1',
      layoutId: 'LAYOUT_split_3x6_3',
      name: 'Smoke matrix: crkbd/rev1',
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
      layers: [
        { id: '33333333-3333-4333-8333-333333333331', index: 0, name: 'Base', bindings: baseBindings },
        { id: '33333333-3333-4333-8333-333333333332', index: 1, name: 'Numbers', bindings: numberBindings },
        {
          id: '33333333-3333-4333-8333-333333333333',
          index: 2,
          name: 'Nav',
          bindings: {
            '20': { kind: 'keycode', keycode: 'KC_LEFT' },
            '21': { kind: 'keycode', keycode: 'KC_DOWN' },
            '22': { kind: 'keycode', keycode: 'KC_UP' },
            '23': { kind: 'keycode', keycode: 'KC_RIGHT' },
          },
        },
      ],
      macros: [
        {
          id: CRKBD_MACRO_ID,
          name: 'Type hi',
          steps: [
            { kind: 'key_down', keycode: 'KC_LEFT_SHIFT' },
            { kind: 'tap', keycode: 'KC_H' },
            { kind: 'key_up', keycode: 'KC_LEFT_SHIFT' },
            { kind: 'tap', keycode: 'KC_I' },
            { kind: 'delay', durationMs: 50 },
          ],
        },
      ],
      socd: null,
      generatorVersion: GENERATOR_VERSION,
    };
  },
};

/**
 * `handwired/onekey/*` is QMK's own single-key per-MCU probe board (`LAYOUT_ortho_1x1`,
 * one position), which makes an added toolchain cost one short compile instead of a
 * hand-written key table. `syntheticBaseLayer` binds that one position from the
 * catalog's own layout, never a hard-coded table (claude.md rule 2).
 */
function onekeyFixture(keyboardId: string, label: string): MatrixFixture {
  return {
    keyboardId,
    layoutId: 'LAYOUT_ortho_1x1',
    label,
    buildInput: (context) => ({
      id: '22222222-2222-4222-8222-222222222222',
      ownerId: null,
      schemaVersion: 1,
      catalogVersion: context.catalog.catalogVersion,
      qmkCommit: context.catalog.qmkCommit,
      keyboardId,
      layoutId: 'LAYOUT_ortho_1x1',
      name: `Smoke matrix: ${keyboardId}`,
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
      layers: [
        {
          id: '33333333-3333-4333-8333-333333333334',
          index: 0,
          name: 'Base',
          bindings: syntheticBaseLayer(context.layout.positions),
        },
      ],
      macros: [],
      socd: null,
      generatorVersion: GENERATOR_VERSION,
    }),
  };
}

export const SMOKE_FIXTURES: readonly MatrixFixture[] = [
  crkbdFixture,
  onekeyFixture('handwired/onekey/elite_c', 'handwired/onekey/elite_c'),
  onekeyFixture('handwired/onekey/rp2040', 'handwired/onekey/rp2040'),
  onekeyFixture('handwired/onekey/stm32f0_disco', 'handwired/onekey/stm32f0_disco'),
];

export const SMOKE_FIXTURE_SET: FixtureSet = {
  name: 'smoke',
  fixtures: SMOKE_FIXTURES,
  requireReproducibilityEntry: true,
  enforceSocdGuard: false,
  validate: (input, catalog: Catalog) => validateConfiguration(input, { catalog }).configuration,
};
