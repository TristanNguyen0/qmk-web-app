---
phase: 05-hardening-and-scale
plan: 04
subsystem: infra
tags: [postgres, pg_dump, pg_restore, backup, retention, licensing, docker-compose, vitest, tdd]

requires:
  - phase: 05-hardening-and-scale
    provides: "05-01's atomic build-admission tracer slice, proven against real Postgres — this plan's queue-runner.ts and build-queue types build on that shape"
provides:
  - "A durable retention record on QueueRunner.maintain(): what a sweep deleted, naming build ids never storage keys, surviving every blob delete failing"
  - "buildIdFromKey(), the inverse of artifactKey/logKey, in packages/artifact-store"
  - "infra/deploy/backup.sh and infra/deploy/restore-drill.sh — a real, runnable Postgres backup and restore drill with row-count parity proof"
  - "docs/runbooks/backup-restore.md and docs/licensing-review.md"
affects: [05-06-security-review, 05-07-observability]

actuals:
  tokens: 11985
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Retention record gated on what reap() returned from the database, not on blob-delete success — repudiation-proof by construction"
    - "Prefer running pg_dump/pg_restore inside the compose postgres container over a host-installed client, to guarantee exact server-version match"

key-files:
  created:
    - infra/deploy/backup.sh
    - infra/deploy/restore-drill.sh
    - docs/runbooks/backup-restore.md
    - docs/licensing-review.md
  modified:
    - services/worker/src/queue-runner.ts
    - services/worker/src/queue-runner.test.ts
    - packages/artifact-store/src/keys.ts
    - packages/artifact-store/src/store.test.ts
    - packages/artifact-store/src/index.ts

key-decisions:
  - "Route pg_dump/pg_dumpall/pg_restore through the compose postgres container whenever it is running, rather than only when a local client is absent — a host client one major version ahead of the pinned server (17 vs 16) silently breaks restores via a GUC the older server rejects"
  - "Retention record objects carry buildId (via buildIdFromKey) and never the storage key, matching the same trust boundary artifactKey/logKey already enforce"

requirements-completed: [REQ-backup-retention-controls]

coverage:
  - id: D1
    description: "Every retention sweep that deletes something leaves a durable record naming build ids, expired-build count, timestamp, and per-object outcome — including when every blob delete fails"
    requirement: "REQ-backup-retention-controls"
    verification:
      - kind: unit
        ref: "services/worker/src/queue-runner.test.ts#maintenance > records what a sweep deleted, naming build ids and never storage keys"
        status: pass
      - kind: unit
        ref: "services/worker/src/queue-runner.test.ts#maintenance > still emits a retention record when every blob delete throws"
        status: pass
      - kind: unit
        ref: "services/worker/src/queue-runner.test.ts#maintenance > records an already-absent object distinctly from a deleted one"
        status: pass
      - kind: unit
        ref: "services/worker/src/queue-runner.test.ts#maintenance > emits no retention event on a second, immediate sweep"
        status: pass
      - kind: unit
        ref: "services/worker/src/queue-runner.test.ts#maintenance > emits no retention event when only expired leases are reclaimed"
        status: pass
    human_judgment: false
  - id: D2
    description: "buildIdFromKey recovers build ids from either storage key shape and rejects malformed keys"
    verification:
      - kind: unit
        ref: "packages/artifact-store/src/store.test.ts#buildIdFromKey"
        status: pass
    human_judgment: false
  - id: D3
    description: "A Postgres backup can be taken and restored into a scratch database with proven row-count parity, and the scratch database is always dropped, including on a deliberate mismatch"
    requirement: "REQ-backup-retention-controls"
    verification:
      - kind: manual_procedural
        ref: "infra/deploy/backup.sh var/backups && infra/deploy/restore-drill.sh <output dir>, run against the dev database at 127.0.0.1:5433; re-run with a deliberately inserted extra row to confirm non-zero exit and scratch-database cleanup"
        status: pass
    human_judgment: true
    rationale: "Verified directly by the executor against the live dev database this session (row-count parity, correct exit codes, permissions, scratch-db cleanup on both success and failure), but a shell script's runtime behavior against a real Postgres instance is exactly the kind of infra correctness a human should re-confirm on the actual deployment target, not merely infer from this record."
  - id: D4
    description: "The QMK and bundled-dependency licensing review exists, answers all four required questions, and every licence identifier is traceable to the tree"
    requirement: "REQ-backup-retention-controls"
    verification:
      - kind: other
        ref: "test -f docs/licensing-review.md && grep -q GPL docs/licensing-review.md"
        status: pass
    human_judgment: true
    rationale: "The document's factual claims (LICENSE text, SPDX survey, MODULE_REGISTRY fields, pnpm licenses list --prod output) were checked directly against the tree by the executor, but whether the review's judgment calls (e.g. the catalogs/ facts-vs-source-file distinction) are legally sound is outside what an automated check can confirm."

