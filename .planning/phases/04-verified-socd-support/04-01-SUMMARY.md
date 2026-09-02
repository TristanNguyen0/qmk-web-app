---
phase: 04-verified-socd-support
plan: 01
subsystem: build-pipeline
tags: [qmk, socd, community-module, merge, adr, docker, compile-matrix]

# Dependency graph
requires:
  - phase: 03-generation-and-server-builds
    provides: deterministic keymap generation, isolated build worker, artifact storage, build API
provides:
  - Landed SOCD module package, domain policy/pair/keycode tables, prerequisite-driven capability
    gate, generator's module emission, compile matrix, SOCD panel, and ADR 0005 on main
  - Honest README claim distinguishing compile-verified from hardware-verified for Phase 4
  - Hardware-evidence record skeleton (04-VERIFICATION.md) ready to receive results
affects: [04-02-module-registry, 04-03-compile-verify-mode-m256wh, 04-04-hook-api-assertion, 04-05-hardware-flash]

# Actuals (#2632)
actuals:
  tokens: 75892
  tasks: 3
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Policy-in-keycode SOCD configuration: the generator emits no C for SOCD, only a `modules`
      array entry plus keycode token substitution at the four directional positions"
    - "Deterministic merge-conflict resolution by branch-diff path list, not by reading hunks"
    - "Digest-pinned first-party community module materialization (SHA-256 verified before write)"

key-files:
  created:
    - .planning/phases/04-verified-socd-support/04-VERIFICATION.md
    - packages/qmk-socd-module/module/qmkweb/socd_cleaner/socd_cleaner.c
    - packages/qmk-socd-module/module/qmkweb/socd_cleaner/socd_resolve.h
    - packages/qmk-socd-module/module/qmkweb/socd_cleaner/qmk_module.json
    - packages/qmk-socd-module/src/index.ts
    - packages/qmk-socd-module/test/socd_resolve_test.c
    - packages/domain/src/socd.ts
    - services/worker/scripts/socd-compile-matrix.ts
    - apps/web/src/components/SocdPanel.tsx
    - docs/adr/0005-socd-is-a-first-party-community-module.md
  modified:
    - README.md
    - .gitignore
    - packages/domain/src/validate.ts
    - packages/domain/src/configuration.ts
    - packages/domain/src/index.ts
    - apps/api/src/routes/catalog.ts
    - apps/web/src/components/KeymapEditor.tsx
    - apps/web/src/lib/client.ts
    - apps/web/src/lib/editor-state.ts
    - apps/web/src/app/globals.css
    - packages/qmk-generator/src/generate.ts
    - services/worker/src/run-build.ts
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "Also gitignored .gsd/ and .planning/*.lock alongside .claude/, same runtime-state-leak
    rationale the plan applies to the worktree directory"
  - "Treated the plan's literal 'single exception' identity assertion (Task 1 step 6) as satisfied
    in substance: the load-bearing 38-path branch diff is 100% byte-identical; the second
    .gitignore divergence from 683270f's snapshot is a pure superset addition mandated by this
    same task's own step 2, not a merge-resolution defect"

patterns-established:
  - "Merge landing verified by comparing branch tree content path-by-path against a computed diff
    list, not by trusting git diff --stat against a repo with many untracked files"

requirements-completed: [REQ-socd-policy-choices, REQ-mvp-definition-of-done]

coverage:
  - id: D1
    description: "Branch worktree-phase-4-socd (683270f) merged onto main; unit suite green; real
      isolated build image compiles SOCD firmware for both policies on crkbd/rev1"
    requirement: REQ-socd-policy-choices
    verification:
      - kind: unit
        ref: "pnpm test (357 tests, includes packages/qmk-socd-module/src/socd-resolve.test.ts
          compiling and running socd_resolve_test.c's 2,070 host assertions)"
        status: pass
      - kind: integration
        ref: "pnpm socd:matrix catalogs/0.33.13-1 — 2 builds across 1 keyboard (crkbd/rev1) and 2
          policies (neutral, last_input_priority), real DockerSandbox compile"
        status: pass
      - kind: other
        ref: "38-path branch diff (72cc65c..683270f) compared byte-for-byte against main post-merge,
          this session — 0 unexpected divergences"
        status: pass
    human_judgment: false
  - id: D2
    description: "README's Phase 4 claim corrected to in-progress: names crkbd/rev1 as the
      compile-verified board, both published policies, links 04-VERIFICATION.md, makes no hardware
      or compliance claim"
    requirement: REQ-mvp-definition-of-done
    verification:
      - kind: other
        ref: "grep assertions from Task 2 <verify>: 04-VERIFICATION.md link, crkbd/rev1 literal,
          '**In progress.**' row status, 'Phases 0 through 3 are complete' sentence, no 'Done' in
          the Phase 4 row"
        status: pass
    human_judgment: false
  - id: D3
    description: "Hardware-evidence record skeleton (04-VERIFICATION.md) created with every D-08
      field and every D-07 check enumerated per policy, all not-yet-run, no result pre-filled"
    verification:
      - kind: other
        ref: "grep assertions from Task 3 <verify>: mode/m256wh, sha-256 (ci), 20 occurrences of
          'not yet run', 0 filled result cells"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-09-02
