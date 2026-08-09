/**
 * Administrative pipeline: fetch → extract → normalize → publish a catalog version.
 *
 * claude.md § Source management: "Refresh catalog data through an explicit
 * administrative pipeline: fetch, validate, parse, compare changes, publish a new
 * catalog version, then select it for builds."
 *
 * Usage:
 *   pnpm catalog:build [--keyboard <id>]... [--limit N] [--out <path>]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DockerSandbox } from '@qmk-web-app/qmk-sandbox';
import { summarizeCatalog } from '@qmk-web-app/domain';
import {
  extractCatalog,
  normalizeCatalog,
  parseExtractorDump,
  publishCatalog,
} from '../src/index.ts';
import { buildImageRef, loadManifest, qmkSourcePath, REPO_ROOT } from '../../../infra/qmk/manifest.ts';

function argValues(flag: string): string[] {
  const values: string[] = [];
  for (let i = 2; i < process.argv.length - 1; i += 1) {
    if (process.argv[i] === flag) values.push(process.argv[i + 1] as string);
  }
  return values;
}

const manifest = loadManifest();
const keyboards = argValues('--keyboard');
const limitArg = argValues('--limit')[0];
const outArg = argValues('--out')[0];

const sandbox = new DockerSandbox({
  imageRef: buildImageRef(manifest),
  qmkSourcePath: qmkSourcePath(manifest),
});

console.log(`Verifying build sandbox (${buildImageRef(manifest)})…`);
await sandbox.verify();

console.log(`Extracting catalog from QMK ${manifest.tag} (${manifest.commit})…`);
const dump = await extractCatalog({
  sandbox,
  expectedQmkCommit: manifest.commit,
  keyboards,
  ...(limitArg === undefined ? {} : { limit: Number(limitArg) }),
});

// Saving the raw dump lets `packages/qmk-fixtures` be regenerated from a real run,
// so normalizer tests exercise genuine QMK output rather than hand-written stand-ins.
const dumpArg = argValues('--dump')[0];
if (dumpArg) {
  const dumpPath = resolve(dumpArg);
  mkdirSync(dirname(dumpPath), { recursive: true });
  writeFileSync(dumpPath, dump, 'utf8');
  console.log(`  raw extractor dump written to ${dumpPath}`);
}

const catalog = normalizeCatalog(parseExtractorDump(dump), {
  catalogVersion: manifest.catalog.version,
  expectedQmkCommit: manifest.commit,
});

// Published form: a directory the API can serve without loading every keyboard.
const outDir = outArg ? resolve(outArg) : resolve(REPO_ROOT, 'catalogs', catalog.catalogVersion);
publishCatalog(catalog, outDir);

// The single-file form stays available for fixtures and offline analysis.
const singleFileArg = argValues('--single-file')[0];
if (singleFileArg) {
  const singleFilePath = resolve(singleFileArg);
  mkdirSync(dirname(singleFilePath), { recursive: true });
  writeFileSync(singleFilePath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`  single-file catalog written to ${singleFilePath}`);
}

const summary = summarizeCatalog(catalog);
console.log('\nCatalog published:');
console.log(`  version        ${summary.catalogVersion}`);
console.log(`  qmk commit     ${summary.qmkCommit}`);
console.log(`  keyboards      ${summary.totalKeyboards}`);
console.log(`  supported      ${summary.supportedKeyboards}`);
for (const [reason, count] of Object.entries(summary.unsupportedByReason).sort()) {
  console.log(`  unsupported    ${reason}: ${count}`);
}
console.log(`  written to     ${outDir}/`);
