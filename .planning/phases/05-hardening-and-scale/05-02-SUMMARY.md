---
phase: 05-hardening-and-scale
plan: 02
subsystem: testing
tags: [qmk, compile-matrix, docker, vitest, socd, reproducibility]

# Dependency graph
requires:
  - phase: 04-verified-socd-support
    provides: MODULE_REGISTRY.verifiedFor records and the registry-fixture guard this plan extracts and preserves
provides:
  - "services/worker/src/matrix-fixtures.ts: MatrixFixture contract, validateFixtureSet, missingSocdFixtures (the registry-fixture guard, pure and unit-tested), syntheticBaseLayer"
  - "services/worker/scripts/run-matrix.ts: the single shared curated compile-matrix pipeline (manifest, published catalog, validate, generate, DockerSandbox, assert firmware, optional double-build reproducibility)"
  - "services/worker/scripts/fixtures/smoke.ts and fixtures/socd.ts: data-only fixture sets consumed by the shared runner"
  - "root pnpm matrix entry point running both fixture sets against catalogs/0.33.13-1; pnpm socd:matrix preserved unchanged"
  - "docs/matrix-selection.md: written selection criteria (D-08), current membership with verified coverage arithmetic, and the compile-vs-hardware claim distinction (D-10)"
  - "a real, verified compile-matrix run: 8/8 fixtures compiled across 2 sets, one reproducibility assertion passing"
affects: [05-06-merge-gate, any-future-plan-adding-a-matrix-member-or-a-registry-verifiedFor-record]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
actuals:
  tokens: 16779
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One shared pipeline (run-matrix.ts) parameterized by a FixtureSet, with existing scripts (smoke-build.ts, socd-compile-matrix.ts) reduced to thin argv wrappers that preserve their exact original entry points and exit codes"
    - "Load-bearing guards extracted as pure, Docker-free, unit-tested functions (matrix-fixtures.ts) so weakening them fails pnpm test instead of surfacing only during a real compile run"
    - "Reproducibility assertion via a same-build-id double build (not different build ids), because generatedKeymapName(buildId) legitimately varies output by id — holding id constant isolates generator+image determinism from keymap-directory naming"

key-files:
  created:
    - services/worker/src/matrix-fixtures.ts
    - services/worker/src/matrix-fixtures.test.ts
    - services/worker/scripts/run-matrix.ts
    - services/worker/scripts/fixtures/smoke.ts
    - services/worker/scripts/fixtures/socd.ts
    - docs/matrix-selection.md
  modified:
    - services/worker/scripts/smoke-build.ts
    - services/worker/scripts/socd-compile-matrix.ts
    - package.json

key-decisions:
  - "D-10 reproducibility check changed from a report to a hard assertion, using a same-build-id double build rather than the original code's differing-id double build, because holding the id constant is what makes 'two builds produced different bytes' a genuine finding rather than an expected keymap-directory-name difference"
  - "Matrix membership: 4 members (crkbd/rev1 + 3 handwired/onekey/* toolchain probes), not the 5 the planner's discretion notes floated — Task 2's own concrete acceptance criteria locked this at exactly 4, and that is what got built, tested, and merged"
  - "Coverage arithmetic in docs/matrix-selection.md was computed fresh against catalogs/0.33.13-1/index.json rather than copied from the plan's own planner_notes figures, per the task's explicit instruction that 'the numbers come from the catalog, not from this plan' — the plan's informal '2,760/74%' estimate does not match the as-built 4-member set; the real figure is 2,670/3,743 (~71%)"
  - "Documented, rather than silently closed or silently ignored, a gap against the plan's own criterion 3 (at least two members with a real multi-position layout): only crkbd/rev1 qualifies today. Recorded in docs/matrix-selection.md and the WINDOWS.md ledger as an open deviation for a future deliberate addition, rather than expanding scope in Task 3 by picking and vetting a new keyboard unreviewed"
  - "Phase 4's blocking-human precondition on Task 1 (04-05-SUMMARY.md / hardware-verification gate) was explicitly waived by the human operator for this plan on the grounds that the compile matrix asserts no hardware claim; the waiver is recorded here rather than silently overridden"

patterns-established:
  - "A curated compile matrix is data (a FixtureSet of MatrixFixture entries) plus one shared pipeline — adding matrix coverage means adding a fixture entry and updating docs/matrix-selection.md, not touching the pipeline"

requirements-completed: []
# REQ-smoke-matrix intentionally NOT marked complete: gsd-tools requirements.ready-ids reports
# it blocked — a sibling plan in phase 05 also declares REQ-smoke-matrix and has not yet
# produced its SUMMARY. It will be marked complete automatically once that sibling finishes
# (shared-ID gate, #2388).

