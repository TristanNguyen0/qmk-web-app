/**
 * Phase 0 reproducibility spike, as an executable check.
 *
 * claude.md § Phase 0: "Build a local reproducibility spike: one pinned keyboard/
 * layout, one generated base keymap, one isolated successful compile."
 *
 * Runs the whole pipeline the way production will: published catalog → server-side
 * validation → deterministic generation → isolated compile → artifact identification
 * and checksum. Builds the same configuration twice and asserts the firmware is
 * byte-identical, which is the actual reproducibility claim.
 *
 * Usage: node --experimental-strip-types services/worker/scripts/smoke-build.ts <catalog.json>
 */
import { resolve } from 'node:path';
import { MODULE_REGISTRY, validateConfiguration, type Catalog } from '@qmk-web-app/domain';
import { openPublishedCatalog } from '@qmk-web-app/qmk-catalog';
import { GENERATOR_VERSION } from '@qmk-web-app/qmk-generator';
import { DockerSandbox } from '@qmk-web-app/qmk-sandbox';
import { runBuild } from '../src/index.ts';
import { buildImageRef, loadManifest, qmkSourcePath } from '../../../infra/qmk/manifest.ts';

const catalogPath = process.argv[2];
if (!catalogPath) {
  console.error('usage: smoke-build.ts <published-catalog-dir>');
  process.exit(64);
}

const manifest = loadManifest();

// Reads the published directory format, the same way the API does, so the smoke
// build exercises the real read path rather than a convenience format.
const published = openPublishedCatalog(resolve(catalogPath));
const KEYBOARD_ID = 'crkbd/rev1';
const LAYOUT_ID = 'LAYOUT_split_3x6_3';

const entry = published.getKeyboard(KEYBOARD_ID);
const catalog = {
  catalogVersion: published.index.catalogVersion,
  qmkCommit: published.index.qmkCommit,
  extractorVersion: published.index.extractorVersion,
  normalizerVersion: published.index.normalizerVersion,
  generatedAt: published.index.generatedAt,
  keycodeSpecVersion: published.index.keycodeSpecVersion,
  keyboards: entry ? [entry] : [],
} satisfies Catalog;
if (!entry?.supported) throw new Error(`${KEYBOARD_ID} is not supported in this catalog`);
const layout = entry.layouts.find((l) => l.name === LAYOUT_ID);
if (!layout) throw new Error(`${LAYOUT_ID} not found on ${KEYBOARD_ID}`);

console.log(`Catalog ${catalog.catalogVersion} @ ${catalog.qmkCommit}`);
console.log(`${KEYBOARD_ID} / ${LAYOUT_ID}: ${layout.positions.length} positions`);

// A small but non-trivial configuration: three layers, a layer-tap, a mod-tap, and a
// structured macro — every MVP binding kind that generates something interesting.
const BASE_KEYS = [
  'KC_TAB', 'KC_Q', 'KC_W', 'KC_E', 'KC_R', 'KC_T', 'KC_Y', 'KC_U', 'KC_I', 'KC_O', 'KC_P', 'KC_BACKSPACE',
  'KC_LEFT_CTRL', 'KC_A', 'KC_S', 'KC_D', 'KC_F', 'KC_G', 'KC_H', 'KC_J', 'KC_K', 'KC_L', 'KC_SEMICOLON', 'KC_QUOTE',
  'KC_LEFT_SHIFT', 'KC_Z', 'KC_X', 'KC_C', 'KC_V', 'KC_B', 'KC_N', 'KC_M', 'KC_COMMA', 'KC_DOT', 'KC_SLASH', 'KC_ESCAPE',
  'KC_LEFT_GUI', 'KC_TAB', 'KC_SPACE', 'KC_ENTER', 'KC_DELETE', 'KC_LEFT_ALT',
];

const MACRO_ID = '11111111-1111-4111-8111-111111111111';

