/**
 * Thin wrapper over `run-matrix.ts`: runs only the curated smoke fixture set.
 *
 * claude.md § Phase 0: "Build a local reproducibility spike: one pinned keyboard/
 * layout, one generated base keymap, one isolated successful compile." The pipeline
 * itself — published catalog, validation, generation, isolated compile, artifact
 * identification and checksum, plus the D-10 reproducibility assertion on the
 * designated `crkbd/rev1` entry — lives once in `run-matrix.ts` and
 * `services/worker/src/matrix-fixtures.ts` (D-07).
 *
 * Usage: node --experimental-strip-types services/worker/scripts/smoke-build.ts <catalog.json>
 */
import { runMatrix } from './run-matrix.ts';
import { SMOKE_FIXTURE_SET } from './fixtures/smoke.ts';

const catalogPath = process.argv[2];
if (!catalogPath) {
  console.error('usage: smoke-build.ts <published-catalog-dir>');
  process.exit(64);
}

const ok = await runMatrix(catalogPath, [SMOKE_FIXTURE_SET]);
if (!ok) process.exit(1);