coverage:
  - id: D1
    description: "The registry-fixture guard (missingSocdFixtures) and the fixture-set contract (validateFixtureSet, MatrixFixture, syntheticBaseLayer) extracted as pure, Docker-free, unit-tested functions"
    requirement: "REQ-smoke-matrix"
    verification:
      - kind: unit
        ref: "services/worker/src/matrix-fixtures.test.ts (13 tests, including missingSocdFixtures against the real MODULE_REGISTRY and catalog version 0.33.13-1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "One shared runner (run-matrix.ts) parameterized by fixture set; smoke-build.ts and socd-compile-matrix.ts reduced to thin wrappers preserving their original entry points; pnpm socd:matrix and a new pnpm matrix script"
    requirement: "REQ-smoke-matrix"
    verification:
      - kind: unit
        ref: "pnpm typecheck && pnpm test — 29 files / 495 tests pass, including matrix-fixtures"
        status: pass
      - kind: other
        ref: "acceptance-criteria greps: openPublishedCatalog absent from smoke-build.ts and socd-compile-matrix.ts (0 matches each); fixtures/smoke.ts exports exactly 4 entries with exactly one assertDoubleReproducible; pnpm socd:matrix still present in root package.json scripts"
        status: pass
    human_judgment: false
  - id: D3
    description: "The curated matrix compiled for real in the isolated build image (8 fixtures across 2 sets, one reproducibility assertion), and docs/matrix-selection.md records the selection criteria, verified coverage arithmetic, discretion decisions, and the compile-vs-hardware claim distinction"
    requirement: "REQ-smoke-matrix"
    verification:
      - kind: integration
        ref: "pnpm matrix against catalogs/0.33.13-1 in the isolated qmk-build:0.33.13-1 image — exit 0, 8/8 fixtures produced an artifact with byte size and SHA-256, crkbd/rev1 reproducibility line reported two equal SHA-256 values"
        status: pass
      - kind: other
        ref: "pnpm socd:matrix catalogs/0.33.13-1 run standalone — exit 0, 4/4 SOCD fixtures compiled, confirming the named entry point still works"
        status: pass
    human_judgment: true
    rationale: "The plan's own <verify> block designates a <human-check> for this task: a human must read docs/matrix-selection.md and confirm the coverage arithmetic matches a fresh query of catalogs/0.33.13-1/index.json, and that no sentence could be read as a hardware-verification claim. I performed and recorded this check myself (2,670/3,743 verified by direct computation; explicit compile-vs-hardware sentence present), but the plan designates it a human-check, so it is not auto-passed here."

duration: Tasks 1-2 ~9 min (first session, 2026-09-03 11:20-11:29 local); Task 3 ~1h across this continuation session (bulk of it is real Docker compile time — 8 fixtures at 15-29s each, twice run once via `pnpm matrix` and once via standalone `pnpm socd:matrix`)
completed: 2026-09-03
status: complete
---

# Phase 5 Plan 2: Curated QMK compile matrix — one runner, two fixture sets, run for real Summary

**One shared `run-matrix.ts` pipeline replaces two duplicated compile scripts; the registry-fixture guard is now a unit-tested pure function; the curated matrix compiled for real (8/8 fixtures, one asserted-reproducible build) against the pinned QMK image, with written selection criteria in `docs/matrix-selection.md`.**

## Performance

- **Duration:** Executed across two sessions — Tasks 1-2 in an earlier session (~9 min, interrupted by an account rate limit immediately after Task 2), Task 3 in this continuation session. Task 3's wall time is dominated by real Docker compiles (8 fixtures × 15-29s, run twice — once via `pnpm matrix`, once via standalone `pnpm socd:matrix` to confirm the entry point).
- **Started:** 2026-09-03T11:20:00-04:00 (Task 1 commit)
- **Completed:** 2026-09-03T14:30:29-04:00 (Task 3 commit)
- **Tasks:** 3/3
- **Files modified:** 9 (6 created, 3 modified — see `key-files`)

## Accomplishments

