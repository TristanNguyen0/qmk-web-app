<!-- refreshed: 2026-08-27 -->
# Codebase Concerns

**Analysis Date:** 2026-08-27

## Tech Debt

**Session Secret Exposure in Dev Configuration:**
- Issue: `apps/api/src/server.ts:36` contains a hardcoded dev-only session secret used as fallback when `QWA_SESSION_SECRET` is not set. While the code correctly checks for production and exits, the default secret is visible in source.
- Files: `apps/api/src/server.ts`
- Impact: If deployed with `NODE_ENV` not set to 'production', the hardcoded secret could allow session forgery. Every session cookie would be reproducible.
- Fix approach: Remove the hardcoded fallback entirely. Require `QWA_SESSION_SECRET` to be explicitly set in all environments, or at minimum, validate it's production-grade (minimum entropy/length).

**Filesystem-Based Artifact Storage Scaling Limitation:**
- Issue: `packages/artifact-store/src/filesystem-store.ts` and `services/worker/src/main.ts` show artifacts are stored on a shared filesystem between API and worker. ADR 0004 explicitly defers S3 implementation until multi-host deployment becomes necessary.
- Files: `packages/artifact-store/src/filesystem-store.ts`, `apps/api/src/server.ts`, `services/worker/src/main.ts`
- Impact: Cannot scale API and worker to separate machines without coordinating shared storage (NFS, etc.). S3 migration is blocked until it becomes critical.
- Fix approach: Implement S3-backed `ArtifactStore` in `packages/artifact-store/` (interface already exists). Test against MinIO locally. Wire S3 credentials through environment config.

**Polling-Based Queue Claim Efficiency:**
- Issue: `services/worker/src/queue-runner.ts:146` uses `setInterval` with `pollIntervalMs` (default 1000 ms) to claim builds. ADR 0004 acknowledges "polling costs one query per worker per idle second."
- Files: `services/worker/src/queue-runner.ts`, `packages/build-queue/src/types.ts`
- Impact: With 10+ idle workers, this becomes 600 queries/minute just to an empty queue. At scale, `LISTEN/NOTIFY` would reduce this to near-zero.
- Fix approach: Implement `BuildQueue` interface with PostgreSQL `LISTEN/NOTIFY` when worker count exceeds a threshold. The interface is stable; no other code needs to change.

**Orphaned Artifact Files on Maintenance Failure:**
- Issue: `services/worker/src/queue-runner.ts` maintenance deletes database rows before their blob files. If the delete of the blob fails mid-operation, database cleanup completes but the object remains.
- Files: `services/worker/src/queue-runner.ts`, `packages/artifact-store/src/filesystem-store.ts`
- Impact: Over weeks/months, unreferenced firmware and log files accumulate on disk, wasting storage. No monitoring alerts for orphans.
- Fix approach: Add a "reaper" job that scans the artifact directory for files not referenced in the database and alerts/removes them. Log all deletes for audit.

## Known Bugs

**Configuration Conflict Requires Manual Reload:**
- Symptoms: When a configuration is edited from two browser tabs, the second POST receives a 409 conflict. The UI shows the conflict but has no "reload and retry" button.
- Files: `apps/web/src/components/KeymapEditor.tsx:92-98`
- Trigger: Open the same configuration in two browser tabs, make different edits, save in both tabs within 1.2 seconds of each other.
- Workaround: User must manually reload the page to fetch the latest revision. Current revision number is shown in the error message.

**Autosave Suppresses Invalid Configuration Feedback During Typing:**
- Symptoms: While typing a configuration name, if a save fails with validation errors, the error is shown briefly but then disappears as the user continues typing (timer resets).
- Files: `apps/web/src/components/KeymapEditor.tsx:118-124`
- Trigger: Make a configuration invalid (e.g., no layers bound), wait 1.2 seconds to autosave, then immediately edit the name. Errors will clear before the user reads them.
- Workaround: Click "Save now" manually to see stable error output. Autosave is best-effort, not a guarantee.

