#!/usr/bin/env node --experimental-strip-types
/**
 * The single shared curated compile-matrix pipeline: manifest, published catalog,
 * validate, generate, `DockerSandbox`, assert firmware, optional double-build
 * reproducibility check (D-07).
 *
 * `services/worker/scripts/smoke-build.ts` and
 * `services/worker/scripts/socd-compile-matrix.ts` are thin wrappers over
 * `runFixtureSet` below, each supplying their own fixture set. Run directly, this
 * file is `pnpm matrix`: it loads the published catalog and one shared, verified
 * sandbox, then runs every known fixture set against it in turn.
 *
 * Usage:
 *   node --experimental-strip-types services/worker/scripts/run-matrix.ts <published-catalog-dir>
 */
import { resolve } from 'node:path';
import type {
  Catalog,
  CatalogLayout,
  Configuration,
  SupportedCatalogKeyboard,
} from '@qmk-web-app/domain';
import { openPublishedCatalog, type PublishedCatalog } from '@qmk-web-app/qmk-catalog';
import { GENERATOR_VERSION } from '@qmk-web-app/qmk-generator';
import { DockerSandbox } from '@qmk-web-app/qmk-sandbox';
import { runBuild } from '../src/index.ts';
import {
  buildImageRef,
  loadManifest,
  publishedCatalogPath,
  qmkSourcePath,
  type QmkManifest,
} from '../../../infra/qmk/manifest.ts';
import {
  missingSocdFixtures,
  validateFixtureSet,
  type MatrixFixture,
  type MatrixFixtureContext,
} from '../src/matrix-fixtures.ts';

/** A named group of fixtures plus the structural validation that applies to all of them. */
export interface FixtureSet {
  /** Used in output only. */
  name: string;
  fixtures: readonly MatrixFixture[];
  /** D-10: whether this set must designate exactly one reproducibility entry. */
  requireReproducibilityEntry: boolean;
  /**
   * True only for the SOCD set: runs `missingSocdFixtures` against the registry
   * before compiling anything in this set, exiting the set with a failure if any
   * registry-verified keyboard has no fixture (D-07, T-05-05).
   */
  enforceSocdGuard: boolean;
  /**
   * Structural validation for this set's fixtures — the smoke set uses the public
   * `validateConfiguration`; the SOCD set uses its own `validateForMatrix`, moved
   * from `socd-compile-matrix.ts` into `fixtures/socd.ts` with its explanatory
   * comment intact.
   */
  validate: (input: unknown, catalog: Catalog, layout: CatalogLayout) => Configuration;
}

export interface RunFixtureSetResult {
  compiledCount: number;
  failures: readonly string[];
}

/**
 * Deterministic, distinct build ids for each fixture in a set, so two different sets
 * (or two different fixtures) never collide, while a double-build reproducibility
 * check can reuse the exact same id for its second build.
 */
function fixtureBuildId(setName: string, index: number): string {
  const hash = [...`${setName}:${index}`].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0);
  const suffix = hash.toString(16).padStart(8, '0');
  return `aaaaaaaa-0000-4000-8000-0000${suffix}`;
}

/**
 * Runs one fixture set against a shared, already-verified sandbox. Fixtures execute
 * in declaration order, one container at a time, and every fixture runs even when an
 * earlier one fails — failures are accumulated and reported together at the end, so
 * one broken toolchain never hides three others and the verdict never depends on
 * ordering.
 */
