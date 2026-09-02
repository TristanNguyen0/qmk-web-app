---
phase: 04-verified-socd-support
plan: 04
subsystem: build-pipeline
tags: [socd, module-registry, hook-api, compile-matrix, arm, stm32, docker-sandbox]

# Dependency graph
requires:
  - phase: 04-verified-socd-support
    provides: >-
      04-02 introduced MODULE_REGISTRY as the single source of curated-module truth,
      with minimumHookApiVersion and a catalog-version-scoped verifiedFor list. 04-03
      threaded SOCD_MODULE_VERSION provenance through the build record. This plan
      reads MODULE_REGISTRY['qmkweb/socd_cleaner'].minimumHookApiVersion at worker
      startup and adds mode/m256wh's first verifiedFor record.
provides:
  - "A new module_hook_api_version_ok key in the existing verify-env checks
    dictionary, plus DockerSandboxOptions.minModuleHookApiVersion and the pure
    buildVerifyEnvArgs/assertValidModuleHookApiVersion helpers — the worker now
    refuses to start against a pinned tree whose module hook API is below the
    registry's declared minimum (D-04)."
  - "mode/m256wh (ARM/STM32) as the second compile fixture in
    socd-compile-matrix.ts, with the build loop restructured to iterate the
    fixture table's own candidates rather than the registry's verified set."
  - "A real 4-build matrix run (2 keyboards x 2 policies) in the isolated build
    image, and mode/m256wh's first verifiedFor record in MODULE_REGISTRY,
    compile-only strength, earned by that run (D-06, D-10)."
  - "services/worker/scripts/verify-env-check.ts / pnpm env:verify — the real
    three-point boundary proof (pass at minimum, pass one patch below the tree's
    highest, fail one major above it) that the module-hook comparison is
    genuinely numeric, not presence-of-file."
affects: [04-05-hardware-flash]

# Actuals (#2632)
actuals:
  tokens: 9800
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Startup assertion extended by adding one key to an existing checks
      dictionary rather than a parallel mechanism — the module-hook API version
      check flows through the same DockerSandbox.verify() / verify-env ok-gate
      ADR 0003 already established for the userspace-mechanism check."
    - "Parameterised security check instead of a bypass flag: generateKeymap's
      SOCD registry gate takes an optional caller-supplied allowlist
      (verifiedSocdKeyboards), defaulting to the real registry-derived set for
      every production/worker path. Only the compile matrix — an operator-run,
      non-user-reachable tool per this plan's own threat model — supplies its
      own fixture-table candidate set, so a keyboard can be compiled before it
      earns a verifiedFor record without weakening the check for any
      user-reachable path."

key-files:
  created:
    - packages/qmk-sandbox/src/docker-sandbox.test.ts
    - services/worker/scripts/verify-env-check.ts
    - .planning/phases/04-verified-socd-support/deferred-items.md
  modified:
    - infra/qmk/scripts/container-entrypoint.sh
    - packages/qmk-sandbox/src/docker-sandbox.ts
    - packages/qmk-sandbox/src/index.ts
    - services/worker/src/main.ts
    - services/worker/scripts/smoke-build.ts
    - services/worker/scripts/socd-compile-matrix.ts
    - packages/domain/src/module-registry.ts
    - packages/domain/src/module-registry.test.ts
    - packages/qmk-generator/src/generate.ts
    - services/worker/src/run-build.ts
    - package.json

key-decisions:
  - "The docker image (qmk-web-app/qmk-build:0.33.13-1) had to be rebuilt after
    editing container-entrypoint.sh — the entrypoint is baked into the image at
    build time, not read from the host checkout at run time. Without the
    rebuild, pnpm env:verify's third boundary case silently passed when it
    should have failed, because the running container was still executing the
    pre-change entrypoint with no module_hook_api_version_ok key at all."
  - "generateKeymap's SOCD registry gate is parameterised
    (GenerateOptions.verifiedSocdKeyboards), not bypassed, so the compile
    matrix can build mode/m256wh before its verifiedFor record exists (breaking
    the D-06 chicken-and-egg) while every worker/API build path keeps the
    real registry-derived default unchanged."
  - "socd-compile-matrix.ts's own configuration assembly no longer calls the
    public validateConfiguration() (which independently gates on the same
    registry) — a local validateForMatrix() keeps every other structural
    guarantee (schema shape, layout/position validity, opposing-pair matching,
    base-layer binding agreement) while not re-deriving the capability gate
    itself."

