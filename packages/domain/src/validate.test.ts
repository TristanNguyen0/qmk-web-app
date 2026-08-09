import { describe, expect, it } from 'vitest';
import { readCatalogSample } from '@qmk-web-app/qmk-fixtures';
import type { Catalog } from './catalog.ts';
import { DomainError, ERROR_CODES } from './errors.ts';
import { validateConfiguration } from './validate.ts';

const catalog = readCatalogSample() as Catalog;

const NOW = '2026-01-01T00:00:00.000Z';

function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    createdAt: NOW,
    updatedAt: NOW,
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
    generatorVersion: '1.0.0',
    ...overrides,
  };
}

function expectCode(input: unknown, code: string): void {
  try {
    validateConfiguration(input, { catalog });
    throw new Error(`expected validation to fail with ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

describe('validateConfiguration', () => {
  it('accepts a valid configuration and returns the catalog record', () => {
    const { configuration, keyboard } = validateConfiguration(config(), { catalog });
    expect(configuration.keyboardId).toBe('crkbd/rev1');
    expect(keyboard.supported).toBe(true);
  });

  it('rejects unknown fields rather than dropping them', () => {
    expectCode(config({ injected: 'value' }), ERROR_CODES.CONFIG_INVALID);
  });

  it('rejects a keyboard that is not in the catalog', () => {
    expectCode(config({ keyboardId: 'nonexistent/kb' }), ERROR_CODES.CATALOG_KEYBOARD_UNAVAILABLE);
  });

  it('rejects a layout that belongs to a different keyboard', () => {
    expectCode(config({ layoutId: 'LAYOUT_ortho_4x12' }), ERROR_CODES.CATALOG_LAYOUT_UNAVAILABLE);
  });

  it('rejects a position that does not exist in the selected layout', () => {
    // LAYOUT_split_3x6_3 has 42 positions, so 99 is out of range.
    expectCode(
      config({
        layers: [
          {
            id: '33333333-3333-4333-8333-333333333331',
            index: 0,
            name: 'Base',
            bindings: { '99': { kind: 'keycode', keycode: 'KC_A' } },
          },
        ],
      }),
      ERROR_CODES.CONFIG_INVALID,
    );
  });

  it('rejects a configuration built against a different catalog version', () => {
    expectCode(config({ catalogVersion: '9.9.9-1' }), ERROR_CODES.CONFIG_INVALID);
  });

  it('rejects a configuration built against a different QMK commit', () => {
    expectCode(config({ qmkCommit: 'b'.repeat(40) }), ERROR_CODES.CONFIG_INVALID);
  });

  it('rejects a keycode outside the supported catalog', () => {
    expectCode(
      config({
        layers: [
          {
            id: '33333333-3333-4333-8333-333333333331',
            index: 0,
            name: 'Base',
            bindings: { '0': { kind: 'keycode', keycode: 'QK_BOOTLOADER' } },
          },
        ],
      }),
      ERROR_CODES.CONFIG_INVALID,
    );
  });

  it('rejects a binding that references a layer which does not exist', () => {
    expectCode(
      config({
        layers: [
          {
            id: '33333333-3333-4333-8333-333333333331',
            index: 0,
            name: 'Base',
            bindings: { '0': { kind: 'layer_momentary', layer: 3 } },
          },
        ],
      }),
      ERROR_CODES.CONFIG_INVALID,
    );
  });

  it('rejects a binding that references an undefined macro', () => {
    expectCode(
      config({
        layers: [
          {
            id: '33333333-3333-4333-8333-333333333331',
            index: 0,
            name: 'Base',
            bindings: { '0': { kind: 'macro', macroId: '44444444-4444-4444-8444-444444444444' } },
          },
        ],
      }),
      ERROR_CODES.CONFIG_INVALID,
    );
  });

  it('rejects non-contiguous layer indices', () => {
    expectCode(
      config({
        layers: [
          { id: '33333333-3333-4333-8333-333333333331', index: 0, name: 'Base', bindings: {} },
          { id: '33333333-3333-4333-8333-333333333332', index: 2, name: 'Gap', bindings: {} },
        ],
      }),
      ERROR_CODES.CONFIG_INVALID,
    );
  });

  it('rejects a macro that leaves a key held down', () => {
    expectCode(
      config({
        macros: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            name: 'Stuck',
            steps: [{ kind: 'key_down', keycode: 'KC_LEFT_SHIFT' }],
          },
        ],
      }),
      ERROR_CODES.CONFIG_INVALID,
    );
  });

  it('reports SOCD as unavailable rather than silently ignoring it', () => {
    expectCode(
      config({
        socd: {
          enabled: true,
          policyId: 'neutral',
          directionalKeys: { up: 0, down: 1, left: 2, right: 3 },
          directionalKeycodes: { up: 'KC_W', down: 'KC_S', left: 'KC_A', right: 'KC_D' },
        },
      }),
      ERROR_CODES.CAPABILITY_UNAVAILABLE,
    );
  });

  it('rejects SOCD directional keys that are not distinct', () => {
    expectCode(
      config({
        socd: {
          enabled: false,
          policyId: 'neutral',
          directionalKeys: { up: 0, down: 0, left: 2, right: 3 },
          directionalKeycodes: { up: 'KC_W', down: 'KC_S', left: 'KC_A', right: 'KC_D' },
        },
      }),
      ERROR_CODES.CONFIG_INVALID,
    );
  });

  it('returns field-level errors for client display', () => {
    try {
      validateConfiguration(config({ name: '' }), { catalog });
      throw new Error('expected failure');
    } catch (error) {
      expect((error as DomainError).fieldErrors.length).toBeGreaterThan(0);
      expect((error as DomainError).fieldErrors[0]?.path).toBe('name');
    }
  });
});
