# Deferred Items — Phase 4

Out-of-scope discoveries logged per the executor's deviation-rule scope boundary
(fix only what the current task's changes directly caused).

## Flaky test: `apps/api/src/routes/builds.test.ts` > "lists a configuration's builds newest first"

- **Found during:** 04-04 plan execution, running `pnpm test` after Task 3's registry change.
- **Symptom:** Intermittently fails (~1/3 runs observed) with the two builds' ids swapped in
  the returned `items` order — looks like a millisecond-resolution timestamp tie between the
  two builds' `requestedAt`/`createdAt` values racing the "newest first" sort.
- **Scope:** Pre-existing, unrelated to this plan's SOCD/module-registry/sandbox changes. Last
  touched by `ddaf57f` (plan 04-03, `feat(04-03): extend build completion contract with SOCD
  module version`), which added a field to the same file's `succeed()`/`complete()` fixtures but
  did not touch build ordering or timing.
- **Action:** Not fixed here — out of scope for 04-04. Flag for a future plan/phase touching the
  build-listing endpoint or its ordering/timestamp precision.
