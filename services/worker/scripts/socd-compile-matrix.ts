/**
 * Thin wrapper over `run-matrix.ts`: runs only the SOCD fixture set — the evidence
 * behind `MODULE_REGISTRY`'s `verifiedFor` records.
 *
 * claude.md § SOCD Cleaner requirement 6: "Test each selectable policy with compile
 * fixtures", and phase 4: "Enable only tested policies/keyboards". The pipeline
 * itself, the registry-fixture guard, and the fixture table live once in
 * `run-matrix.ts`, `services/worker/src/matrix-fixtures.ts`, and
 * `services/worker/scripts/fixtures/socd.ts` (D-07) — this wrapper preserves the
 * named entry point `pnpm socd:matrix` with unchanged behaviour.
 *
 * Usage:
 *   node --experimental-strip-types services/worker/scripts/socd-compile-matrix.ts <published-catalog-dir>
 */
import { runMatrix } from './run-matrix.ts';
import { SOCD_FIXTURE_SET } from './fixtures/socd.ts';

const catalogPath = process.argv[2];
if (!catalogPath) {
  console.error('usage: socd-compile-matrix.ts <published-catalog-dir>');
  process.exit(64);
}

const ok = await runMatrix(catalogPath, [SOCD_FIXTURE_SET]);
if (!ok) process.exit(1);
