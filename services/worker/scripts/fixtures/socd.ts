/**
 * The SOCD compile matrix fixture set: the evidence behind `MODULE_REGISTRY`'s
 * `verifiedFor` records.
 *
 * claude.md § SOCD Cleaner requirement 6: "Test each selectable policy with compile
 * fixtures", and phase 4: "Enable only tested policies/keyboards". A keyboard may be
 * catalogued, and may even compile a plain keymap, and still fail once the SOCD
 * community module is added — the module is extra flash and an extra translation
 * unit. So "SOCD works here" is a claim this set has to earn, per keyboard, per
 * policy.
 *
 * Every registry-verified keyboard × every published policy compiles for real, in the
 * isolated build image (D-07 preserves `socd-compile-matrix.ts`'s original coverage
 * unchanged). Nothing may be added as a `verifiedFor` record until it passes here —
 * but the converse is deliberately NOT required: a keyboard may have a fixture and be
 * compiled here before it is recorded as verified. That is what lets a candidate
 * (mode/m256wh, phase 4) earn its record instead of needing one to be compiled at all
 * — the chicken-and-egg D-06 exists to avoid. The guard that IS enforced (run by
 * `run-matrix.ts` via `missingSocdFixtures` before any fixture in this set compiles)
 * runs the other direction: any keyboard the registry already records as
 * compile-verified for this catalog version must have a fixture here.
 *
 * `MatrixFixture.layoutId` doubles as this set's dedup key (`validateFixtureSet`
 * rejects two entries sharing (keyboardId, layoutId)). Crossing one keyboard with two
 * policies legitimately produces two builds against the *same* real catalog layout, so
 * each entry's `layoutId` carries a `::<policyId>` discriminator suffix — a real
 * catalog layout name plus the policy that makes this entry distinct, never an
 * invented layout. `run-matrix.ts` strips everything from `::` onward before resolving
 * the catalog layout, so catalog lookup still resolves the real, unmodified layout
 * name.
 */
import {
  parseConfiguration,
  SOCD_HORIZONTAL_PAIRS,
  SOCD_POLICIES,
  SOCD_VERTICAL_PAIRS,
  type Catalog,
  type CatalogLayout,
  type Configuration,
} from '@qmk-web-app/domain';
import { GENERATOR_VERSION } from '@qmk-web-app/qmk-generator';
import type { FixtureSet } from '../run-matrix.ts';
import type { MatrixFixture } from '../../src/matrix-fixtures.ts';

/**
 * Where each keyboard's four directional keys live, and which layout to build.
 *
 * Positions are layout-specific facts, so they are stated per keyboard rather than
 * guessed. Adding a keyboard's verification record to the module registry means adding
 * it here too — and the registry-fixture guard fails loudly if the two lists disagree,
 * so a keyboard cannot be marked verified without a fixture that actually exercises
 * it.
 */
const FIXTURES: Record<
  string,
  {
    layoutId: string;
    /** Base-layer keycode for every position, in layout order. */
    baseKeys: readonly string[];
    directionalKeys: { up: number; down: number; left: number; right: number };
    directionalKeycodes: { up: string; down: string; left: string; right: string };
  }
