---
phase: 05-hardening-and-scale
plan: 01
subsystem: api
tags: [postgres, advisory-lock, build-queue, concurrency, rate-limiting, fastify]

# Dependency graph
requires:
  - phase: 04-verified-socd-support
    provides: "Completed build lifecycle (builds table, PostgresBuildStore/InMemoryBuildStore contract pair, DomainError → HTTP mapping) that this plan's admission logic slots into"
provides:
  - "BUILD_LIMITS.maxGlobalActiveBuilds — the global queue-depth cap"
  - "CreateBuildResult as a created/replayed/rejected discriminated union, with BuildAdmissionCap naming which cap bit"
  - "BuildRepository.countActiveGlobal() — the queue-depth signal, reused by 05-07's telemetry gauge"
  - "One advisory-locked admitting transaction in PostgresBuildStore.create() (and its InMemoryBuildStore mirror) that races correctly under real concurrency"
affects: [05-07-observability-telemetry, 05-02, 05-03, 05-04, 05-05, 05-06, 05-08]

# Actuals (#2632)
actuals:
  tokens: 14980
  tasks: 3
  commits: 6

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Admission control decided inside one pg_advisory_xact_lock-serialised transaction, with the same predicates re-expressed as WHERE clauses on the INSERT itself, so the database stays the authority independent of the application code path"
    - "CreateBuildResult as a discriminated union on `outcome` rather than a boolean, so a rejection can carry which cap/observed/limit without a caller re-deriving it"

key-files:
  created: []
  modified:
    - packages/domain/src/limits.ts
    - packages/build-queue/src/types.ts
    - packages/build-queue/src/postgres-store.ts
    - packages/build-queue/src/memory-store.ts
    - packages/build-queue/src/index.ts
    - apps/api/src/routes/builds.ts
    - apps/api/src/builds/service.ts
    - apps/api/src/builds/store-contract.test.ts
    - apps/api/src/routes/builds.test.ts
    - services/worker/src/queue-runner.test.ts

key-decisions:
  - "maxGlobalActiveBuilds = 8 (4x the per-owner concurrency allowance), per the plan's planner_notes reasoning: depth is a wait time, one worker compiles one build at a time, tuning trigger is worker count not a busy hour"
  - "Idempotency-key lookup happens before any cap is consulted inside the locked transaction, so a retry is never converted into a 429 — the same reasoning ADR-0004-idempotency already applied"
  - "The three cap predicates are computed twice (once as a read to name which cap rejected, once inside the INSERT's own SELECT) rather than once, because RETURNING yields nothing on a WHERE-rejected INSERT ... SELECT — this is a correction to RESEARCH.md Pattern 1 recorded in the plan's planner_notes"
  - "assertWithinQuota deleted entirely rather than left as a defense-in-depth check — leaving it would have been a second, racy authority that could disagree with the database under load"

patterns-established:
  - "Admission control (global + per-owner caps) lives entirely inside the repository's create(), never as a pre-flight application check"

requirements-completed: [REQ-hardening-abuse-controls]

coverage:
  - id: D1
    description: "A burst of build requests is absorbed by a global queue-depth cap (BUILD_LIMITS.maxGlobalActiveBuilds = 8), returning BUILD_QUEUE_LIMITED/HTTP 429 with a capacity-worded message that never blames the caller"
    requirement: "REQ-hardening-abuse-controls"
    verification:
      - kind: integration
        ref: "apps/api/src/builds/store-contract.test.ts#quotas > rejects a build once the global queue-depth cap is reached, naming the cap"
        status: pass
      - kind: integration
        ref: "apps/api/src/routes/builds.test.ts#POST /v1/configurations/:id/builds > rejects a build over the global queue-depth cap with a capacity message, not a personal-quota one"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both per-owner caps (concurrency, hourly) are folded into the same atomic admission decision as the global cap; the racy read-then-check assertWithinQuota is deleted from the API layer"
    requirement: "REQ-hardening-abuse-controls"
    verification:
      - kind: integration
        ref: "apps/api/src/builds/store-contract.test.ts#quotas > rejects a build once the per-owner concurrency cap is reached, naming the cap"
        status: pass
      - kind: integration
        ref: "apps/api/src/builds/store-contract.test.ts#quotas > rejects a build once the per-owner hourly cap is reached, naming the cap"
        status: pass
      - kind: integration
        ref: "apps/api/src/builds/store-contract.test.ts#quotas > treats the hourly window's lower bound as inclusive"
        status: pass
      - kind: other
        ref: "grep -rn 'assertWithinQuota' apps packages services (returns nothing)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The count-then-insert admission decision is race-free under real concurrency: N simultaneous create() calls against a cap of K accept exactly K, never K+1, proven against real Postgres and repeated across iterations"
    requirement: "REQ-hardening-abuse-controls"
    verification:
      - kind: integration
        ref: "apps/api/src/builds/store-contract.test.ts#admission control under concurrency > accepts exactly maxGlobalActiveBuilds concurrent creates and rejects the rest"
        status: pass
      - kind: integration
        ref: "apps/api/src/builds/store-contract.test.ts#admission control under concurrency > accepts exactly maxActiveBuildsPerOwner concurrent creates for one owner and rejects the rest"
        status: pass
      - kind: integration
        ref: "apps/api/src/builds/store-contract.test.ts#admission control under concurrency > accepts exactly one create among concurrent duplicates of one idempotency key"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-09-03
