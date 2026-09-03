# Deferred Items — Phase 5

Out-of-scope discoveries logged during plan execution, per the executor's Scope
Boundary policy (fix only issues directly caused by the current task's changes).

## From 05-01 (Task 3)

### Cross-file Postgres test isolation gap causes rare, unrelated intermittent failures

**Found during:** 05-01 Task 3, while stress-testing the new concurrency contract
tests (`describe('admission control under concurrency')` in
`apps/api/src/builds/store-contract.test.ts`).

**Root cause (pre-existing, not introduced by 05-01):** `vitest.config.ts` sets no
`test.pool`/isolation options, so Vitest runs test files in parallel worker threads
by default. Both `apps/api/src/builds/store-contract.test.ts` and
`apps/api/src/configurations/repository-contract.test.ts` connect to the *same*
physical Postgres instance (`127.0.0.1:5433`, `QWA_TEST_DATABASE_URL` /
`QWA_DATABASE_URL` default) and each file's `beforeEach` truncates the shared
`configurations` (and `builds`) tables with no schema-level isolation between
files. When both files' Postgres-backed suites happen to run concurrently, one
file's `DELETE FROM configurations` can race a still-in-flight `INSERT` in the
other file, surfacing as an intermittent
`insert or update on table "builds" violates foreign key constraint
"builds_configuration_fk"` error — a test-harness artifact, not a build-queue
correctness bug.

**Why this surfaced now:** no prior test held real, multi-hundred-millisecond
concurrent Postgres operations open across a `beforeEach` boundary long enough to
collide. The new admission-control concurrency tests (`Promise.all` over 8-16
simultaneous `create()` calls, repeated 5 iterations each) widen that window
enough to occasionally observe the pre-existing race — observed at roughly 1 in
15-20 full-suite runs.

**Evidence the implementation itself is correct, not merely "usually correct":**
running `apps/api/src/builds/store-contract.test.ts` in isolation (excluding every
other test file from the same Vitest invocation) passed cleanly across 15
consecutive runs with zero failures. The intermittent failure only appears when
Vitest schedules `store-contract.test.ts` and `repository-contract.test.ts` (or
other Postgres-touching files) in the same parallel run.

**Also observed, same root class (unrelated pre-existing flakiness, not
investigated further as it predates 05-01):**
- `apps/api/src/routes/builds.test.ts > GET /v1/configurations/:id/builds > lists
  a configuration's builds newest first` — present in the base commit
  (`07dc172`) before any 05-01 work; likely an `InMemoryBuildStore` sort-stability
  issue when two builds share a `requestedAt` millisecond.
- `services/worker/src/run-build.test.ts > SOCD module placement > still writes
  only qmk.json and keymap.json as generated output` — observed once during the
  stress sweep; not reproduced on isolated re-run.

**Suggested fix (out of scope for 05-01):** either give each Postgres-backed
contract-test file its own schema/`search_path`, or force Vitest to run
Postgres-touching test files sequentially (e.g. `test.pool: 'forks'` with
`singleFork: true`, or a dedicated `vitest.integration.config.ts` for
`*-contract.test.ts` files). This is a test-infrastructure change spanning
multiple files and `vitest.config.ts` — an architectural decision (deviation Rule
4), not a fix that belongs inside a single plan task.

**Status:** Not fixed. Documented here per Scope Boundary. Does not block 05-01:
`pnpm test -- store-contract` and the full `pnpm test` run pass reliably when the
Postgres container is healthy and Vitest's parallel file scheduling does not
happen to collide two Postgres-backed suites (the common case; observed failure
rate roughly 1 in 15-20 full-suite runs).