## Security Considerations

**Session Cookie Lacks SameSite in Non-HTTPS Mode:**
- Risk: `apps/api/src/app.ts` sets `secure: options.secureCookies` but does not explicitly set `SameSite`. With `secure=false` in dev, browsers may default to `SameSite=None`, allowing cross-site POST forgery if JavaScript is compromised.
- Files: `apps/api/src/app.ts`, `apps/api/src/session.ts`
- Current mitigation: `secureCookies` is set to `isProduction` in `server.ts`. In production, Secure flag is set, which requires HTTPS and limits risk.
- Recommendations: Add explicit `SameSite=Strict` to all session cookies, regardless of HTTPS. Verify this in `apps/api/src/session.ts` (currently not shown).

**Worker Role Privileges Correctly Constrained:**
- Risk: None detected. `apps/api/migrations/003_worker_role.sql` correctly restricts the worker to `SELECT, UPDATE` on builds and `SELECT, INSERT` on artifacts, with no access to configurations.
- Files: `apps/api/migrations/003_worker_role.sql`
- Current mitigation: Grants are minimal and auditable. Worker cannot read configuration details; it only updates build status using immutable copies in `configuration_revisions`.
- Recommendations: No changes needed; this is well-designed.

**Artifact Keys Cannot Escape Root Directory:**
- Risk: None. `packages/artifact-store/src/filesystem-store.ts:36` validates keys do not escape `this.#root` using `relative()` and checking for `..`.
- Files: `packages/artifact-store/src/filesystem-store.ts`
- Current mitigation: Keys are derived deterministically by `packages/artifact-store/src/keys.ts` and never accept user input.
- Recommendations: Keep this validation. It's a defensive boundary check even though key generation is already safe.

**Build Sandbox Isolation is Strong:**
- Risk: None detected in application code. Docker container is run with `--network=none`, `--read-only`, `--cap-drop=ALL`, no new privileges, and resource limits.
- Files: `packages/qmk-sandbox/src/docker-sandbox.ts` (details in package, not shown here)
- Current mitigation: Verified by README security properties and smoke test.
- Recommendations: Document the exact flags in code comments for future sandbox implementations (e.g., Podman, crun).

## Performance Bottlenecks

**Large Test Files Slow Down Test Runs:**
- Problem: `apps/api/src/builds/store-contract.test.ts` is 640 lines. `apps/api/src/routes/builds.test.ts` is 518 lines. Both run contract tests against in-memory and Postgres stores.
- Files: `apps/api/src/builds/store-contract.test.ts`, `apps/api/src/routes/builds.test.ts`, `apps/api/src/configurations/repository-contract.test.ts` (431 lines)
- Cause: Tests are comprehensive (intentionally); they verify concurrency guarantees and state machine correctness that a lenient fake would hide.
- Improvement path: Split into unit + contract suites. Unit tests verify logic with a fake store; contract tests run only against Postgres when available. This allows faster local iteration without losing coverage.

**Configuration Revision Lookups on Every Build Claim:**
- Problem: `services/worker/src/queue-runner.ts` validates the configuration against the catalog on every claim (even reclaimed builds). The configuration_revisions table has no index on `configuration_id`.
- Files: `services/worker/src/queue-runner.ts`, `apps/api/migrations/002_builds.sql`
- Cause: The migration creates `configuration_revisions` but does not add an index on `(configuration_id, revision)` to speed lookups.
- Improvement path: Add a covering index on `configuration_revisions(configuration_id, revision) INCLUDE (document)` in a new migration. Measure query time before and after.

## Fragile Areas

**In-Memory Store Concurrency Guarantees Are Not Enforced by Type:**
- Files: `packages/build-queue/src/memory-store.ts`, `packages/build-queue/src/postgres-store.ts`
- Why fragile: The in-memory store comments that concurrency guarantees are "trivially true because JavaScript is single-threaded between awaits." If someone adds `Promise.all()` or worker threads, the semantics silently break. There is no type guard or assertion to catch this.
- Safe modification: Add a runtime check in the in-memory store's `claim()` and `advance()` methods that asserts no concurrent calls are in flight (use a simple flag or counter). Document this invariant. Consider adding `@deprecated` JSDoc warning that the in-memory store is for tests only.
- Test coverage: `apps/api/src/builds/store-contract.test.ts` covers both stores equally; it would catch a broken fake, but only if run with the broken fake. No type-level guarantee exists.