status: complete
---

# Phase 5 Plan 1: Global Build Admission Control Summary

**One advisory-locked Postgres transaction now decides every build admission — global queue-depth cap, both per-owner caps, and idempotency replay — replacing a racy read-then-check with a `created | replayed | rejected` outcome proven exact-not-approximate under repeated real concurrency.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-03T09:05:00-04:00 (approx; not captured before first Read)
- **Completed:** 2026-09-03T09:42:01-04:00
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments
- `BUILD_LIMITS.maxGlobalActiveBuilds = 8` — the global queue-depth cap protecting the single build host from any number of individually-compliant sessions.
- `CreateBuildResult` reshaped from `{ build, created: boolean }` to a `created | replayed | rejected` discriminated union, with `BuildAdmissionCap` naming which of the three caps bit and the `observed`/`limit` counts.
- `PostgresBuildStore.create()` rewritten to run inside one `#transaction`, holding a transaction-scoped `pg_advisory_xact_lock` keyed on `qwa:build-admission`, checking idempotency before any cap, computing all three admission counts in one pass, and re-expressing the same three predicates as `WHERE` clauses on the `INSERT` itself so the database remains the authority independent of the TypeScript branch.
- `InMemoryBuildStore.create()` mirrors the identical decision (no lock needed — the event loop already serialises it).
- `apps/api/src/builds/service.ts`'s `assertWithinQuota` — the racy two-round-trip read-then-check — deleted entirely; `apps/api/src/routes/builds.ts` now switches on the repository's own `outcome`.
- Proven under real, repeated concurrency: `N` simultaneous `create()` calls against a cap of `K` accept exactly `K`, never `K+1`, across 5 iterations per scenario (global cap, per-owner cap, shared-idempotency-key), against both `InMemoryBuildStore` and `PostgresBuildStore`.

## Task Commits

Each task was committed atomically (Task 2 and Task 3 carried `tdd="true"`):

1. **Task 1: A build request over the global queue-depth cap returns 429, end to end** (tracer) - `64d00ba` (feat)
2. **Task 2: Fold both per-owner caps into the same decision and delete the read-then-check** - `c732ae2` (test/RED) → `0435321` (feat/GREEN) → `f7c46a4` (test, closing an acceptance-criterion gap found after GREEN)
3. **Task 3: Prove the race is gone under real concurrency** - `2113c04` (test)

Plus `5e08a23` (docs) recording a deviation in the cross-phase defect ledger, and this SUMMARY's own metadata commit.

_Note: Task 2's RED phase tests passed immediately rather than failing first — the store-level per-owner cap logic they exercise (`BuildRepository.create()`) was already built by Task 1; Task 2's real GREEN work was deleting the now-redundant `assertWithinQuota`. This is documented inline in the `c732ae2` commit message rather than being a TDD-gate violation: the RED/GREEN pattern still holds a `test(...)` commit before the `feat(...)` commit that changes behavior._

## Files Created/Modified
- `packages/domain/src/limits.ts` - Adds `BUILD_LIMITS.maxGlobalActiveBuilds = 8` with the depth-is-a-wait-time rationale
- `packages/build-queue/src/types.ts` - `CreateBuildResult` discriminated union, `BuildAdmissionCap`, `BuildRepository.countActiveGlobal()`, and the moved claude.md § Build isolation and security explanatory comment
- `packages/build-queue/src/postgres-store.ts` - Advisory-lock-serialised admission-control `create()`, `countActiveGlobal()`
- `packages/build-queue/src/memory-store.ts` - In-process mirror of the same three-cap decision, `countActiveGlobal()`
- `packages/build-queue/src/index.ts` - Re-exports `BuildAdmissionCap`
- `apps/api/src/routes/builds.ts` - Switches on `outcome`; exports `globalCapacityMessage()`/`ownerConcurrencyMessage()`/`ownerHourlyMessage()`
- `apps/api/src/builds/service.ts` - `assertWithinQuota` deleted
- `apps/api/src/builds/store-contract.test.ts` - New contract assertions: global cap, both per-owner caps, hourly-window boundary, cross-owner isolation, no-row-on-rejection, and the concurrency proof
- `apps/api/src/routes/builds.test.ts` - New route-level assertion for the global cap and a message assertion on the existing per-owner concurrency test
- `services/worker/src/queue-runner.test.ts` - `enqueue()` helper updated for the new `CreateBuildResult` shape (deviation, see below)