patterns-established:
  - "Three-point boundary proof for a numeric comparison: pass at the declared
    minimum, pass one patch step below the tree's highest, fail one major step
    above it — proves the comparison is genuinely component-wise numeric, which
    a presence-of-file check could not distinguish from the first two cases."

requirements-completed: [REQ-curated-module-registry, REQ-socd-policy-choices]

coverage:
  - id: D1
    description: >-
      The worker's build sandbox asserts the pinned tree's community-module hook
      API version against the curated registry's declared minimum through the
      existing verify-env checks dictionary, with the boundary behaviour proven
      at, below, and above the minimum against the real pinned tree.
    requirement: REQ-curated-module-registry
    verification:
      - kind: unit
        ref: "packages/qmk-sandbox/src/docker-sandbox.test.ts (16 tests: flag
          present/absent, malformed-version rejection, construction-time
          validation)"
        status: pass
      - kind: integration
        ref: "pnpm env:verify (services/worker/scripts/verify-env-check.ts) — three
          real DockerSandbox.verify() runs against the pinned tree: pass at 1.0.0
          (declared minimum), pass at 1.1.1 (one patch below the tree's highest
          1.1.2), fail at 2.1.2 (one major above it)"
        status: pass
    human_judgment: false
  - id: D2
    description: >-
      mode/m256wh (ARM/STM32) is a compile fixture in socd-compile-matrix.ts with
      a 67-position base-key array parsed from the published catalog (never
      invented) and the W/A/S/D pair at the verified indices; the build loop
      iterates the fixture table's own candidates so a keyboard can be compiled
      before it is registry-verified, with the reverse guard (registry-verified
      implies fixture-present) still enforced.
    requirement: REQ-socd-policy-choices
    verification:
      - kind: other
        ref: "grep assertions from Task 2's acceptance criteria: mode/m256wh
          fixture present, layoutId LAYOUT_65_ansi_blocker, 67-element baseKeys
          array, directional indices up17/left31/down32/right33 with W/A/S/D
          tokens, module-registry.ts unchanged by this task"
        status: pass
      - kind: integration
        ref: "pnpm socd:matrix catalogs/0.33.13-1 — see D3, the real run this
          fixture enables"
        status: pass
    human_judgment: false
  - id: D3
    description: >-
      A real 4-build matrix run (crkbd/rev1 and mode/m256wh x neutral and
      last_input_priority) passed in the isolated build image — the first
      ARM/STM32 compile this project has performed — and mode/m256wh entered
      MODULE_REGISTRY's verifiedFor list at compile-only strength, earned by
      that run. No record anywhere carries a hardware strength yet (D-09).
    requirement: REQ-curated-module-registry
    verification:
      - kind: integration
        ref: "pnpm socd:matrix catalogs/0.33.13-1 — 4/4 builds succeeded twice
          (before and after the registry edit), byte-identical artifacts across
          both runs: crkbd/rev1 .hex 59491 bytes both policies; mode/m256wh .bin
          64696 bytes both policies. Assumption A1 (8 MiB artifact cap) and A2
          (expectedTargetName's STM32 filename derivation) both held — no
          ARTIFACT_NOT_PRODUCED / ARTIFACT_REJECTED surfaced."
        status: pass
      - kind: unit
        ref: "packages/domain/src/module-registry.test.ts (14 tests, including
          two rewritten for this plan): both crkbd/rev1 and mode/m256wh recorded,
          both compile-only, no compile+hardware record anywhere"
        status: pass
    human_judgment: false

# Metrics
duration: 16min
completed: 2026-09-02
status: complete
---

# Phase 4 Plan 04: Module Hook API Assertion and mode/m256wh Compile Verification Summary

