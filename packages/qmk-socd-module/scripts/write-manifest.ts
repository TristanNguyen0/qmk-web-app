/**
 * Rewrites the pinned SOCD module digests in `src/index.ts`.
 *
 * Run this only when the module's C source has legitimately changed and has been
 * reviewed. The digests exist so that an unreviewed edit fails the build rather than
 * being compiled into someone's firmware; regenerating them without reading the diff
 * defeats the point entirely.
 *
 *   pnpm socd:manifest
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOCD_MODULE_FILES, readSocdModuleFiles } from '../src/index.ts';

const indexPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts');

const digests = new Map(readSocdModuleFiles().map((f) => [f.name, f.sha256]));

const block = [...SOCD_MODULE_FILES]
  .sort()
  .map((name) => `  '${name}': '${digests.get(name)}',`)
  .join('\n');

const source = readFileSync(indexPath, 'utf8');
const replaced = source.replace(
  /(export const SOCD_MODULE_DIGESTS: Readonly<Record<string, string>> = Object\.freeze\(\{\n)[\s\S]*?(\n\}\);)/,
  `$1${block}$2`,
);

if (replaced === source) {
  console.error('could not locate the SOCD_MODULE_DIGESTS block in src/index.ts');
  process.exit(1);
}

writeFileSync(indexPath, replaced);
for (const [name, digest] of [...digests].sort()) {
  console.log(`${digest}  ${name}`);
}