> = {
  'crkbd/rev1': {
    layoutId: 'LAYOUT_split_3x6_3',
    // A plain QWERTY base, so that W/A/S/D sit where a user would expect them.
    baseKeys: [
      'KC_TAB', 'KC_Q', 'KC_W', 'KC_E', 'KC_R', 'KC_T', 'KC_Y', 'KC_U', 'KC_I', 'KC_O', 'KC_P', 'KC_BACKSPACE',
      'KC_LEFT_CTRL', 'KC_A', 'KC_S', 'KC_D', 'KC_F', 'KC_G', 'KC_H', 'KC_J', 'KC_K', 'KC_L', 'KC_SEMICOLON', 'KC_QUOTE',
      'KC_LEFT_SHIFT', 'KC_Z', 'KC_X', 'KC_C', 'KC_V', 'KC_B', 'KC_N', 'KC_M', 'KC_COMMA', 'KC_DOT', 'KC_SLASH', 'KC_ESCAPE',
      'KC_LEFT_GUI', 'KC_TAB', 'KC_SPACE', 'KC_ENTER', 'KC_DELETE', 'KC_LEFT_ALT',
    ],
    // W is position 2; A, S, D are 13, 14, 15 in the array above.
    directionalKeys: { up: 2, down: 14, left: 13, right: 15 },
    directionalKeycodes: { up: 'KC_W', down: 'KC_S', left: 'KC_A', right: 'KC_D' },
  },
  // First ARM/STM32 fixture (D-06). Base keys mapped in index order from each
  // position's `label` in catalogs/0.33.13-1/keyboards/0009.json's
  // mode/m256wh -> LAYOUT_65_ansi_blocker entry (67 positions), parsed this
  // session — never invented (claude.md rule 2). W/A/S/D pair per RESEARCH.md's
  // verified position indices; the arrow cluster is present on the same layout
  // (up 56, left 64, down 65, right 66) and available for a future fixture.
  'mode/m256wh': {
    layoutId: 'LAYOUT_65_ansi_blocker',
    baseKeys: [
      /*  0 */ 'KC_ESCAPE',
      /*  1 */ 'KC_1',
      /*  2 */ 'KC_2',
      /*  3 */ 'KC_3',
      /*  4 */ 'KC_4',
      /*  5 */ 'KC_5',
      /*  6 */ 'KC_6',
      /*  7 */ 'KC_7',
      /*  8 */ 'KC_8',
      /*  9 */ 'KC_9',
      /* 10 */ 'KC_0',
      /* 11 */ 'KC_MINUS',
      /* 12 */ 'KC_EQUAL',
      /* 13 */ 'KC_BACKSPACE',
      /* 14 */ 'KC_DELETE',
      /* 15 */ 'KC_TAB',
      /* 16 */ 'KC_Q',
      /* 17 */ 'KC_W',
      /* 18 */ 'KC_E',
      /* 19 */ 'KC_R',
      /* 20 */ 'KC_T',
      /* 21 */ 'KC_Y',
      /* 22 */ 'KC_U',
      /* 23 */ 'KC_I',
      /* 24 */ 'KC_O',
      /* 25 */ 'KC_P',
      /* 26 */ 'KC_LEFT_BRACKET',
      /* 27 */ 'KC_RIGHT_BRACKET',
      /* 28 */ 'KC_BACKSLASH',
      /* 29 */ 'KC_PAGE_UP',
      /* 30 */ 'KC_CAPS_LOCK',
      /* 31 */ 'KC_A',
      /* 32 */ 'KC_S',
      /* 33 */ 'KC_D',
      /* 34 */ 'KC_F',
      /* 35 */ 'KC_G',
      /* 36 */ 'KC_H',
      /* 37 */ 'KC_J',
      /* 38 */ 'KC_K',
      /* 39 */ 'KC_L',
      /* 40 */ 'KC_SEMICOLON',
      /* 41 */ 'KC_QUOTE',
      /* 42 */ 'KC_ENTER',
      /* 43 */ 'KC_PAGE_DOWN',
      /* 44 */ 'KC_LEFT_SHIFT',
      /* 45 */ 'KC_Z',
      /* 46 */ 'KC_X',
      /* 47 */ 'KC_C',
      /* 48 */ 'KC_V',
      /* 49 */ 'KC_B',
      /* 50 */ 'KC_N',
      /* 51 */ 'KC_M',
      /* 52 */ 'KC_COMMA',
      /* 53 */ 'KC_DOT',
      /* 54 */ 'KC_SLASH',
      /* 55 */ 'KC_RIGHT_SHIFT',
      /* 56 */ 'KC_UP',
      /* 57 */ 'KC_END',
      /* 58 */ 'KC_LEFT_CTRL',
      /* 59 */ 'KC_LEFT_GUI',
      /* 60 */ 'KC_LEFT_ALT',
      /* 61 */ 'KC_SPACE',
      /* 62 */ 'KC_RIGHT_ALT',
      /* 63 */ 'KC_RIGHT_CTRL',
      /* 64 */ 'KC_LEFT',
      /* 65 */ 'KC_DOWN',
      /* 66 */ 'KC_RIGHT',
    ],
    directionalKeys: { up: 17, down: 32, left: 31, right: 33 },
    directionalKeycodes: { up: 'KC_W', down: 'KC_S', left: 'KC_A', right: 'KC_D' },
  },
};

/** The fixture table's own keys — every candidate this set knows how to build. */
const CANDIDATE_KEYBOARD_IDS = Object.keys(FIXTURES);

/**
 * Passed to `generateKeymap` (via `runBuild`) as the trusted allowlist this set's own
 * run is entitled to compile against — see `GenerateOptions.verifiedSocdKeyboards` for
 * why only this fixture set may supply it.
 */
const VERIFIED_SOCD_KEYBOARDS: ReadonlySet<string> = new Set(CANDIDATE_KEYBOARD_IDS);

/**
 * Structural validation for a matrix-built SOCD configuration — deliberately NOT the
 * public `validateConfiguration()` from `@qmk-web-app/domain`. That function's SOCD
 * path gates on `MODULE_REGISTRY`'s `verifiedFor` list (packages/domain/src/validate.ts),
 * which is exactly the chicken-and-egg this set exists to break: a candidate keyboard
 * must be compilable *before* it earns a `verifiedFor` record, but the public function
 * refuses to build a configuration for a keyboard that is not already in that list.
 * Every OTHER structural guarantee `validateConfiguration` provides is kept here —
 * schema shape (via the same exported `parseConfiguration`), layout/position validity,
 * opposing-pair matching, and base-layer binding agreement — so a bug in a fixture
 * still fails loudly. Only the registry capability gate itself is intentionally not
 * re-derived; this set's own successful run is what later earns that gate's entry, not
 * a precondition for reaching it.
 */