**The worker now refuses to start against a pinned tree whose community-module hook API is below the curated registry's declared minimum, and `mode/m256wh` (ARM/STM32) is compile-verified by a real 4-build matrix run — the project's first non-AVR compile.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-09-02T15:43:00-04:00
- **Completed:** 2026-09-02T15:59:00-04:00
- **Tasks:** 3
- **Files modified:** 14 (3 created, 11 modified)

## Accomplishments

- Added `module_hook_api_version_ok` to the verify-env verb's existing checks dictionary
  (`infra/qmk/scripts/container-entrypoint.sh`), comparing the pinned tree's highest
  `data/constants/module_hooks/` version against an optional `--min-module-hook-api`
  argument, component-wise as integers — never string comparison. Added
  `DockerSandboxOptions.minModuleHookApiVersion` and the pure
  `buildVerifyEnvArgs`/`assertValidModuleHookApiVersion` helpers in `docker-sandbox.ts`,
  shape-validating the version string before it can reach the docker argument vector.
  The worker and `smoke-build.ts` now construct their sandboxes with the minimum taken
  from `MODULE_REGISTRY['qmkweb/socd_cleaner'].minimumHookApiVersion`.
- Added `services/worker/scripts/verify-env-check.ts` (root script `env:verify`), which
  runs three real `DockerSandbox.verify()` calls against the pinned tree and proves the
  comparison is genuinely numeric: pass at the declared minimum (1.0.0), pass one patch
  step below the tree's highest (1.1.1), fail one major step above it (2.1.2).
- Added a `mode/m256wh` compile fixture to `socd-compile-matrix.ts` — a 67-position
  base-key array parsed directly from `catalogs/0.33.13-1/keyboards/0009.json` (never
  invented), `LAYOUT_65_ansi_blocker`, and the verified W/A/S/D directional indices
  (up 17, left 31, down 32, right 33). Restructured the build loop to iterate the
  fixture table's own candidates rather than the registry's verified set, breaking the
  chicken-and-egg where a keyboard could never be compiled before it was verified.
- Ran `pnpm socd:matrix catalogs/0.33.13-1` for real: 4 builds, 2 keyboards x 2
  policies, all succeeded — the project's first ARM/STM32 compile. Added `mode/m256wh`'s
  first `verifiedFor` record to `MODULE_REGISTRY`, compile-only strength; `crkbd/rev1`
  stays compile-only too, so both AVR and ARM/STM32 toolchains are represented with no
  hardware claim anywhere (D-09, D-10).

## Task Commits

Each task was committed atomically:

1. **Task 1: Assert the module hook API version at sandbox startup** - `60f42e8` (feat)
2. **Task 2: Add the mode/m256wh compile fixture and let the matrix drive candidates** - `8bb945c` (feat)
3. **Task 3: Run the matrix for real and record the earned claim** - `ff966bf` (feat)

## Files Created/Modified

- `infra/qmk/scripts/container-entrypoint.sh` - new `module_hook_api_version_ok` checks-dict key, `--min-module-hook-api` argument, `moduleHookApi` observability field
- `packages/qmk-sandbox/src/docker-sandbox.ts` - `minModuleHookApiVersion` option, `buildVerifyEnvArgs`/`assertValidModuleHookApiVersion` helpers
- `packages/qmk-sandbox/src/docker-sandbox.test.ts` - argument-builder and construction-time validation tests (new)
- `packages/qmk-sandbox/src/index.ts` - exports the two new helpers
- `services/worker/src/main.ts` - constructs the sandbox with the registry's declared minimum
- `services/worker/scripts/smoke-build.ts` - same, second caller
- `services/worker/scripts/verify-env-check.ts` - the real three-point boundary check, root script `env:verify` (new)
- `services/worker/scripts/socd-compile-matrix.ts` - `mode/m256wh` fixture; candidate-driven loop; local `validateForMatrix()`; artifact extension in the success line; `verifiedSocdKeyboards` passed to `runBuild`
- `packages/domain/src/module-registry.ts` - `mode/m256wh` verifiedFor record, compile-only strength
- `packages/domain/src/module-registry.test.ts` - rewritten `verifiedFor` assertions for both keyboards
- `packages/qmk-generator/src/generate.ts` - `GenerateOptions.verifiedSocdKeyboards` (defaults to the registry-derived set)
- `services/worker/src/run-build.ts` - forwards `verifiedSocdKeyboards` to `generateKeymap` unchanged
- `package.json` - new `env:verify` script
- `.planning/phases/04-verified-socd-support/deferred-items.md` - logged an out-of-scope flaky test (new)