duration: 20min
completed: 2026-09-03
status: complete
---

# Phase 5 Plan 4: Retention accountability, real Postgres backups, and licensing review Summary

**`QueueRunner.maintain()` now returns a durable retention record naming build ids and per-object outcomes even when every blob delete fails, and a Postgres backup/restore drill actually runs and proves row-count parity against the dev database — not just documented.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-03T15:10:00Z (approx.)
- **Completed:** 2026-09-03T15:29:02Z
- **Tasks:** 3 completed
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments

- `QueueRunner.maintain()` builds a `RetentionRecord` — `deletedAt`, `buildsExpired`, and one entry per reaped object naming the build id (via new `buildIdFromKey()`), whether it was the artifact or the log, and its outcome (`deleted` | `already-absent` | `failed`) — gated on what `reap()` returned from the database, never on how many blob deletes actually succeeded. A sweep that reaps rows and then fails every blob delete is exactly the case that must not be silent, and now isn't (`packages/domain` requirement `REQ-backup-retention-controls`).
- `buildIdFromKey()` added to `packages/artifact-store/src/keys.ts` as the inverse of `artifactKey`/`logKey`, validating the recovered build id rather than trusting a value round-tripped through the database — mirroring the module's existing trust posture.
- `infra/deploy/backup.sh` produces a timestamped, permission-restricted (`700`/`600`) directory containing a `pg_dump -Fc` of the application database and a `pg_dumpall --globals-only` dump of roles/grants (needed for `qwa_worker`'s narrow grant list to survive a restore into a fresh cluster).
- `infra/deploy/restore-drill.sh` restores that backup into a scratch database, asserts `count(*)` parity for `configurations`, `configuration_revisions`, `builds`, and `artifacts` against the source, and drops the scratch database on the way out via a trap — verified to work on both a clean pass and a deliberately introduced mismatch.
- `docs/runbooks/backup-restore.md` documents the backup exclusion (artifacts are 7-day-ephemeral and reproducible, never backed up), how to run and interpret both scripts, the manual rebuild-from-restore checklist a script can't automate, how to answer "what did retention delete" from the Task 1 event's actual field names, and the `retention_events` table revisit trigger.
- `docs/licensing-review.md` answers all four required questions, derived from the pinned QMK `LICENSE`/SPDX survey, `MODULE_REGISTRY`, and a real `pnpm licenses list --prod` run — closing with one concrete action item (a source-availability notice around the firmware download) and a re-run trigger.

## Task Commits

Each task was committed atomically, with Task 1 following the RED/GREEN TDD cycle:

1. **Task 1: Retention records what it deleted, and when**
   - `7edbbac` (test) — failing tests for the retention record and `buildIdFromKey`
   - `d224811` (feat) — `QueueRunner.maintain()` returns a `RetentionRecord`, gated on what was reaped
2. **Task 2: Postgres backups and a restore drill that actually runs** — `f730d59` (feat)
3. **Task 3: The QMK and bundled-asset licensing review** — `2260bb5` (docs)

## Files Created/Modified

- `services/worker/src/queue-runner.ts` — `RetentionRecord`/`RetentionObjectRecord`/`RetentionOutcome` types, `QueueRunnerEvent.retention`, and `maintain()`'s new return shape and blob-loop restructure
- `services/worker/src/queue-runner.test.ts` — log-capturing harness plus five new `maintenance` test cases covering the retention record's presence, content, failure survival, already-absent distinction, and idempotence
- `packages/artifact-store/src/keys.ts` — `buildIdFromKey()`
- `packages/artifact-store/src/store.test.ts` — round-trip and rejection tests for `buildIdFromKey`
- `packages/artifact-store/src/index.ts` — export `buildIdFromKey`
- `infra/deploy/backup.sh` — Postgres backup script
- `infra/deploy/restore-drill.sh` — restore drill with row-count parity assertion
- `docs/runbooks/backup-restore.md` — backup/restore/retention-question runbook
- `docs/licensing-review.md` — QMK and dependency licensing review

## Decisions Made

- **Prefer the compose postgres container's `pg_dump`/`pg_dumpall`/`pg_restore` over a local client, whenever that service is running** (not only when a local client is absent, as the plan's action text literally framed it). Found during Task 2 verification: this environment's host `pg_dump`/`pg_restore` is version 17 against the project's pinned Postgres 16, and a version-17 `pg_restore` unconditionally issues `SET transaction_timeout = 0` — a GUC the 16 server rejects — breaking the restore regardless of which client produced the dump. Routing both directions through the container's exactly-matched client avoids the whole class of bug rather than only the one predicate named in the plan.
- **Retention record objects name build ids, never storage keys.** `buildIdFromKey` converts and validates; a test asserts the emitted event's JSON never contains a `builds/`-prefixed substring.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] pg_dump/pg_restore client-vs-server version mismatch broke the restore drill**
- **Found during:** Task 2, manual verification against the dev database
- **Issue:** The plan's action text said to "support running the tools inside the compose container ... when a local pg_dump is absent." This machine has a local `pg_dump`/`pg_restore` (v17), but the dev Postgres server is v16 (per `docker-compose.yml`). A v17 `pg_restore` issues `SET transaction_timeout = 0` while restoring — a GUC introduced in PostgreSQL 17 — and the v16 server rejects it, aborting the restore with `set -e` even though `pg_restore` itself treats the failure as a non-fatal warning.
- **Fix:** Changed the tool-selection logic in both `backup.sh` and `restore-drill.sh` to prefer running `pg_dump`/`pg_dumpall`/`pg_restore` inside the compose `postgres` container whenever that service is detected running (`docker compose ps --status running --services`), falling back to a local client only when the compose service is not running. `restore-drill.sh`'s containerized `pg_restore` streams the dump in over stdin, since the container has no access to the host filesystem.
- **Files modified:** `infra/deploy/backup.sh`, `infra/deploy/restore-drill.sh`
- **Verification:** Backup + restore-drill both exit 0 with real row-count parity against the dev database; re-verified with a deliberate mismatch (non-zero exit, scratch database still dropped).
- **Committed in:** `f730d59`

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug).
**Impact on plan:** Necessary for correctness — without this fix, the restore drill's `<verify>` command fails outright on any host whose installed Postgres client tools are newer than the pinned server, which is exactly the situation this execution environment is in. No scope creep: the fix stays inside the two files the plan already declared.