**Build Lease Expiry Recovery Depends on `maintain()` Being Called:**
- Files: `services/worker/src/queue-runner.ts`, `services/worker/src/main.ts:125`
- Why fragile: If a worker crashes before calling `maintain()`, its in-flight builds stay in `preparing|building|uploading` status until the next worker starts (or until manual intervention). The interval is 60 seconds (`MAINTENANCE_INTERVAL_MS`).
- Safe modification: Call `maintain()` on startup (already done at `main.ts:125`). Add a health check endpoint that reports if maintenance is overdue. Log every maintenance run with build count recovered.
- Test coverage: `services/worker/src/queue-runner.test.ts` tests that `maintain()` requeues expired leases; no test for "what if a worker crashes between poll and maintain?"

**Configuration Update Race Window:**
- Files: `apps/api/src/configurations/postgres-repository.ts`, `apps/web/src/components/KeymapEditor.tsx`
- Why fragile: `updateConfiguration()` uses `If-Match` for optimistic concurrency, but the revision is read from a ref in the component (`revisionRef.current`). If the page is left open during a build, the ref can become stale, and a save after the build finishes will conflict invisibly if no save was made in between.
- Safe modification: Refetch the configuration after every state change (build completion, navigation, page regain focus). Always treat `revisionRef.current` as potentially stale.
- Test coverage: `apps/web/src/components/KeymapEditor.tsx` has no tests. The component's concurrency logic is untested.

## Scaling Limits

**Build Queue Lease Reclaim Latency:**
- Current capacity: Workers poll every 1 second (`pollIntervalMs` default). A dead worker's lease expires after 2 minutes (`buildLeaseMs`). In that 2-minute window, its builds are stuck in `preparing|building|uploading`.
- Limit: If a worker dies unexpectedly (crash, OOM, network loss), the queue cannot recover for up to 120 seconds. Users see their build as "in progress" even though it is abandoned.
- Scaling path: Implement `LISTEN/NOTIFY` or a heartbeat table to detect dead workers faster. Reduce the lease to 30 seconds and heartbeat every 5 seconds.

**Session Storage Unbounded:**
- Current capacity: Sessions are stored as HTTP-only cookies, so no server-side limit. Each session occupies one row in `configurations` for every saved keymap.
- Limit: The database has no cleanup policy for old sessions. After 1 year of use, a user could have 1000+ configurations.
- Scaling path: Implement a retention policy in the maintenance job (`QueueRunner.maintain()`). Move old configurations to an archive, or add a session expiry date.

**Artifact Retention Policy is Fixed:**
- Current capacity: All artifacts are kept for 7 days (`BUILD_LIMITS.maxArtifactRetentionMs`). At 100 builds/day × ~30 KiB/firmware × 7 days = ~21 GB/year.
- Limit: Long-running instances will accumulate GB of firmware. The maintenance job removes objects, but filesystem space is not monitored.
- Scaling path: Add a metric for artifact storage usage. Implement configurable retention (e.g., 7 days for succeeded, 1 day for failed). Add a disk-space alert.

## Dependencies at Risk

**Node.js `--experimental-strip-types` Flag:**
- Risk: Both `apps/api/src/server.ts` and `services/worker/src/main.ts` use the command `node --experimental-strip-types`. This flag is stable as of Node 22, but may be removed or change behavior in future majors.
- Impact: Build scripts break without a TypeScript build step. Deployment scripts must keep up with Node version changes.
- Migration plan: Add a `tsx` or `tsx-esm` loader as a regular dependency (not dev-only), and update scripts to use it. Or add a TypeScript build step in CI and commit `.js` files alongside `.ts`.