## Decisions Made
- `maxGlobalActiveBuilds = 8`: depth is directly a wait time (depth × mean compile time ÷ worker count); one worker compiles one build at a time; 8 is 4x the per-owner allowance so four sessions can each hold their full quota before the global cap bites. Tuning trigger is worker count, not a single busy hour.
- The three cap predicates are computed twice inside one transaction (once to read counts for naming the rejected cap, once inside the `INSERT ... SELECT`'s own `WHERE`) rather than reusing one read, because `RETURNING` yields nothing on a `WHERE`-rejected `INSERT ... SELECT` — a correction to RESEARCH.md Pattern 1 recorded in the plan's own `planner_notes`.
- Idempotency-key lookup happens before any cap is consulted, so a retry from an owner at their cap is never converted into a rejection.
- `assertWithinQuota` deleted rather than kept as defense-in-depth: a second, application-level authority beside the database's own transaction would disagree with it under load, which is exactly the race `ADR-0004-idempotency` already rejected for idempotency.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Re-exported `BuildAdmissionCap` from `packages/build-queue/src/index.ts`**
- **Found during:** Task 1
- **Issue:** `apps/api/src/routes/builds.ts` needed `BuildAdmissionCap` from the package's public surface; `index.ts` only re-exported the other `types.ts` exports.
- **Fix:** Added `BuildAdmissionCap` to the `export type { ... }` block.
- **Files modified:** `packages/build-queue/src/index.ts`
- **Verification:** `pnpm typecheck` passes.
- **Committed in:** `64d00ba` (Task 1 commit)

**2. [Rule 3 - Blocking] Fixed `services/worker/src/queue-runner.test.ts`'s `enqueue()` helper**
- **Found during:** Task 1
- **Issue:** `CreateBuildResult`'s shape change (from `{ build, created }` to a discriminated union) broke this test file's `const { build } = await queue.create(...)` destructuring, outside Task 1's declared files.
- **Fix:** Rewrote `enqueue()` to check `result.outcome === 'rejected'` before accessing `.build`, throwing on an unexpected rejection (a test-setup bug, not a real scenario in that file).
- **Files modified:** `services/worker/src/queue-runner.test.ts`
- **Verification:** `pnpm typecheck` and `pnpm test` pass.
- **Committed in:** `64d00ba` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking type errors from the plan's own interface-shape change cascading to files outside the declared list).
**Impact on plan:** Both fixes were mechanical consequences of `CreateBuildResult`'s breaking shape change, not scope creep. No behavior change in either fixed file.

## Issues Encountered

**Pre-existing, unrelated test-infrastructure flakiness surfaced by stress-testing Task 3's concurrency tests.** `apps/api/src/builds/store-contract.test.ts` and `apps/api/src/configurations/repository-contract.test.ts` both connect to the same physical Postgres instance with no schema-level isolation between test files, and Vitest runs test files in parallel by default (no `test.pool`/isolation config exists in `vitest.config.ts`). One file's `beforeEach` truncation can occasionally collide with another file's in-flight insert, surfacing as an intermittent `builds_configuration_fk` violation — roughly 1 in 15-20 full-suite runs. Confirmed via 15 consecutive clean runs of `apps/api/src/builds/store-contract.test.ts` in isolation that the admission-control implementation itself is correct and race-free; the intermittent failure is a cross-file test-harness artifact that predates this plan (not introduced by it — my new concurrency tests just hold real Postgres operations open long enough to occasionally observe a pre-existing race). A real fix (per-file schema isolation, or forcing Postgres-backed contract-test files to run sequentially) touches `vitest.config.ts` and multiple test files — a project-wide test-infrastructure decision outside a single task's file scope. Documented in `.planning/phases/05-hardening-and-scale/deferred-items.md` and recorded in `.planning/WINDOWS.md` (kind: `deviation`, phase 05) rather than fixed unilaterally.

An additional, entirely unrelated flaky failure (`services/worker/src/run-build.test.ts > SOCD module placement > ...`) was observed once during the stress sweep; that file was last touched in Phase 4 (git history), confirming it predates this plan and is not investigated further here.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `BuildRepository.countActiveGlobal()` is in place for 05-07's telemetry gauge (queue-depth signal) to consume directly.
- The three-cap admission decision and its `rejected` outcome shape are the pattern later Phase 5 plans (session-issuance rate limiting, D-12) should follow rather than reinventing a second admission style.
- **Blocker/concern for later 05-0x plans touching `apps/api/src/builds/store-contract.test.ts` or `apps/api/src/configurations/repository-contract.test.ts`:** be aware of the documented cross-file Postgres test-isolation gap (see Issues Encountered above) before adding more heavily-concurrent Postgres contract tests, which would further raise its (already low) observed collision rate.

---
*Phase: 05-hardening-and-scale*
*Completed: 2026-09-03*
