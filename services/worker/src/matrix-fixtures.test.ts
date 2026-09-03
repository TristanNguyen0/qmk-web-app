/**
 * Fast, Docker-free coverage of the fixture contract and the registry-fixture guard.
 *
 * `missingSocdFixtures` uses the real `MODULE_REGISTRY` and the real shipped catalog
 * version string, not a stub — the whole point of the guard is that it tracks the
 * shipped registry, so a test against a fake registry would prove nothing about the
 * actual claim.
 */
import { describe, expect, it } from 'vitest';
import {
  MatrixFixtureError,
  missingSocdFixtures,
  syntheticBaseLayer,
  validateFixtureSet,
  type MatrixFixture,
} from './matrix-fixtures.ts';

const CATALOG_VERSION = '0.33.13-1';

function fixture(overrides: Partial<MatrixFixture> & Pick<MatrixFixture, 'keyboardId' | 'layoutId'>): MatrixFixture {
  return {
    label: `${overrides.keyboardId} / ${overrides.layoutId}`,
    buildInput: () => ({}),
    ...overrides,
  };
}

describe('missingSocdFixtures', () => {
  it('reports a registry-verified keyboard absent from the fixture list', () => {
    expect(missingSocdFixtures(CATALOG_VERSION, ['crkbd/rev1'])).toEqual(['mode/m256wh']);
  });

  it('reports nothing missing once every verified keyboard has a fixture', () => {
    expect(missingSocdFixtures(CATALOG_VERSION, ['crkbd/rev1', 'mode/m256wh'])).toEqual([]);
  });

  it('reports nothing missing for a catalog version with no verified keyboards', () => {
    expect(missingSocdFixtures('9.9.9-1', [])).toEqual([]);
  });

  it('runs in one direction only: a fixture for an unrecorded keyboard is not required', () => {
    // A candidate keyboard with a fixture but no registry record yet must not appear
    // as "missing" — that is exactly how a candidate earns its record (D-06).
    expect(
      missingSocdFixtures(CATALOG_VERSION, ['crkbd/rev1', 'mode/m256wh', 'some/unverified_candidate']),
    ).toEqual([]);
  });
});

describe('validateFixtureSet', () => {
  it('throws a named error for an empty set', () => {
    expect(() => validateFixtureSet([], { requireReproducibilityEntry: false })).toThrow(MatrixFixtureError);
    expect(() => validateFixtureSet([], { requireReproducibilityEntry: false })).toThrow(/empty/);
  });

  it('throws and names the duplicate when two entries share keyboardId and layoutId', () => {
    const fixtures = [
      fixture({ keyboardId: 'crkbd/rev1', layoutId: 'LAYOUT_split_3x6_3' }),
      fixture({ keyboardId: 'crkbd/rev1', layoutId: 'LAYOUT_split_3x6_3' }),
    ];
    expect(() => validateFixtureSet(fixtures, { requireReproducibilityEntry: false })).toThrow(
      /crkbd\/rev1/,
    );
  });

  it('accepts two entries with the same keyboardId but different layoutId', () => {
    const fixtures = [
      fixture({ keyboardId: 'crkbd/rev1', layoutId: 'LAYOUT_split_3x6_3' }),
      fixture({ keyboardId: 'crkbd/rev1', layoutId: 'LAYOUT_split_3x6_3_2' }),
    ];
    expect(validateFixtureSet(fixtures, { requireReproducibilityEntry: false })).toEqual(fixtures);
  });

  it('returns entries in declaration order, unchanged', () => {
    const fixtures = [
      fixture({ keyboardId: 'handwired/onekey/elite_c', layoutId: 'LAYOUT_ortho_1x1' }),
      fixture({ keyboardId: 'crkbd/rev1', layoutId: 'LAYOUT_split_3x6_3' }),
      fixture({ keyboardId: 'handwired/onekey/rp2040', layoutId: 'LAYOUT_ortho_1x1' }),
    ];
    expect(validateFixtureSet(fixtures, { requireReproducibilityEntry: false })).toEqual(fixtures);
  });

  it('throws when more than one entry sets assertDoubleReproducible', () => {
    const fixtures = [
      fixture({ keyboardId: 'crkbd/rev1', layoutId: 'LAYOUT_split_3x6_3', assertDoubleReproducible: true }),
      fixture({ keyboardId: 'mode/m256wh', layoutId: 'LAYOUT_65_ansi_blocker', assertDoubleReproducible: true }),
    ];
    expect(() => validateFixtureSet(fixtures, { requireReproducibilityEntry: false })).toThrow(
      MatrixFixtureError,
    );
  });

  it('throws when a designated matrix set has no assertDoubleReproducible entry', () => {
    const fixtures = [fixture({ keyboardId: 'crkbd/rev1', layoutId: 'LAYOUT_split_3x6_3' })];
    expect(() => validateFixtureSet(fixtures, { requireReproducibilityEntry: true })).toThrow(/D-10/);
  });

  it('accepts a designated matrix set with exactly one assertDoubleReproducible entry', () => {
    const fixtures = [
      fixture({ keyboardId: 'crkbd/rev1', layoutId: 'LAYOUT_split_3x6_3', assertDoubleReproducible: true }),
      fixture({ keyboardId: 'handwired/onekey/rp2040', layoutId: 'LAYOUT_ortho_1x1' }),
    ];
    expect(validateFixtureSet(fixtures, { requireReproducibilityEntry: true })).toEqual(fixtures);
  });
});

describe('syntheticBaseLayer', () => {
  it('binds exactly one position for a one-position layout', () => {
    const bindings = syntheticBaseLayer([{ index: 0 }]);
    expect(Object.keys(bindings)).toHaveLength(1);
    expect(bindings['0']).toMatchObject({ kind: 'keycode' });
  });

  it('binds every position for a 67-position layout, scaling with the catalog', () => {
    const positions = Array.from({ length: 67 }, (_, index) => ({ index }));
    const bindings = syntheticBaseLayer(positions);
    expect(Object.keys(bindings)).toHaveLength(67);
    for (let i = 0; i < 67; i += 1) {
      expect(bindings[String(i)]).toMatchObject({ kind: 'keycode' });
    }
  });
});
