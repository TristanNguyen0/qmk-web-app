---
phase: 04-verified-socd-support
plan: 03
subsystem: build-pipeline
tags: [socd, provenance, migration, build-queue, postgres, worker, reproducibility]

# Dependency graph
requires:
  - phase: 04-verified-socd-support
    provides: >-
      04-01 landed the SOCD module package (SOCD_MODULE_VERSION) and the compile
      path that materializes it. 04-02 introduced MODULE_REGISTRY and
      catalog-version-scoped socdCapabilitiesFor, which govern when a build's
      generation actually requires the module.
provides:
  - "builds.socd_module_version — an additive, idempotent column joining the
    existing reproducibility triple (catalog_version, qmk_commit,
    generator_version) so a firmware image traces to the exact SOCD
    implementation that produced it (D-03)"
  - "CompleteBuildArgs/BuildSummary/BuildRecord all carry socdModuleVersion,
    implemented identically by both queue stores and held to one shared
    contract in store-contract.test.ts"
  - "run-build.ts -> queue-runner.ts write path: a SOCD build records
    SOCD_MODULE_VERSION, a non-SOCD build and a failed build record null, and a
    lost lease records nothing (the artifact/completion transaction is
    unaffected by this plan)"
affects: [04-04-hook-api-assertion, 04-05-hardware-flash]

# Actuals (#2632)
actuals:
  tokens: 5050
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Provenance-with-build: a new reproducibility field is added as one more
      nullable column on `builds`, written only at the single completion write
      point (queue.complete), never in the insert — mirrors generator_version
      exactly"
    - "Domain BuildRecord fields that are 'known eventually, null until then'
      (outputFormat, logReference, failureCode) extended with the same shape
      for socdModuleVersion, rather than an optional field — an explicit null
      is a fact ('SOCD was not enabled'), never an omission"

key-files:
  created:
    - apps/api/migrations/004_socd_module_version.sql
  modified:
    - packages/build-queue/src/types.ts
    - packages/build-queue/src/postgres-store.ts
    - packages/build-queue/src/memory-store.ts
    - apps/api/src/builds/store-contract.test.ts
    - services/worker/src/run-build.ts
    - services/worker/src/run-build.test.ts
    - services/worker/src/queue-runner.ts
    - services/worker/src/queue-runner.test.ts
    - packages/domain/src/build.ts
    - apps/api/src/builds/service.ts
    - apps/api/src/routes/builds.test.ts

key-decisions:
  - "socdModuleVersion is a required string|null field on BuildRecord and
    CompleteBuildArgs, not optional — matching the existing
    outputFormat/logReference/failureCode pattern of 'always present, null
    until known' rather than allowing the field to be silently omitted."
  - "Extended packages/domain/src/build.ts's BuildRecord (outside the plan's
    declared files) because memory-store.ts's completion path assigns
    directly onto the domain record object, the same way it already assigns
    generatorVersion; there was no way to add socdModuleVersion to that
    assignment without the domain type carrying the field."

patterns-established:
  - "A worker result field (RunBuildResult.socdModuleVersion) threaded
    unchanged through the queue completion call, with the queue.fail() call
    and the lease-loss/orphan-artifact path deliberately untouched — the
    template a future curated-module provenance field should follow."

requirements-completed: [REQ-curated-module-registry, REQ-mvp-definition-of-done]