- Extracted the fixture contract (`MatrixFixture`), `validateFixtureSet`, `missingSocdFixtures` (the registry-fixture guard, moved from `socd-compile-matrix.ts:163-175` without behavioral change), and `syntheticBaseLayer` into `services/worker/src/matrix-fixtures.ts`, with 13 fast unit tests requiring no Docker daemon.
- Built one shared pipeline, `services/worker/scripts/run-matrix.ts`: manifest, published catalog, per-set validation, one shared verified `DockerSandbox`, failure accumulation across all fixtures (never stops on first failure), a non-zero exit on any failure or on zero fixtures compiled, and the D-10 reproducibility check implemented as a same-build-id double build with a hard SHA-256 equality assertion (not a report).
- Reduced `smoke-build.ts` and `socd-compile-matrix.ts` to thin argv wrappers over the shared runner; both preserve their original usage messages, exit code 64 on a missing argument, and (for `socd-compile-matrix.ts`) the exact `pnpm socd:matrix` entry point. Added a new root `pnpm matrix` script running both fixture sets together.
- Ran the curated matrix for real against `catalogs/0.33.13-1` in the pinned `qmk-web-app/qmk-build:0.33.13-1` image: **8/8 fixtures compiled**, `crkbd/rev1`'s two same-build-id builds produced byte-identical SHA-256 artifacts, and `MODULE_REGISTRY.verifiedFor` is unchanged (confirmed via `git diff`).
- Wrote `docs/matrix-selection.md`: the six membership criteria, current 4-member table with `(processor, bootloader)` pairs and shared-keyboard counts verified against a fresh `catalogs/0.33.13-1/index.json` read (2,670 of 3,743 supported keyboards, ~71%; 3 MCU families; 4 bootloaders), the two recorded discretion decisions (catalog build stays out of CI; no quarantine mechanism), an explicit compile-vs-hardware claim distinction, and an honest note on the one criterion (layout-shape diversity) the current 4-member set does not yet satisfy.
- Closes the `REQ-smoke-matrix` Wave 0 gap for a Docker-free guard unit test — `services/worker/src/matrix-fixtures.test.ts` is that test, and it runs on every `pnpm test`.

## Task Commits

Each task was committed atomically. Tasks 1-2 were committed in the interrupted first session and merged to `main` before this continuation began; Task 3 was committed in this continuation session.

1. **Task 1: Extract the fixture contract and the registry guard as testable pure functions** - `92b3f94` (feat, tdd)
2. **Task 2: One runner, two fixture sets, both existing scripts thinned to wrappers** - `def2f82` (feat)
3. **Task 3: Run the curated matrix for real and write down why each member is in it** - `6f7dd0a` (docs)

**Plan metadata:** committed alongside this SUMMARY (worktree mode — STATE.md/ROADMAP.md updated centrally by the orchestrator after merge, per instruction).

## Files Created/Modified

- `services/worker/src/matrix-fixtures.ts` - `MatrixFixture` contract, `validateFixtureSet`, `missingSocdFixtures` (registry-fixture guard), `syntheticBaseLayer`
- `services/worker/src/matrix-fixtures.test.ts` - 13 fast unit tests, no Docker required
- `services/worker/scripts/run-matrix.ts` - the single shared curated compile-matrix pipeline
- `services/worker/scripts/fixtures/smoke.ts` - curated smoke fixture set (crkbd/rev1 + 3 `handwired/onekey/*`)
- `services/worker/scripts/fixtures/socd.ts` - SOCD fixture table + `validateForMatrix`, moved from `socd-compile-matrix.ts`
- `services/worker/scripts/smoke-build.ts` - thinned to an argv wrapper over `run-matrix.ts`
- `services/worker/scripts/socd-compile-matrix.ts` - thinned to an argv wrapper over `run-matrix.ts`
- `package.json` - added root `matrix` script; `socd:matrix` unchanged
- `docs/matrix-selection.md` - written selection criteria, current membership, coverage arithmetic, discretion decisions, compile-vs-hardware distinction

## Decisions Made

See `key-decisions` in frontmatter. In prose:

- D-10's reproducibility check is now a hard assertion on a same-build-id double build (the original code only *reported* a same-build differing-id comparison and explicitly declined to assert). This is a deliberate behavior change the plan called for, not a preservation of existing behavior.
- Matrix membership is 4, not the 5 floated in the plan's informal `<planner_notes>` — Task 2's own concrete `<action>`/`<acceptance_criteria>` (already executed, tested, and merged before this continuation began) is the authoritative spec, and it specifies exactly 4 entries.
- `docs/matrix-selection.md`'s coverage arithmetic is computed fresh against the catalog rather than copied from the plan text, per the task's own instruction to verify rather than transcribe.
- Phase 4's `blocking-human` precondition on Task 1 was explicitly waived by the human operator for this plan (compile verification does not depend on hardware verification); the waiver is recorded, and no sentence in this plan's output claims hardware verification for Phase 4, the M256WH board, or any SOCD policy.