export async function runFixtureSet(
  set: FixtureSet,
  context: { manifest: QmkManifest; published: PublishedCatalog; sandbox: DockerSandbox },
): Promise<RunFixtureSetResult> {
  const fixtures = validateFixtureSet(set.fixtures, {
    requireReproducibilityEntry: set.requireReproducibilityEntry,
  });

  const catalogVersion = context.published.index.catalogVersion;
  const qmkCommit = context.published.index.qmkCommit;

  if (set.enforceSocdGuard) {
    const missing = missingSocdFixtures(
      catalogVersion,
      fixtures.map((f) => f.keyboardId),
    );
    if (missing.length > 0) {
      const message = `these keyboards claim SOCD verification but have no compile fixture: ${missing.join(', ')}`;
      console.error(`[${set.name}] ${message}`);
      return { compiledCount: 0, failures: [message] };
    }
  }

  const failures: string[] = [];
  let compiledCount = 0;

  for (const [index, fixture] of fixtures.entries()) {
    const label = `[${set.name}] ${fixture.label}`;
    const entry = context.published.getKeyboard(fixture.keyboardId);
    if (!entry?.supported) {
      failures.push(`${label}: ${fixture.keyboardId} not supported in this catalog`);
      continue;
    }
    const keyboard = entry as SupportedCatalogKeyboard;
    // A fixture's layoutId is its dedup key (validateFixtureSet rejects duplicate
    // (keyboardId, layoutId) pairs), so a set that legitimately builds one real
    // layout more than once — the SOCD set, once per policy — discriminates with a
    // `::<suffix>` the real catalog layout name never contains. Strip it before
    // resolving the catalog layout; the resolved layout is always the real,
    // unmodified one (never invented, claude.md rule 2).
    const realLayoutId = fixture.layoutId.split('::')[0]!;
    const layout = keyboard.layouts.find((l) => l.name === realLayoutId);
    if (!layout) {
      failures.push(`${label}: layout ${realLayoutId} not found on ${fixture.keyboardId}`);
      continue;
    }

    const catalog = {
      catalogVersion,
      qmkCommit,
      extractorVersion: context.published.index.extractorVersion,
      normalizerVersion: context.published.index.normalizerVersion,
      generatedAt: context.published.index.generatedAt,
      keycodeSpecVersion: context.published.index.keycodeSpecVersion,
      keyboards: [keyboard],
    } satisfies Catalog;

    const fixtureContext: MatrixFixtureContext = {
      catalog,
      keyboard,
      layout,
      generatorVersion: GENERATOR_VERSION,
    };

    let configuration: Configuration;
    try {
      const input = fixture.buildInput(fixtureContext);
      configuration = set.validate(input, catalog, layout);
    } catch (error) {
      failures.push(`${label}: ${(error as Error).message}`);
      continue;
    }

    const buildId = fixtureBuildId(set.name, index);
    const runOnce = async () => {
      process.stdout.write(`${label}… `);
      const result = await runBuild({
        buildId,
        configuration,
        keyboard,
        sandbox: context.sandbox,
        redactPaths: [qmkSourcePath(context.manifest)],
        ...(fixture.verifiedSocdKeyboards ? { verifiedSocdKeyboards: fixture.verifiedSocdKeyboards } : {}),
      });
      if (result.status !== 'succeeded') {
        console.log(`FAILED (${result.failureCode})`);
        console.log(result.log.slice(-2500));
      } else {
        console.log(
          `ok — .${result.artifact.extension}, ${result.artifact.byteSize} bytes, ` +
            `sha256 ${result.artifact.sha256.slice(0, 16)}…, ${(result.durationMs / 1000).toFixed(1)}s`,
        );
      }
      return result;
    };

    const first = await runOnce();
    if (first.status !== 'succeeded') {
      failures.push(`${label}: ${first.failureCode}`);
      continue;
    }
    compiledCount += 1;

    if (fixture.assertDoubleReproducible) {
      // Same build id on purpose (planner_notes): generatedKeymapName(buildId)
      // derives the keymap directory name from the build id, so two different
      // build ids legitimately produce two different firmware images. Holding the
      // id constant is what isolates "does the generator + pinned image reproduce
      // deterministically" from "did the keymap directory name change" — and
      // runBuild allocates a fresh mkdtemp workspace per call, so re-using an id
      // is safe.
      const second = await runOnce();
      if (second.status !== 'succeeded') {
        failures.push(`${label} (reproducibility build 2): ${second.failureCode}`);
        continue;
      }
      if (first.artifact.sha256 !== second.artifact.sha256) {
        const message =
          `${label}: reproducibility check FAILED — two same-build-id builds produced ` +
          `different firmware (${first.artifact.sha256} vs ${second.artifact.sha256})`;
        console.error(message);
        failures.push(message);
        continue;
      }
      console.log(`${label}: reproducibility OK — both builds sha256 ${first.artifact.sha256.slice(0, 16)}…`);
    }
  }

  return { compiledCount, failures };
}

/**
 * Runs one or more fixture sets against one shared, already-verified sandbox, and
 * reports a combined pass/fail. A run that compiles zero fixtures across every set is
 * never reported as a pass, even if no individual fixture "failed" — an empty or
 * vacuous run must be distinguishable from a run that actually compiled everything.
 */
export async function runMatrix(catalogPath: string, sets: readonly FixtureSet[]): Promise<boolean> {
  const manifest = loadManifest();
  const published = openPublishedCatalog(resolve(catalogPath));

  const sandbox = new DockerSandbox({
    imageRef: buildImageRef(manifest),
    qmkSourcePath: qmkSourcePath(manifest),
  });
  await sandbox.verify();

  console.log(`QMK ${manifest.tag} @ ${manifest.commit}`);
  console.log(`catalog ${published.index.catalogVersion}\n`);

  let totalCompiled = 0;
  const allFailures: string[] = [];

  for (const set of sets) {
    const result = await runFixtureSet(set, { manifest, published, sandbox });
    totalCompiled += result.compiledCount;
    allFailures.push(...result.failures);
  }

  console.log('');
  if (allFailures.length > 0) {
    console.error(`matrix FAILED:\n  ${allFailures.join('\n  ')}`);
    return false;
  }
  if (totalCompiled === 0) {
    console.error('matrix FAILED: zero fixtures were compiled — a vacuous run is never a pass');
    return false;
  }
  console.log(`matrix passed: ${totalCompiled} fixture(s) compiled across ${sets.length} set(s).`);
  return true;
}

// When run directly (not imported by a wrapper), this is `pnpm matrix`: run every
// known fixture set against one shared sandbox.
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  // Defaults to the catalog the manifest names, which `QMK_CATALOG_PATH` can point
  // outside the workspace; an explicit argument still wins for one-off runs.
  const catalogPath = process.argv[2] ?? publishedCatalogPath();
  const [{ SMOKE_FIXTURE_SET }, { SOCD_FIXTURE_SET }] = await Promise.all([
    import('./fixtures/smoke.ts'),
    import('./fixtures/socd.ts'),
  ]);
  const ok = await runMatrix(catalogPath, [SMOKE_FIXTURE_SET, SOCD_FIXTURE_SET]);
  if (!ok) process.exit(1);
}