coverage:
  - id: D1
    description: >-
      Migration 004 adds a nullable socd_module_version column to builds,
      additive and idempotent (ADD COLUMN IF NOT EXISTS), with no grant,
      revocation, removal, or data-modifying statement — verified against a
      reachable Postgres instance via two consecutive runner invocations and
      an information_schema.columns check.
    requirement: REQ-mvp-definition-of-done
    verification:
      - kind: other
        ref: "two consecutive `runMigrations()` invocations against
          postgres://qwa@127.0.0.1:5433/qwa — second run applied zero new
          migrations; information_schema.columns reports exactly one
          socd_module_version column on builds"
        status: pass
      - kind: other
        ref: "grep -v '^--' apps/api/migrations/004_socd_module_version.sql |
          grep -cE '\\b(GRANT|REVOKE|DROP|DELETE|TRUNCATE)\\b' == 0"
        status: pass
    human_judgment: false
  - id: D2
    description: >-
      Both queue stores implement the extended completion contract
      identically: a recorded module version round-trips through
      builds.get() and summarize(), and a null value round-trips as null.
      Held to one shared contract test run against both the in-memory and
      Postgres implementations.
    requirement: REQ-curated-module-registry
    verification:
      - kind: integration
        ref: "apps/api/src/builds/store-contract.test.ts — 'records a SOCD
          module version and reports it on the summary' and 'records a null
          SOCD module version for a build that did not enable SOCD', each run
          against InMemoryBuildStore and PostgresBuildStore (62 tests total
          in this file, up from 58)"
        status: pass
    human_judgment: false
  - id: D3
    description: >-
      A SOCD build's firmware traces to the module version that produced it:
      run-build.ts sets socdModuleVersion from SOCD_MODULE_VERSION only when
      generation required the module, null on every failure path (including
      pre-compile GENERATION_FAILED); queue-runner.ts passes it into
      queue.complete unchanged and never into queue.fail; a lost lease
      records nothing.
    requirement: REQ-curated-module-registry
    verification:
      - kind: unit
        ref: "services/worker/src/run-build.test.ts — asserts the version for
          a SOCD build, null for a non-SOCD build, and null for a failed
          build (5 tests total in this file, up from 4)"
        status: pass
      - kind: integration
        ref: "services/worker/src/queue-runner.test.ts — 'records the SOCD
          module version the compile used, passed through unchanged' and the
          existing 'compiles a queued build' test extended to assert null for
          a non-SOCD build (19 tests total in this file, up from 18)"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-09-02
status: complete
---

# Phase 4 Plan 03: Record the SOCD Module Version on Every Build Summary

**Every succeeded build now names the SOCD module version that produced its firmware in a new
additive `builds.socd_module_version` column — null for a non-SOCD build, never a placeholder —
closing the last reproducibility gap D-03 identified.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-09-02T19:26:29Z
- **Completed:** 2026-09-02T19:36:18Z
- **Tasks:** 3
- **Files modified:** 12 (1 created, 11 modified)

## Accomplishments

- Added `apps/api/migrations/004_socd_module_version.sql`, an additive, idempotent migration that
  joins the existing reproducibility triple (`catalog_version`, `qmk_commit`, `generator_version`)
  with a nullable `socd_module_version` TEXT column, widening no privilege — verified against a
  live Postgres instance with two consecutive runner invocations (second was a no-op) and a
  single-column `information_schema.columns` check.
- Extended `CompleteBuildArgs`, `BuildRecord`, and `BuildSummary` with `socdModuleVersion: string |
  null`, and implemented it identically in `PostgresBuildStore` and `InMemoryBuildStore` — the
  column is written only at the completion UPDATE, never at insert, since a build is created before
  anything knows which module version will apply.
- Threaded the value end to end from generation to the persisted build: `run-build.ts` reads
  `SOCD_MODULE_VERSION` from `@qmk-web-app/qmk-socd-module` only when `generation.requiresSocdModule`
  is true, sets it null on every failure return, and `queue-runner.ts` passes
  `result.socdModuleVersion` into `queue.complete({...})` unchanged — never into `queue.fail({...})`,
  and never touching the lease-loss/orphaned-artifact path.
- Held both stores to one shared contract (`store-contract.test.ts`) with two new completion cases
  — a recorded version round-trips through the summary, a null value round-trips as null — and
  extended `run-build.test.ts` and `queue-runner.test.ts` with the SOCD-on, SOCD-off, and
  failed-build cases.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the socd_module_version column** - `6d023b9` (feat)