## Deviations from Plan

### Auto-fixed Issues

None — no Rule 1/2/3 auto-fixes were needed in Task 3. Tasks 1-2 (prior session) are reported clean by their own commits; this SUMMARY does not re-litigate work already merged.

### Documented (not auto-fixed) gap

**1. [Documentation gap, recorded not silently closed] Criterion 3 (layout-shape diversity) unmet by current matrix membership**
- **Found during:** Task 3, while writing `docs/matrix-selection.md`
- **Issue:** The plan's own six selection criteria require "at least two members carry a real multi-position layout of distinct physical shape." The as-built 4-member smoke set (locked by Task 2's already-merged acceptance criteria) has only one: `crkbd/rev1`. The three `handwired/onekey/*` members are QMK's single-key `LAYOUT_ortho_1x1` probe board, satisfying toolchain/bootloader diversity (criterion 4) but not layout diversity.
- **Why not fixed in this task:** Adding a genuine second multi-position-layout member requires selecting and vetting a new real keyboard against `catalogs/0.33.13-1/index.json` (`supported: true`, distinct physical shape, a real key table) — a decision beyond Task 3's stated job of running the existing matrix for real and documenting why each *existing* member is in it. Task 3's own text frames member changes narrowly, around a member that fails to compile, not around expanding coverage to satisfy an unmet breadth criterion. Silently adding an unreviewed keyboard risked exactly the kind of un-vetted metadata claim `claude.md` rule 2 forbids.
- **Resolution:** Documented explicitly in `docs/matrix-selection.md` under "Known gap against criterion 3" and recorded as an open entry in `.planning/WINDOWS.md` (kind: deviation) so it stays visible through `/gsd-ship`'s gate rather than disappearing once this SUMMARY scrolls out of context.
- **Files modified:** `docs/matrix-selection.md`, `.planning/WINDOWS.md`
- **Verification:** N/A (documentation-only; not a code defect)
- **Committed in:** `6f7dd0a`

---

**Total deviations:** 1 documented gap, 0 auto-fixed.
**Impact on plan:** No code correctness or security impact. The matrix still satisfies its hard requirements (non-vacuous, one asserted reproducibility check, registry guard intact, ≥3 MCU families and ≥3 bootloaders). The gap is a breadth-of-coverage shortfall against one of six documented aspirational criteria, now tracked rather than hidden.

## Issues Encountered

- **Continuation across a rate limit.** The first executor session completed Tasks 1-2 and was killed by an account rate limit before Task 3. Its work was already merged to `main` and present in this worktree's base commit; this continuation verified both prior commits existed (`git log --oneline | grep 05-02` showed `92b3f94` and `def2f82`) and their outputs matched the plan before proceeding — no rework, no revert.
- **QMK source and catalog not present in this worktree.** `qmkSourcePath(loadManifest())` resolves under `.cache/qmk/<commit>`, and the published catalog lives under `catalogs/0.33.13-1/` — neither existed in this fresh worktree (both are gitignored, generated artifacts). Per the explicit precondition waiver in this continuation's instructions, recreated `.cache` and `catalogs` as symlinks to the main checkout's copies to reuse the existing pinned QMK checkout and published catalog (no re-fetch, no re-generation, no mutation of either). Both symlinks were removed before finishing this task, leaving the worktree clean.
- **Phase 4 hardware-verification precondition.** Task 1's `<precondition>` (`.planning/phases/04-verified-socd-support/04-05-SUMMARY.md exists`) is genuinely unmet in this repository state and was explicitly waived by the human operator for this plan, on the documented grounds that compile-matrix verification does not depend on or assert hardware verification. No claim of hardware verification appears anywhere in this plan's output (code, comments, `docs/matrix-selection.md`, or this SUMMARY).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `pnpm matrix` is a working, real, Docker-verified entry point ready for `05-06` to wire in as a merge gate.
- `REQ-smoke-matrix` is fully implemented by this plan's work but intentionally left unmarked in `REQUIREMENTS.md` — `gsd-tools requirements.ready-ids` reports it blocked by a sibling plan in this phase that also declares it and has not yet produced a SUMMARY. It will flip to complete automatically once that sibling finishes (shared-ID gate, #2388) — no manual follow-up needed.
- One open item tracked in `.planning/WINDOWS.md`: the criterion-3 layout-diversity gap in the curated smoke matrix, available for a future deliberate addition reviewed against `docs/matrix-selection.md`'s six criteria.

---
*Phase: 05-hardening-and-scale*
*Completed: 2026-09-03*
