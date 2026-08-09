/**
 * The SOCD compile matrix: the evidence behind `SOCD_VERIFIED_KEYBOARDS`.
 *
 * claude.md § SOCD Cleaner requirement 6: "Test each selectable policy with compile
 * fixtures", and phase 4: "Enable only tested policies/keyboards". A keyboard may be
 * catalogued, and may even compile a plain keymap, and still fail once the SOCD
 * community module is added — the module is extra flash and an extra translation unit.
 * So "SOCD works here" is a claim this script has to earn, per keyboard, per policy.
 *
 * It compiles every (verified keyboard × published policy) combination for real, in the
 * isolated build image, and fails if any of them does not produce firmware. Nothing may
 * be added to SOCD_VERIFIED_KEYBOARDS until it passes here.
 *
 * Usage:
 *   node --experimental-strip-types services/worker/scripts/socd-compile-matrix.ts <published-catalog-dir>
 */
import { resolve } from 'node:path';
import {
  SOCD_POLICIES,
  SOCD_VERIFIED_KEYBOARDS,
  validateConfiguration,
  type Catalog,
  type SupportedCatalogKeyboard,
} from '@qmk-web-app/domain';
import { openPublishedCatalog } from '@qmk-web-app/qmk-catalog';
import { GENERATOR_VERSION } from '@qmk-web-app/qmk-generator';
import { DockerSandbox } from '@qmk-web-app/qmk-sandbox';
import { SOCD_MODULE_VERSION } from '@qmk-web-app/qmk-socd-module';
import { runBuild } from '../src/index.ts';
import { buildImageRef, loadManifest, qmkSourcePath } from '../../../infra/qmk/manifest.ts';

const catalogPath = process.argv[2];
if (!catalogPath) {
  console.error('usage: socd-compile-matrix.ts <published-catalog-dir>');
  process.exit(64);
}

const manifest = loadManifest();
const published = openPublishedCatalog(resolve(catalogPath));

/**
 * Where each keyboard's four directional keys live, and which layout to build.
 *
 * Positions are layout-specific facts, so they are stated per keyboard rather than
 * guessed. Adding a keyboard to SOCD_VERIFIED_KEYBOARDS means adding it here too — and
 * this script fails loudly if the two lists disagree, so a keyboard cannot be marked
 * verified without a fixture that actually exercises it.
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
};

const missingFixtures = [...SOCD_VERIFIED_KEYBOARDS].filter((id) => !FIXTURES[id]);
if (missingFixtures.length > 0) {
  console.error(
    `these keyboards claim SOCD verification but have no compile fixture: ${missingFixtures.join(', ')}`,
  );
  process.exit(1);
}

const sandbox = new DockerSandbox({
  imageRef: buildImageRef(manifest),
  qmkSourcePath: qmkSourcePath(manifest),
});
await sandbox.verify();

console.log(`QMK ${manifest.tag} @ ${manifest.commit}`);
console.log(`SOCD module ${SOCD_MODULE_VERSION}, generator ${GENERATOR_VERSION}`);
console.log(`catalog ${published.index.catalogVersion}\n`);

let buildCounter = 0;
const failures: string[] = [];

for (const keyboardId of SOCD_VERIFIED_KEYBOARDS) {
  const fixture = FIXTURES[keyboardId]!;
  const entry = published.getKeyboard(keyboardId);
  if (!entry?.supported) {
    failures.push(`${keyboardId}: not supported in this catalog`);
    continue;
  }

  const catalog = {
    catalogVersion: published.index.catalogVersion,
    qmkCommit: published.index.qmkCommit,
    extractorVersion: published.index.extractorVersion,
    normalizerVersion: published.index.normalizerVersion,
    generatedAt: published.index.generatedAt,
    keycodeSpecVersion: published.index.keycodeSpecVersion,
    keyboards: [entry as SupportedCatalogKeyboard],
  } satisfies Catalog;

  const layout = (entry as SupportedCatalogKeyboard).layouts.find(
    (l) => l.name === fixture.layoutId,
  );
  if (!layout) {
    failures.push(`${keyboardId}: layout ${fixture.layoutId} not found`);
    continue;
  }

  const bindings: Record<string, unknown> = {};
  fixture.baseKeys.forEach((keycode, i) => {
    if (i < layout.positions.length) bindings[String(i)] = { kind: 'keycode', keycode };
  });

  for (const policy of SOCD_POLICIES) {
    const label = `${keyboardId} / ${policy.id}`;
    const now = new Date('2026-01-01T00:00:00.000Z').toISOString();
    buildCounter += 1;
    const buildId = `aaaaaaaa-0000-4000-8000-${String(buildCounter).padStart(12, '0')}`;

    const input = {
      id: '22222222-2222-4222-8222-222222222222',
      ownerId: null,
      schemaVersion: 1,
      catalogVersion: catalog.catalogVersion,
      qmkCommit: catalog.qmkCommit,
      keyboardId,
      layoutId: fixture.layoutId,
      name: `SOCD matrix ${policy.id}`,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      layers: [
        { id: '33333333-3333-4333-8333-333333333331', index: 0, name: 'Base', bindings },
      ],
      macros: [],
      socd: {
        enabled: true,
        policyId: policy.id,
        directionalKeys: fixture.directionalKeys,
        directionalKeycodes: fixture.directionalKeycodes,
      },
      generatorVersion: GENERATOR_VERSION,
    };

    process.stdout.write(`${label}… `);
    const { configuration, keyboard } = validateConfiguration(input, { catalog });
    const result = await runBuild({
      buildId,
      configuration,
      keyboard,
      sandbox,
      redactPaths: [qmkSourcePath(manifest)],
    });

    if (result.status !== 'succeeded') {
      console.log(`FAILED (${result.failureCode})`);
      console.log(result.log.slice(-2500));
      failures.push(`${label}: ${result.failureCode}`);
      continue;
    }
    console.log(
      `ok — ${result.artifact.byteSize} bytes, sha256 ${result.artifact.sha256.slice(0, 16)}…, ${(result.durationMs / 1000).toFixed(1)}s`,
    );
  }
}

console.log('');
if (failures.length > 0) {
  console.error(`SOCD compile matrix FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `SOCD compile matrix passed: ${buildCounter} builds across ${SOCD_VERIFIED_KEYBOARDS.size} keyboard(s) and ${SOCD_POLICIES.length} policies.`,
);