2. **Task 2: Extend the build completion contract and both queue stores** - `ddaf57f` (feat)
3. **Task 3: Thread the module version from generation to the build record** - `6982f2f` (feat)

## Files Created/Modified

- `apps/api/migrations/004_socd_module_version.sql` - additive `socd_module_version` column
- `packages/build-queue/src/types.ts` - `socdModuleVersion` on `CompleteBuildArgs`, `BuildSummary`
- `packages/build-queue/src/postgres-store.ts` - row type, mapper, completion UPDATE (not insert)
- `packages/build-queue/src/memory-store.ts` - completion assignment, `toSummary` mapping
- `apps/api/src/builds/store-contract.test.ts` - two new completion cases, plus
  `socdModuleVersion: null` added to the `buildRecord()` fixture and existing `complete()` calls
- `services/worker/src/run-build.ts` - `RunBuildResult.socdModuleVersion`, set from
  `SOCD_MODULE_VERSION` on the success/SOCD-required path, null everywhere else
- `services/worker/src/run-build.test.ts` - SOCD-on, SOCD-off, and failed-build assertions
- `services/worker/src/queue-runner.ts` - passes `result.socdModuleVersion` into `queue.complete`
- `services/worker/src/queue-runner.test.ts` - asserts the persisted build carries the value
  unchanged, for both a SOCD-enabled and a plain configuration
- `packages/domain/src/build.ts` - `BuildRecord.socdModuleVersion` (deviation, see below)
- `apps/api/src/builds/service.ts` - `prepareBuild()` initializes it to null (deviation)
- `apps/api/src/routes/builds.test.ts` - two pre-existing `complete()` calls updated (deviation)

## Decisions Made

- `socdModuleVersion` is a required `string | null` field everywhere it appears, not optional. This
  matches the codebase's established pattern for "known eventually, null until then" fields
  (`outputFormat`, `logReference`, `failureCode` are all required-but-nullable) rather than allowing
  silent omission — consistent with T-04-10's "a null value means SOCD was not enabled, never
  'unknown'."
- Chose to extend `packages/domain/src/build.ts`'s `BuildRecord` rather than inventing a
  store-local shadow field, because `InMemoryBuildStore.complete()` mutates the domain `BuildRecord`
  object directly (`build.generatorVersion = args.generatorVersion`, the exact pattern this plan's
  action text says to follow) — there was no way to add `socdModuleVersion` to that assignment
  without the domain type itself carrying the field.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended `packages/domain/src/build.ts`'s `BuildRecord` outside the declared file list**
- **Found during:** Task 2, implementing the memory-store completion path
- **Issue:** The plan's action text for Task 2 says to add `socdModuleVersion` "to the build record
  shape" and to assign it "on the same completion path that already assigns `generatorVersion`" in
  `memory-store.ts`. That path (`build.generatorVersion = args.generatorVersion`) mutates a domain
  `BuildRecord` object directly. `packages/domain/src/build.ts` was not in this plan's
  `files_modified` list, but without adding the field there, the assignment does not typecheck —
  `pnpm typecheck` fails with "Property 'socdModuleVersion' does not exist on type 'BuildRecord'".
- **Fix:** Added `socdModuleVersion: string | null` to `BuildRecord`, positioned after
  `generatorVersion` with a comment citing D-03 and the module package as the source, mirroring the
  established required-but-nullable pattern of `outputFormat`/`logReference`/`failureCode`.
- **Files modified:** `packages/domain/src/build.ts`
- **Verification:** `pnpm typecheck` passes monorepo-wide; `pnpm test` (390/390) passes.
- **Committed in:** `ddaf57f` (Task 2 commit)

**2. [Rule 3 - Blocking] `apps/api/src/builds/service.ts` needed to initialize the new required field**
- **Found during:** Task 2, same typecheck pass as above
- **Issue:** Once `BuildRecord.socdModuleVersion` became a required field, `prepareBuild()` — the
  one place a fresh `BuildRecord` is constructed at build creation — no longer satisfied the
  `BuildRecord` interface, breaking `pnpm typecheck`.