**Fastify 5.2.0 with Security Patches:**
- Risk: Fastify is at 5.2.0. Regular minor updates are available. No known CVEs in this version, but dependency updates are not automated.
- Impact: Security patches may be missed if dependency updates are not part of the release process.
- Migration plan: Add `dependabot` or `renovate` to the repo. Set up a weekly PR for dependency updates. Review and merge regularly.

**pg 8.13.1 Connection Pool Concurrency:**
- Risk: The Postgres driver is at 8.13.1. The API pool is set to `max: 10` and the worker to `max: 4`. If more workers are added, connection exhaustion is possible.
- Impact: Builds could be blocked waiting for a free connection. No monitoring of pool utilization exists.
- Migration plan: Add a health check that reports pool usage (`pool.totalCount`, `pool.availableCount`). Add metrics to track pool wait time. Consider a connection pooler (e.g., PgBouncer) if worker count exceeds 5.

## Missing Critical Features

**SOCD (Simultaneous Opposite Cardinal Directions) Support Not Implemented:**
- Problem: Phase 4 in README is "Not started. Schema exists; validation and generation deliberately refuse it."
- Blocks: Users cannot request neutral handling of opposing keycodes (e.g., A+D pressed = neutral).
- Files: `packages/domain/src/configuration.ts` (schema field exists), `packages/domain/src/validate.ts` (rejects if present)
- Current state: Schema accepts `socd: null` or an object, but any non-null value fails validation. Generator throws if SOCD is present.

**No User Accounts or Ownership Transfer:**
- Problem: Configurations are tied to an anonymous session cookie. There is no way to create an account, log in, or transfer ownership.
- Blocks: Users cannot access their configurations on a different device. Sharing builds requires sharing a cookie.
- Current state: `README.md:59` notes "Configurations belong to an anonymous session cookie. Every read and write is authorized by owner, so accounts later change only where the owner id comes from." This is intentional placeholder design.

**No Keyboard Firmware Flashing Integration:**
- Problem: Users download firmware but must use external tools (QMK Toolbox, dfu-programmer) to flash.
- Blocks: Seamless end-to-end workflow (edit → build → flash).
- Current state: Phase 5-6 in README are "Not started."

## Test Coverage Gaps

**Untested Web UI Component Concurrency:**
- What's not tested: `apps/web/src/components/KeymapEditor.tsx` and `apps/web/src/components/BuildPanel.tsx` have no unit or integration tests. The autosave race condition (error suppression during typing) is not covered.
- Files: `apps/web/src/components/KeymapEditor.tsx`, `apps/web/src/components/BuildPanel.tsx`
- Risk: A regression in save order or timing could silently corrupt a configuration (or fail to save without user notice).
- Priority: High. These are the primary user-facing features.

**No E2E Tests for Build Queue Recovery:**
- What's not tested: End-to-end scenario: worker claims a build, crashes, and the build is recovered by a second worker starting. This is tested in `apps/api/src/builds/store-contract.test.ts`, but only for the in-memory and Postgres stores. The full queue runner loop with timeouts and signal handling is not tested.
- Files: `services/worker/src/queue-runner.test.ts`, `services/worker/src/main.ts`
- Risk: A regression in the signal handler or maintenance loop could cause indefinite hangs or data corruption. Hard to catch in code review.
- Priority: Medium. Complex logic, but not a user-facing path until a worker crashes.

**No Load Test for Artifact Storage Concurrency:**
- What's not tested: Two workers writing to the same artifact key simultaneously (should fail gracefully with `EEXIST`). The filesystem store handles this, but there is no load test or stress test.
- Files: `packages/artifact-store/src/filesystem-store.ts`, `packages/artifact-store/src/store.test.ts`
- Risk: A race condition could lead to a corrupted firmware image or a silently overwritten object.
- Priority: Medium. The `wx` flag and `link()` are defensive, but no test exercises the race condition directly.

---

*Concerns audit: 2026-08-27*