export function validateForMatrix(input: unknown, catalog: Catalog, layout: CatalogLayout): Configuration {
  const configuration = parseConfiguration(input);

  if (configuration.catalogVersion !== catalog.catalogVersion) {
    throw new Error(
      `configuration targets catalog ${configuration.catalogVersion}, expected ${catalog.catalogVersion}`,
    );
  }
  if (configuration.qmkCommit !== catalog.qmkCommit) {
    throw new Error(`configuration targets QMK commit ${configuration.qmkCommit}, expected ${catalog.qmkCommit}`);
  }

  const validPositions = new Set(layout.positions.map((p) => p.index));
  for (const layer of configuration.layers) {
    for (const position of Object.keys(layer.bindings)) {
      if (!validPositions.has(Number(position))) {
        throw new Error(`position ${position} does not exist in layout ${layout.name}`);
      }
    }
  }

  const socd = configuration.socd;
  if (!socd?.enabled) {
    throw new Error('matrix fixtures must enable socd');
  }

  for (const [direction, position] of Object.entries(socd.directionalKeys)) {
    if (!validPositions.has(position)) {
      throw new Error(`socd.directionalKeys.${direction} = ${position} does not exist in layout ${layout.name}`);
    }
  }

  const { up, down, left, right } = socd.directionalKeycodes;
  if (!SOCD_VERTICAL_PAIRS.some(([a, b]) => a === up && b === down)) {
    throw new Error(
      `${up} and ${down} are not an opposing vertical pair; expected one of ${SOCD_VERTICAL_PAIRS.map((p) => p.join('/')).join(', ')}`,
    );
  }
  if (!SOCD_HORIZONTAL_PAIRS.some(([a, b]) => a === left && b === right)) {
    throw new Error(
      `${left} and ${right} are not an opposing horizontal pair; expected one of ${SOCD_HORIZONTAL_PAIRS.map((p) => p.join('/')).join(', ')}`,
    );
  }

  const baseLayer = configuration.layers.find((l) => l.index === 0);
  for (const [direction, position] of Object.entries(socd.directionalKeys)) {
    const expected = socd.directionalKeycodes[direction as keyof typeof socd.directionalKeycodes];
    const binding = baseLayer?.bindings[String(position)];
    if (!binding || binding.kind !== 'keycode' || binding.keycode !== expected) {
      throw new Error(`socd.directionalKeys.${direction} must be bound to ${expected} on the base layer`);
    }
  }

  return configuration;
}

const NOW = new Date('2026-01-01T00:00:00.000Z').toISOString();

function socdFixture(keyboardId: string, policyId: string): MatrixFixture {
  const fixture = FIXTURES[keyboardId]!;
  return {
    keyboardId,
    // Real catalog layout name + policy discriminator — see file header. Resolved
    // back to the real layout name by run-matrix.ts before catalog lookup.
    layoutId: `${fixture.layoutId}::${policyId}`,
    label: `${keyboardId} / ${policyId}`,
    verifiedSocdKeyboards: VERIFIED_SOCD_KEYBOARDS,
    buildInput: (context) => {
      const bindings: Record<string, unknown> = {};
      fixture.baseKeys.forEach((keycode, i) => {
        if (i < context.layout.positions.length) bindings[String(i)] = { kind: 'keycode', keycode };
      });

      return {
        id: '22222222-2222-4222-8222-222222222223',
        ownerId: null,
        schemaVersion: 1,
        catalogVersion: context.catalog.catalogVersion,
        qmkCommit: context.catalog.qmkCommit,
        keyboardId,
        layoutId: fixture.layoutId,
        name: `SOCD matrix ${policyId}`,
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
        layers: [{ id: '33333333-3333-4333-8333-333333333335', index: 0, name: 'Base', bindings }],
        macros: [],
        socd: {
          enabled: true,
          policyId,
          directionalKeys: fixture.directionalKeys,
          directionalKeycodes: fixture.directionalKeycodes,
        },
        generatorVersion: GENERATOR_VERSION,
      };
    },
  };
}

/**
 * Every (fixture-table keyboard × published policy) combination — unchanged coverage
 * from `socd-compile-matrix.ts` (D-07's "pnpm socd:matrix remains a working named
 * entry point with unchanged behaviour").
 */
const SOCD_FIXTURES: readonly MatrixFixture[] = CANDIDATE_KEYBOARD_IDS.flatMap((keyboardId) =>
  SOCD_POLICIES.map((policy) => socdFixture(keyboardId, policy.id)),
);

export const SOCD_FIXTURE_SET: FixtureSet = {
  name: 'socd',
  fixtures: SOCD_FIXTURES,
  // No designated reproducibility entry in this set — D-10's reproducibility check
  // lives on the smoke set's crkbd/rev1 entry.
  requireReproducibilityEntry: false,
  enforceSocdGuard: true,
  validate: (input, catalog, layout) => validateForMatrix(input, catalog, layout),
};