## Decisions Made

- Rebuilt the `qmk-web-app/qmk-build:0.33.13-1` Docker image after editing
  `container-entrypoint.sh`. The entrypoint is copied into the image at build time
  (`infra/qmk/Dockerfile`); a running container does not see host-checkout edits to it.
  Discovered when the third boundary case in `pnpm env:verify` (one major step above the
  tree's highest) unexpectedly passed instead of failing — the container was still
  running the pre-change entrypoint with no `module_hook_api_version_ok` key at all.
- `generateKeymap`'s SOCD registry gate is parameterised
  (`GenerateOptions.verifiedSocdKeyboards`), not bypassed. Every worker/API build path
  keeps the real `socdVerifiedKeyboards(catalogVersion)` default; only
  `socd-compile-matrix.ts` supplies its own fixture-table candidate set, so a keyboard
  can be compiled before it earns a `verifiedFor` record without weakening the check for
  any user-reachable path.
- `socd-compile-matrix.ts` stopped calling the public `validateConfiguration()` (which
  independently gates on the same registry) and instead uses a local
  `validateForMatrix()` that keeps every other structural guarantee — schema shape via
  the same exported `parseConfiguration`, layout/position validity, opposing-pair
  matching, base-layer binding agreement — while not re-deriving the capability check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Docker image rebuild required for the entrypoint change to take effect**
- **Found during:** Task 1, first `pnpm env:verify` run
- **Issue:** The verify-env checks dictionary edit lives in `infra/qmk/scripts/container-entrypoint.sh` on the host filesystem, but the running build image was built before this plan's edit and still executed the old entrypoint — silently reporting no `module_hook_api_version_ok` key and always exiting 0, so the third boundary case (one major step above the tree's highest) unexpectedly passed.
- **Fix:** Ran `docker build -t qmk-web-app/qmk-build:0.33.13-1 infra/qmk` to rebuild the image from the edited entrypoint. Also simplified `module_hook_api_version_ok`'s assignment to a single expression (from two branches) once the acceptance criterion's literal `grep -c` count was checked against the actual file.
- **Files modified:** none beyond the image itself (Docker state, not a repo file) and a cosmetic simplification already in `container-entrypoint.sh`
- **Verification:** `pnpm env:verify` — all three boundary cases match expectation after the rebuild
- **Committed in:** `60f42e8` (Task 1 commit)