- **Fix:** Added `socdModuleVersion: null,` to the returned record, with a comment explaining it is
  unknown until the worker completes the build (D-03) — mirroring how `artifactId`, `outputFormat`,
  `logReference`, and `failureCode` are all initialized to `null` at creation in the same function.
- **Files modified:** `apps/api/src/builds/service.ts`
- **Verification:** `pnpm typecheck` passes; `apps/api/src/routes/builds.test.ts` (which exercises
  `prepareBuild` through the build-creation route) still passes.
- **Committed in:** `ddaf57f` (Task 2 commit)

**3. [Rule 3 - Blocking] `apps/api/src/routes/builds.test.ts`'s two pre-existing `complete()` calls needed the new required field**
- **Found during:** Task 2, `pnpm typecheck` (whole-monorepo)
- **Issue:** `CompleteBuildArgs.socdModuleVersion` is required, so the two `.complete({...})` calls
  in this test file's helper and in one inline test no longer typechecked. This file is not in the
  plan's declared `files_modified` list.
- **Fix:** Added `socdModuleVersion: null,` to both call sites — both are pre-existing tests
  unrelated to SOCD, so `null` is the correct, honest value.
- **Files modified:** `apps/api/src/routes/builds.test.ts`
- **Verification:** `pnpm test` — `apps/api/src/routes/builds.test.ts` (24/24) passes.
- **Committed in:** `ddaf57f` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3 - blocking). **Impact on plan:** All three were
mechanical, single-field additions required to keep `pnpm typecheck`/`pnpm test` green after making
`socdModuleVersion` a required field on `BuildRecord` and `CompleteBuildArgs` — the choice the plan's
own "mirror generatorVersion exactly" instruction and the codebase's established
required-but-nullable pattern both point to. No scope creep: no behavior outside D-03's provenance
requirement was touched.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The migration was applied and verified against
the local `infra/deploy/docker-compose.yml` Postgres instance already running on
`127.0.0.1:5433`; a fresh environment applies it automatically via `runMigrations()` at API startup.

## Next Phase Readiness

- `builds.socd_module_version` and the full write path (registry → `run-build.ts` →
  `queue-runner.ts` → both queue stores → `BuildSummary`) are in place for 04-04's hook-API-version
  assertion and 04-05's hardware flash, neither of which needs any further schema or contract
  change.
- The owner-facing build summary now exposes `socdModuleVersion` the same way it already exposes
  `generatorVersion`; no frontend consumer reads it yet (out of scope for this plan), so
  `apps/web/src/lib/client.ts`'s separate `BuildSummary` interface was deliberately left unchanged —
  a future UI plan can surface it without any backend change.

---
*Phase: 04-verified-socd-support*
*Completed: 2026-09-02*

## Self-Check: PASSED

- All key files verified present on disk: `apps/api/migrations/004_socd_module_version.sql` and
  every modified file listed above.
- All 3 commits verified present in `git log`: `6d023b9`, `ddaf57f`, `6982f2f`.
- Re-ran plan-level `<verification>`: `pnpm test` (390/390 pass), `pnpm typecheck` (exits 0,
  monorepo-wide including `apps/web`).
- Re-ran every task-level `<verify>` command independently; all pass.
- Confirmed via grep: `packages/build-queue/src/types.ts` has 3 `socdModuleVersion` occurrences;
  `packages/build-queue/src/postgres-store.ts` has 3 `socd_module_version` occurrences, 0 inside
  the insert statement; `services/worker/src/run-build.ts` has 6 `socdModuleVersion` occurrences;
  `services/worker/src/queue-runner.ts` has exactly 1, inside the completion call, 0 inside the
  failure call; `grep -v '^--' apps/api/migrations/004_socd_module_version.sql | grep -cE
  '\b(GRANT|REVOKE|DROP|DELETE|TRUNCATE)\b'` returns 0.