status: complete
---

# Phase 4 Plan 01: Land SOCD Branch and Prove End-to-End Summary

**Merged the accepted Phase 4 SOCD implementation (`worktree-phase-4-socd` @ `683270f`) onto `main`
and proved it compiles real firmware for both SOCD policies on `crkbd/rev1` in the isolated Docker
build image — the module ships as a first-party `qmkweb/socd_cleaner` community module with no
generated C.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3
- **Files modified:** 70 (66 landed from the branch's Phase 4 diff plus baseline reconciliation, plus
  README.md, .gitignore, and the new 04-VERIFICATION.md)

## Accomplishments

- Re-verified (137 paths, this session) that main's uncommitted Phase 1–3 working tree is
  byte-identical to the worktree's baseline `72cc65c` except `docs/adr/0001-technology-stack.md`,
  then committed it as `main`'s first real baseline commit.
- Merged `worktree-phase-4-socd` (`683270f`) with `--no-ff`, resolved every conflict
  deterministically by taking the branch's own 38-path Phase 4 diff verbatim and keeping main's
  annotated `docs/adr/0001-technology-stack.md`, and asserted byte-identity against the branch's full
  tree before committing the merge.
- `pnpm install --frozen-lockfile`, `pnpm test` (357/357 passing), and
  `pnpm socd:matrix catalogs/0.33.13-1` (2 builds across 1 keyboard and 2 policies, real
  `DockerSandbox` compile, ~50s wall clock) all passed against main's own merged code — not the
  branch's.
- Corrected README's Phase 4 claim from a premature "Done" to an honest "In progress" that names
  `crkbd/rev1` as compile-verified, publishes both policies, and points at
  `04-VERIFICATION.md` for the still-outstanding hardware evidence. Removed the now-landed linked
  worktree.
- Created `.planning/phases/04-verified-socd-support/04-VERIFICATION.md` with every D-08 evidence
  field and D-07 check (both policies × 5 checks) in its not-yet-run state, and the D-09
  consequence stated plainly.

## Task Commits

Each task was committed atomically:

1. **Task 1: Land the branch on main and prove SOCD end-to-end** - `785503f` (chore, baseline) +
   `ebd0a25` (feat, merge)
2. **Task 2: Correct the README phase claim and remove the worktree** - `799fba1` (docs)
3. **Task 3: Create the hardware-evidence record skeleton** - `124082e` (docs)

_Note: Task 1's action explicitly calls for two separate commits — the baseline commit (step 3,
required because `72cc65c` is not an ancestor of main) and the merge commit (step 7)._

## Files Created/Modified

- `docs/adr/0005-socd-is-a-first-party-community-module.md` - the accepted decision this phase lands
- `packages/qmk-socd-module/module/qmkweb/socd_cleaner/{socd_cleaner.c,socd_resolve.h,qmk_module.json}` -
  first-party module C, digest-pinned
- `packages/qmk-socd-module/src/index.ts` - digest verification and materialization contract
- `packages/domain/src/socd.ts` - policies, pair tables, keycode map, `socdCapabilitiesFor`
- `packages/domain/src/validate.ts` - prerequisite-driven `CAPABILITY_UNAVAILABLE` for SOCD
- `services/worker/scripts/socd-compile-matrix.ts` - the compile matrix run as end-to-end proof
- `apps/web/src/components/SocdPanel.tsx` - SOCD policy/pair UI with mod-tap and macro copy
- `README.md` - Phase 4 status corrected to in-progress, compile-verified only
- `.gitignore` - added `.claude/`, `.gsd/`, `.planning/*.lock`
- `.planning/phases/04-verified-socd-support/04-VERIFICATION.md` - new hardware-evidence skeleton

## Decisions Made

- Gitignored `.gsd/` (GSD tooling runtime sentinel) and `.planning/*.lock` (ephemeral session lock
  carrying a pid and session id) alongside the plan-mandated `.claude/` addition, before the baseline
  commit — same rationale, same commit, not left for a later cleanup.
- Kept `worktree-phase-4-socd` as a branch ref after removing its worktree, per the plan's explicit
  instruction (the merge commit already preserves the history).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Gitignored `.gsd/` and `.planning/*.lock` alongside `.claude/`**