**2. [Rule 3 - Blocking] `generateKeymap`'s independent SOCD registry gate blocked the candidate-driven matrix loop**
- **Found during:** Task 3, first real `pnpm socd:matrix catalogs/0.33.13-1` run
- **Issue:** Task 2's loop change (iterate the fixture table's candidates) and its `validateForMatrix()` bypass of the public `validateConfiguration()` were not sufficient: `packages/qmk-generator/src/generate.ts` carries its own defence-in-depth SOCD check (added in plan 04-02, independent of `validateConfiguration`'s), so `mode/m256wh`'s first real run failed both policies with `GENERATION_FAILED` ("SOCD is not compile-verified for mode/m256wh on catalog version 0.33.13-1") — the exact chicken-and-egg Task 2's own action text names, just one layer deeper than the plan traced.
- **Fix:** Parameterised the check instead of weakening it: added an optional `GenerateOptions.verifiedSocdKeyboards` (default: the real registry-derived set, used unchanged by every production/worker build path) so `socd-compile-matrix.ts` — the one caller this plan's own threat model treats as trusted, operator-run tooling (T-04-18) — can supply its own fixture-table candidate set as the allowlist the check runs against. The check itself is never skipped, only its source list is parameterised, and only for this one script. Threaded unchanged through `RunBuildOptions.verifiedSocdKeyboards` in `services/worker/src/run-build.ts`.
- **Files modified:** `packages/qmk-generator/src/generate.ts`, `services/worker/src/run-build.ts` (both outside this task's declared file list)
- **Verification:** `pnpm socd:matrix catalogs/0.33.13-1` — 4/4 builds succeeded; `pnpm test` (406/406) confirms the existing "refuses SOCD for a keyboard that has not been compile-verified" test in `generate.test.ts` still passes unchanged (the default path is untouched)
- **Committed in:** `ff966bf` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking). **Impact on plan:** Both were necessary to make the plan's own stated goal ("a candidate keyboard can be compiled before it is recorded as verified") actually true against the current codebase — the second one touched two files outside this plan's declared list, but the fix keeps every user-reachable/production path's behaviour byte-for-byte unchanged (verified via the existing `generate.test.ts` case that specifically covers the unverified-keyboard refusal). No scope creep beyond what completing the stated tasks required.

## Issues Encountered

- **Pre-existing flaky test, out of scope:** `apps/api/src/routes/builds.test.ts` > "lists a configuration's builds newest first" failed intermittently (~1/3 of `pnpm test` runs observed) with a timestamp-tie race unrelated to this plan's changes — last touched by plan 04-03, not by anything in this plan. Logged to `.planning/phases/04-verified-socd-support/deferred-items.md`; not fixed here (scope boundary).

## User Setup Required

None - no external service configuration required. The Docker image rebuild
(`docker build -t qmk-web-app/qmk-build:0.33.13-1 infra/qmk`) was performed as part of
Task 1's verification and needs no further action; it will happen automatically for any
environment that builds the image fresh from the now-updated `infra/qmk/` sources.

## Next Phase Readiness

- `MODULE_REGISTRY['qmkweb/socd_cleaner'].verifiedFor` now has both `crkbd/rev1` (AVR)
  and `mode/m256wh` (ARM/STM32) at compile-only strength, on catalog version `0.33.13-1`
  — exactly the state plan 05's hardware-flash upgrade needs to find before it upgrades
  `mode/m256wh`'s record to `compile+hardware` after a passing hardware run.
- The worker's startup assertion (`minModuleHookApiVersion`) is in place and passing
  against the pinned tree, so plan 05 does not need to touch sandbox startup at all.
- No record anywhere carries a hardware strength yet (D-09) — every keyboard remains
  reported per its actual, earned verification strength until plan 05's hardware run
  passes.

---
*Phase: 04-verified-socd-support*
*Completed: 2026-09-02*

## Self-Check: PASSED

- All key files verified present on disk: `packages/qmk-sandbox/src/docker-sandbox.test.ts`,
  `services/worker/scripts/verify-env-check.ts`, `.planning/phases/04-verified-socd-support/deferred-items.md`,
  and every modified file listed above.
- All 3 commits verified present in `git log`: `60f42e8`, `8bb945c`, `ff966bf`.
- Re-ran plan-level `<verification>`: `pnpm env:verify` (3/3 boundary cases match),
  `pnpm socd:matrix catalogs/0.33.13-1` (4/4 builds, twice, byte-identical artifacts),
  `pnpm test` (406/406, after retrying past the pre-existing flake), `pnpm typecheck`
  (exits 0, monorepo-wide including `apps/web`).
- Confirmed via grep: `module_hook_api_version_ok` appears exactly once in
  `container-entrypoint.sh`; `min-module-hook-api` appears in both
  `container-entrypoint.sh` and `docker-sandbox.ts`; `minModuleHookApiVersion` appears
  exactly once in `main.ts`, sourced from `MODULE_REGISTRY`; `docker-sandbox.ts` has zero
  `@qmk-web-app/domain` imports; the `mode/m256wh` fixture's `baseKeys` array has exactly
  67 elements; `module-registry.ts` records both keyboards at `'compile'` strength with
  no `'compile+hardware'` record anywhere.
