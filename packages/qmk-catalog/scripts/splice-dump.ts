/**
 * Merges records from one raw extractor dump into another, replacing records of the
 * types it carries. Lets a normalizer change be republished from saved dumps plus one
 * small scoped extraction, instead of a whole-tree re-extraction. Operator tooling:
 * both inputs are dump files this pipeline wrote.
 *
 * Usage: node --experimental-strip-types splice-dump.ts <base.ndjson> <extra.ndjson> <out.ndjson>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseExtractorDump, type ExtractorKeyboardRecord } from '../src/index.ts';

const [, , basePath, extraPath, outPath] = process.argv;
if (!basePath || !extraPath || !outPath) {
  console.error('usage: splice-dump.ts <base.ndjson> <extra.ndjson> <out.ndjson>');
  process.exit(64);
}
const base = parseExtractorDump(readFileSync(basePath, 'utf8'));
const extra = parseExtractorDump(readFileSync(extraPath, 'utf8'));
const extraTypes = new Set(extra.map((r) => r.type));
const extraKeyboards = new Map(
  extra.filter((r): r is ExtractorKeyboardRecord => r.type === 'keyboard').map((r) => [r.keyboardId, r]),
);
// Non-keyboard record types (provenance, keycode_spec, docs, ...) are replaced by the
// extra dump wholesale. Keyboard records UNION by id: a scoped extraction emits only
// its requested keyboards, and the merged dump must keep the rest of the tree.
const merged = [
  ...base
    .filter((r) => !extraTypes.has(r.type) || r.type === 'keyboard')
    .map((r) => (r.type === 'keyboard' ? extraKeyboards.get(r.keyboardId) ?? r : r)),
  ...extra.filter((r) => r.type !== 'keyboard'),
];
writeFileSync(outPath, merged.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`base ${base.length} + extra ${extra.length} -> ${merged.length} records (${[...extraTypes].join(', ')} replaced; keyboards unioned by id)`);
