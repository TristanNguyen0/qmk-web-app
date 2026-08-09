/**
 * Small pinned fixtures captured from a real extraction of the pinned QMK revision.
 *
 * These are NOT hand-written. They are regenerated with:
 *
 *   pnpm catalog:build --keyboard planck/rev6 --keyboard crkbd/rev1 \
 *     --out packages/qmk-fixtures/data/catalog-sample.json \
 *     --dump <tmp>/dump.ndjson
 *
 * Using genuine QMK output means the normalizer and generator tests fail when QMK's
 * metadata model changes, which is exactly the signal claude.md rule 2 wants.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

export const FIXTURE_QMK_COMMIT = '332fa30e173e5b0ecc0c70ff166974b6db86525e';
export const FIXTURE_CATALOG_VERSION = '0.33.13-1';

export function readExtractSampleNdjson(): string {
  return readFileSync(join(DATA_DIR, 'extract-sample.ndjson'), 'utf8');
}

export function readKeycodeSpec(): {
  type: 'keycode_spec';
  version: string;
  keycodes: Record<string, { key?: unknown; aliases?: unknown }>;
} {
  return JSON.parse(readFileSync(join(DATA_DIR, 'keycode-spec.json'), 'utf8'));
}

export function readCatalogSample(): unknown {
  return JSON.parse(readFileSync(join(DATA_DIR, 'catalog-sample.json'), 'utf8'));
}

/** Every `X_…` name defined in the pinned tree's send_string_keycodes.h. */
export function readSendStringNames(): Set<string> {
  const text = readFileSync(join(DATA_DIR, 'send-string-names.txt'), 'utf8');
  return new Set(text.split('\n').map((l) => l.trim()).filter((l) => l !== ''));
}