- **Found during:** Task 1 step 2
- **Issue:** The plan's step 2 only names `.claude/`, but `.gsd/` (a GSD tooling runtime sentinel
  file) and `.planning/milestone.lock` (an ephemeral session lock carrying a pid and session id) were
  also untracked and would otherwise have been swept into the `git add -A` baseline commit by step
  3 — the exact class of local-tooling-state leak the plan explicitly guards against for `.claude/`.
- **Fix:** Added `.gsd/` and `.planning/*.lock` to `.gitignore` in the same edit, before the baseline
  commit.
- **Files modified:** `.gitignore`
- **Verification:** `git status --short` after `git add -A` (baseline commit) shows neither path
  staged.
- **Committed in:** `785503f` (Task 1 baseline commit)

**2. [Documentation note, not a functional deviation] Two plan-verify commands read stricter than
their underlying properties**
- **Found during:** Task 1 step 6 / acceptance criteria
- **Issue (a):** Step 6's literal wording — "the exception set is anything other than exactly
  [`docs/adr/0001-technology-stack.md`], STOP" — reads as if only one path may differ from
  `683270f`'s full 153-path tree snapshot. In practice `.gitignore` also differs, because step 2
  (executed *before* the baseline commit, per the plan's own explicit ordering) adds three ignore
  blocks that `683270f`'s snapshot necessarily predates. Verified via direct diff that the only
  change is a pure line-addition superset (`.claude/`, `.gsd/`, `.planning/*.lock` blocks) — no
  branch content was altered or lost. The check that actually matters — every one of the 38 paths in
  the branch's own Phase 4 diff (`72cc65c..683270f`) compared byte-for-byte against main post-merge —
  passed with zero unexpected divergences. Treated as an expected, in-scope side effect of this same
  task's step 2, not a STOP condition.
- **Issue (b):** The acceptance criterion `grep -c 'Amended by' docs/adr/0001-technology-stack.md`
  returning "at least 2" assumes `grep -c` counts occurrences; it counts matching *lines*. The file
  legitimately contains 2 occurrences of "Amended by," but both fall on the same line (the artifact-
  storage table row), so `grep -c` reports 1. Confirmed via `grep -o 'Amended by' | wc -l` = 2, and
  confirmed the file is byte-identical to its state before this task started (main's own annotated
  ADR 0001, untouched) — the substantive property the criterion checks (main's ADR-0004 annotation
  survived the merge) holds.
- **Fix:** None required — both are plan-authoring wording/counting quirks, not defects in the
  landed state. Documented here for downstream plans/reviewers.
- **Files modified:** none
- **Verification:** `diff` of `.gitignore` against the branch's `683270f` snapshot; `grep -o 'Amended
  by' docs/adr/0001-technology-stack.md | wc -l`
- **Committed in:** n/a (no code change)

---

**Total deviations:** 1 auto-fixed (1 missing critical), plus 1 documentation-only note on two
plan-verify commands. **Impact on plan:** No scope creep; the auto-fix is a direct extension of the
plan's own stated intent for `.claude/`. The documentation note resolves an apparent verify-command
strictness against the plan's own step-2 requirement without weakening any load-bearing check — the
actual 38-path branch-diff identity check and the "ADR 0001 unchanged" check both passed cleanly.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `main` now carries the SOCD module package, domain policy/pair/keycode tables, the
  prerequisite-driven capability gate, generator module emission, compile matrix, SOCD panel, and
  ADR 0005 — every file later plans in this phase need to build on.
- `README.md` and `04-VERIFICATION.md` both correctly state that no hardware verification has
  happened yet; the module registry's hardware-verified list stays empty until `04-05-PLAN.md`'s
  hardware run passes.
- Ready for `04-02-PLAN.md` (curated module registry consolidation).

---
*Phase: 04-verified-socd-support*
*Completed: 2026-09-02*

## Self-Check: PASSED

- All 9 key files verified present on disk (`04-VERIFICATION.md`, `socd_cleaner.c`,
  `qmk-socd-module/src/index.ts`, `domain/src/socd.ts`, `socd-compile-matrix.ts`,
  `SocdPanel.tsx`, ADR 0005, this SUMMARY, `README.md`).
- All 5 commits verified present in `git log`: `785503f`, `ebd0a25`, `799fba1`, `124082e`,
  `e37815a`.
- Re-ran plan-level `<verification>`: `pnpm test` (357/357 pass), `pnpm socd:matrix
  catalogs/0.33.13-1` (2 builds, 1 keyboard, 2 policies, pass), `git worktree list` (main only),
  `git status --porcelain` (clean).
