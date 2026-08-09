/**
 * Verifies that a saved configuration is generator-ready.
 *
 * Phase 2 must not enable compilation (claude.md § Phase 2: "Do not enable
 * compilation until generated output tests are in place"), but a configuration that
 * could not even be generated would be a silent dead end. This checks the Phase 2 →
 * Phase 3 handoff without building anything.
 *
 * Usage: node --experimental-strip-types apps/api/scripts/check-generates.ts <configId>
 */
import { resolve } from 'node:path';
import pg from 'pg';
import type { Configuration } from '@qmk-web-app/domain';
import { openPublishedCatalog } from '@qmk-web-app/qmk-catalog';
import { generateKeymap } from '@qmk-web-app/qmk-generator';
import { REPO_ROOT } from '../../../infra/qmk/manifest.ts';

const id = process.argv[2];
if (!id) {
  console.error('usage: check-generates.ts <configId>');
  process.exit(64);
}

const pool = new pg.Pool({
  connectionString:
    process.env['QWA_DATABASE_URL'] ?? 'postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa',
});

const result = await pool.query<{ document: Configuration; is_draft: boolean }>(
  'SELECT document, is_draft FROM configurations WHERE id = $1',
  [id],
);
const row = result.rows[0];
if (!row) {
  console.error(`no configuration ${id}`);
  process.exit(1);
}
if (row.is_draft) {
  console.error('configuration is a draft and would not be buildable');
  process.exit(1);
}

const configuration = row.document;
const published = openPublishedCatalog(resolve(REPO_ROOT, 'catalogs', configuration.catalogVersion));
const keyboard = published.getKeyboard(configuration.keyboardId);
if (!keyboard?.supported) {
  console.error(`keyboard ${configuration.keyboardId} is not supported`);
  process.exit(1);
}

const generated = generateKeymap({
  configuration,
  keyboard,
  buildId: 'aaaaaaaa-0000-4000-8000-00000000beef',
});

console.log(`Generated ${generated.files.length} file(s), ${generated.totalBytes} bytes`);
for (const file of generated.files) console.log(`  ${file.path}`);

const keymap = generated.files.find((f) => f.path.endsWith('keymap.json'))!;
const parsed = JSON.parse(keymap.contents) as Record<string, unknown>;
const layers = parsed['layers'] as string[][];
console.log(`  layers: ${layers.length}`);
console.log(`  layer 0 first 3: ${layers[0]!.slice(0, 3).join(', ')}`);
console.log(`  macros: ${JSON.stringify(parsed['macros'])}`);

await pool.end();