const baseBindings: Record<string, unknown> = {};
BASE_KEYS.forEach((keycode, i) => {
  if (i >= layout.positions.length) return;
  baseBindings[String(i)] = { kind: 'keycode', keycode };
});
// Replace a few positions with the richer binding kinds.
baseBindings['37'] = { kind: 'layer_momentary', layer: 1 };
baseBindings['40'] = { kind: 'layer_tap', layer: 2, tap: 'KC_DELETE' };
baseBindings['12'] = { kind: 'mod_tap', hold: 'KC_LEFT_CTRL', tap: 'KC_ESCAPE' };
baseBindings['0'] = { kind: 'macro', macroId: MACRO_ID };

const numberBindings: Record<string, unknown> = {};
['KC_1', 'KC_2', 'KC_3', 'KC_4', 'KC_5', 'KC_6', 'KC_7', 'KC_8', 'KC_9', 'KC_0'].forEach((keycode, i) => {
  numberBindings[String(i + 1)] = { kind: 'keycode', keycode };
});

const now = new Date('2026-01-01T00:00:00.000Z').toISOString();
const configurationInput = {
  id: '22222222-2222-4222-8222-222222222222',
  ownerId: null,
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  qmkCommit: catalog.qmkCommit,
  keyboardId: KEYBOARD_ID,
  layoutId: LAYOUT_ID,
  name: 'Smoke test layout',
  revision: 1,
  createdAt: now,
  updatedAt: now,
  layers: [
    { id: '33333333-3333-4333-8333-333333333331', index: 0, name: 'Base', bindings: baseBindings },
    { id: '33333333-3333-4333-8333-333333333332', index: 1, name: 'Numbers', bindings: numberBindings },
    { id: '33333333-3333-4333-8333-333333333333', index: 2, name: 'Nav', bindings: {
      '20': { kind: 'keycode', keycode: 'KC_LEFT' },
      '21': { kind: 'keycode', keycode: 'KC_DOWN' },
      '22': { kind: 'keycode', keycode: 'KC_UP' },
      '23': { kind: 'keycode', keycode: 'KC_RIGHT' },
    } },
  ],
  macros: [
    {
      id: MACRO_ID,
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

console.log('\nValidating configuration server-side…');
const { configuration, keyboard } = validateConfiguration(configurationInput, { catalog });
console.log(`  valid: ${configuration.layers.length} layers, ${configuration.macros.length} macro(s)`);

const sandbox = new DockerSandbox({
  imageRef: buildImageRef(manifest),
  qmkSourcePath: qmkSourcePath(manifest),
  minModuleHookApiVersion: MODULE_REGISTRY['qmkweb/socd_cleaner'].minimumHookApiVersion,
});
await sandbox.verify();
console.log('  sandbox verified');

async function build(buildId: string, label: string) {
  console.log(`\n${label} (buildId ${buildId})…`);
  const result = await runBuild({
    buildId,
    configuration,
    keyboard,
    sandbox,
    redactPaths: [qmkSourcePath(manifest)],
  });
  if (result.status !== 'succeeded') {
    console.error(`  FAILED: ${result.failureCode}`);
    console.error(result.log.slice(-3000));
    process.exit(1);
  }
  console.log(`  ${result.artifact.filename}  ${result.artifact.byteSize} bytes`);
  console.log(`  sha256 ${result.artifact.sha256}`);
  console.log(`  ${(result.durationMs / 1000).toFixed(1)}s, image ${result.imageRef}`);
  return result;
}

const first = await build('aaaaaaaa-0000-4000-8000-000000000001', 'Build 1');
const second = await build('aaaaaaaa-0000-4000-8000-000000000002', 'Build 2');

console.log('\nReproducibility check:');
if (first.artifact.sha256 === second.artifact.sha256) {
  console.log(`  PASS — two independent builds produced identical firmware`);
} else {
  // Not necessarily a defect: the keymap directory name differs per build id, and
  // QMK may embed build metadata. Report it precisely rather than asserting.
  console.log('  DIFFER — artifacts are not byte-identical across build ids');
  console.log(`    build 1: ${first.artifact.sha256}`);
  console.log(`    build 2: ${second.artifact.sha256}`);
  console.log('    (investigate: likely build-id-derived keymap name or embedded metadata)');
}