## Issues Encountered

None beyond the deviation above, which was resolved inline during Task 2.

## User Setup Required

None — no external service configuration required. `infra/deploy/backup.sh` and `infra/deploy/restore-drill.sh` were exercised against the existing dev `docker-compose.yml` Postgres instance with no new setup.

## Next Phase Readiness

`REQ-backup-retention-controls`'s retention-accountability and backup/restore half is closed by this plan. The other half — dependency and image vulnerability scanning — is explicitly deferred to 05-06 per this plan's `<planner_notes>`, since that lands as a CI job on the runner that already holds the build image. `docs/licensing-review.md`'s one open action item (a source-availability notice around the firmware download response) is not blocking for this phase but should be picked up before public deployment, per its own re-run trigger. No blockers for subsequent Phase 5 plans.

---
*Phase: 05-hardening-and-scale*
*Completed: 2026-09-03*

## Self-Check: PASSED

- All key files present on disk: `infra/deploy/backup.sh`, `infra/deploy/restore-drill.sh`, `docs/runbooks/backup-restore.md`, `docs/licensing-review.md`, `services/worker/src/queue-runner.ts`, `packages/artifact-store/src/keys.ts`.
- All four task commits (`7edbbac`, `d224811`, `f730d59`, `2260bb5`) confirmed in `git log`.
- Re-ran acceptance criteria: `pnpm typecheck` clean; `pnpm test` 435/435 passing; `infra/deploy/backup.sh var/backups` followed by `infra/deploy/restore-drill.sh <dir>` both exit 0 against the dev database with per-table parity lines; `git check-ignore var/backups` succeeds.
