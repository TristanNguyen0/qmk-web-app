/**
 * The three-point boundary check behind D-04's module-hook API version assertion.
 *
 * Open Question 1 in 04-RESEARCH.md asks whether the registry's declared minimum
 * needs a genuinely numeric comparison, or whether presence-of-file is enough. A
 * presence check cannot distinguish "above the tree's highest" from "at or below
 * it" — only a real numeric, component-wise comparison can. This script proves the
 * comparison really is numeric by running `DockerSandbox.verify()` three times
 * against the real pinned tree and asserting each outcome:
 *
 *   - at the curated registry's declared minimum           -> pass
 *   - one patch step below the tree's highest hook version -> pass
 *   - one major step above the tree's highest hook version -> fail
 *
 * Usage: node --experimental-strip-types services/worker/scripts/verify-env-check.ts
 *
 * Needs a Docker daemon and the pinned checkout; not part of the fast `pnpm test`
 * inner loop (ADR-0001-testing: the boundary behaviour is only meaningful against
 * the real tree).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_REGISTRY } from '@qmk-web-app/domain';
import { DockerSandbox } from '@qmk-web-app/qmk-sandbox';
import { buildImageRef, loadManifest, qmkSourcePath } from '../../../infra/qmk/manifest.ts';

type Version = readonly [number, number, number];

/** Component-wise integer parse — never string comparison. */
function parseVersion(name: string): Version | null {
  const stem = name.endsWith('.hjson') ? name.slice(0, -'.hjson'.length) : name;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(stem);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function formatVersion(v: Version): string {
  return v.join('.');
}

const manifest = loadManifest();
const sourcePath = qmkSourcePath(manifest);
const hookDir = join(sourcePath, 'data', 'constants', 'module_hooks');

let entries: string[];
try {
  entries = readdirSync(hookDir);
} catch (error) {
  console.error(`could not read ${hookDir}: ${(error as Error).message}`);
  process.exit(1);
}

const versions = entries.map(parseVersion).filter((v): v is Version => v !== null);
if (versions.length === 0) {
  console.error(`no parseable module-hook API versions found in ${hookDir}`);
  process.exit(1);
}
const highest = versions.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max));

const declaredMinimum = MODULE_REGISTRY['qmkweb/socd_cleaner'].minimumHookApiVersion;
const onePatchBelowHighest: Version = [highest[0], highest[1], Math.max(0, highest[2] - 1)];
const oneMajorAboveHighest: Version = [highest[0] + 1, highest[1], highest[2]];

console.log(`QMK ${manifest.tag} @ ${manifest.commit}`);
console.log(`pinned tree's highest module hook API version: ${formatVersion(highest)}`);
console.log(`registry's declared minimum: ${declaredMinimum}\n`);

const cases: { label: string; minVersion: string; expectPass: boolean }[] = [
  { label: 'at the declared minimum', minVersion: declaredMinimum, expectPass: true },
  {
    label: "one patch step below the tree's highest",
    minVersion: formatVersion(onePatchBelowHighest),
    expectPass: true,
  },
  {
    label: "one major step above the tree's highest",
    minVersion: formatVersion(oneMajorAboveHighest),
    expectPass: false,
  },
];

let mismatches = 0;
for (const testCase of cases) {
  const sandbox = new DockerSandbox({
    imageRef: buildImageRef(manifest),
    qmkSourcePath: sourcePath,
    minModuleHookApiVersion: testCase.minVersion,
  });

  let passed: boolean;
  try {
    await sandbox.verify();
    passed = true;
  } catch {
    passed = false;
  }

  const outcome = passed ? 'pass' : 'fail';
  const expected = testCase.expectPass ? 'pass' : 'fail';
  const status = passed === testCase.expectPass ? 'ok' : 'MISMATCH';
  console.log(`  ${testCase.label} (min ${testCase.minVersion}): ${outcome} [expected ${expected}] — ${status}`);
  if (passed !== testCase.expectPass) mismatches += 1;
}

console.log('');
if (mismatches > 0) {
  console.error(`${mismatches} of ${cases.length} boundary check(s) did not match expectation.`);
  process.exit(1);
}
console.log(`All ${cases.length} boundary checks matched expectation — the comparison is genuinely numeric.`);
