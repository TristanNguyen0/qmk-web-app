---
phase: 05-hardening-and-scale
plan: 08
subsystem: docs
tags: [readme, deployment, documentation, closure]

# Dependency graph
requires:
  - phase: 05-hardening-and-scale
    provides: "05-01 through 05-07's shipped work — this plan's job is to make README and a new deployment-requirements document true against what actually landed"
provides:
  - "README.md § Known gaps rewritten to match the tree: three bullets replaced (smoke matrix, launch identity, abuse controls), one left unchanged as still true (end-to-end browser tests), two left unchanged as Phase 4's (SOCD), two left unchanged as deliberate ADR-0004 deferrals (artifact storage, LISTEN/NOTIFY)"
  - "docs/deployment-requirements.md — the single document listing everything a deployment must provide (session secret, trusted proxy hop, optional OTLP collector, log sink retention, Postgres backup/restore cadence, CI runner and branch protection, the identity constraint), each with its failure mode and loudness, closing with a tunable-limits table"
  - "README.md operations section now links docs/deployment-requirements.md"
affects: [phase-05-close-out, any-future-phase-reading-README-Known-gaps-as-ground-truth]

actuals:
  tokens: 4972
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Deployment prerequisites collected into one document, each stated as what must be provided / what fails without it / how loudly, rather than scattered across runbooks, ADRs, and a source-file header"

key-files:
  created:
    - docs/deployment-requirements.md
  modified:
    - README.md

key-decisions:
  - "The interrupted first executor left both tasks' README edits interleaved in one uncommitted working-tree change (Known gaps rewrite for Task 1, and the operations-section link plus deployment-requirements.md for Task 2). Rather than attempt a retroactive split that risked mis-attributing lines, the orchestrator preserved them as one commit (cc567d9), and that departure from atomic-commit-per-task is recorded here rather than silently normalized."
  - "During close-out verification, found and fixed a genuine factual error outside either task's declared scope: README's Checks section still read 'pnpm test # 357 tests, no Docker required', a figure dated from the end of Phase 4 (commit 683270f) that Phase 5's own plans (05-01 through 05-07 collectively added session, config, observability, and matrix-fixtures tests) made stale by ~140 tests. Corrected to the real count (496) as a Rule 1 auto-fix, verified against a real pnpm test run in this worktree."

patterns-established: []

requirements-completed: [REQ-hardening-abuse-controls, REQ-observability-telemetry, REQ-smoke-matrix, REQ-backup-retention-controls, REQ-launch-identity-model]

coverage:
  - id: D1
    description: "README § Known gaps states what is actually true of the tree after Phase 5 — every closed gap verified against the code before its bullet was removed, every still-true gap retained unchanged"
    requirement: "REQ-smoke-matrix"
    verification:
      - kind: other
        ref: "node -e assertion from 05-08-PLAN.md Task 1's <verify>: smoke-matrix gap no longer claims the matrix doesn't exist; end-to-end-browser-tests bullet still present"
        status: pass
      - kind: other
        ref: "git show cc567d9 -- README.md: confirmed the two SOCD bullets, the artifact-storage bullet, and the LISTEN/NOTIFY bullet are byte-identical to the pre-Phase-5 tree; confirmed MODULE_REGISTRY.verifiedFor unchanged since Phase 4 (git log -- packages/domain/src/module-registry.ts)"
        status: pass
    human_judgment: false
  - id: D2
    description: "docs/deployment-requirements.md exists, covers all seven requirement areas (session secret, trusted proxy, OTLP collector, log sink retention, Postgres backup/restore, CI runner and branch protection, identity constraint), states each requirement's failure mode and loudness, and is linked from README's operations section"
    requirement: "REQ-backup-retention-controls"
    verification:
      - kind: other
        ref: "node -e assertion from 05-08-PLAN.md Task 2's <verify>: all six required substrings present in the document, README links it"
        status: pass
      - kind: other
        ref: "manual file-existence check on every runbook/ADR the document references (backup-restore.md, observability.md, ci-runner.md, adr/0004, adr/0006) — all present"
        status: pass
    human_judgment: true
    rationale: "The plan's own <human-check> for Task 2 asks a reader with no prior context to list everything they'd need to stand the service up from this document alone — that read-as-a-stranger judgment call is not something an automated check can substitute for."

duration: 25min
completed: 2026-09-03
status: complete
---

# Phase 5 Plan 8: Documentation closure — README Known gaps and deployment requirements Summary

**README § Known gaps rewritten to match the Phase 5 tree (three bullets replaced, four left untouched because they are still true), and a new `docs/deployment-requirements.md` consolidating everything a deployment must provide — each requirement stated with what fails without it and how loudly.**

## Performance

- **Duration:** ~25 min (this close-out session: reading, verification, one fix, this SUMMARY)
- **Started:** 2026-09-03T19:41:00Z (approx.)
- **Completed:** 2026-09-03T20:05:00Z (approx.)
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- **Task 1 — README § Known gaps brought into line with the tree.** Bullet by bullet:
  - The smoke-matrix bullet now states the real matrix size (4 keyboards), the actual toolchain coverage (three MCU families, four bootloaders, 2,670 of 3,743 supported keyboards / ~71%), and the still-open criterion-3 gap (only one member has a multi-position layout), tracked in `.planning/WINDOWS.md`. Matches `docs/matrix-selection.md` exactly (verified figure-by-figure).
  - The identity bullet now links [ADR 0006](docs/adr/0006-anonymous-only-launch-identity.md) and states it as a recorded launch decision, retaining both real consequences (work lost on clearing cookies; no second-device access).
  - The abuse-controls bullet now states both new controls — `BUILD_LIMITS.maxGlobalActiveBuilds = 8` and `SESSION_LIMITS.issuancePerIpPerHour = 120` (both verified against `packages/domain/src/limits.ts`) — and retains the per-process caveat on the session-issuance counter.
  - The end-to-end-browser-tests bullet is unchanged (still true).
  - The two SOCD bullets, the artifact-storage bullet, and the LISTEN/NOTIFY bullet are byte-identical to before this phase — confirmed via `git show cc567d9 -- README.md` and confirmed `MODULE_REGISTRY.verifiedFor` has not changed since Phase 4 (`git log --oneline -- packages/domain/src/module-registry.ts` shows only Phase 4 commits).
  - The security-properties section above § Known gaps was updated: the old "per-session quotas" line now correctly describes the atomic multi-cap admission decision, with a pointer to the new deployment-requirements document.
- **Task 2 — `docs/deployment-requirements.md` written.** Covers, each with what must be provided / what fails without it / how loud the failure is: `QWA_SESSION_SECRET` (loud, no fallback anywhere); the trusted reverse-proxy hop and `QWA_TRUST_PROXY` (loud if unset in production; silent, in two opposite directions, if the proxy is misconfigured — both directions stated explicitly); `QWA_OTEL_EXPORTER_URL` and a collector (optional, inert when unset); a log sink and its retention window (silent failure, with the `retention_events` revisit trigger); a Postgres backup schedule and restore-drill cadence (silent until a restore is actually needed); a CI runner and branch protection (nothing merges if the runner is offline); and the identity constraint from ADR 0006. Closes with a tunable-limits table (global build cap, session-issuance limit, matrix size cap) matching `packages/domain/src/limits.ts` and `docs/matrix-selection.md` exactly. README's operations section now links it.
- **Close-out verification (this session):** ran `pnpm typecheck` (clean) and `pnpm test` (34 files, 496 passed, 1 skipped — the Postgres-only describe block, correctly skipped with no local database reachable) to confirm the committed documentation changes broke nothing. Checked every relative link added by this plan resolves to a file that exists (`docs/matrix-selection.md`, `docs/adr/0006-...`, `docs/adr/0004-...`, `docs/runbooks/backup-restore.md`, `docs/runbooks/observability.md`, `docs/runbooks/ci-runner.md`, `apps/api/migrations/003_worker_role.sql`, `apps/api/src/server.ts`, `apps/api/src/config.ts`, `packages/domain/src/limits.ts`, `infra/deploy/docker-compose.yml`, `infra/deploy/backup.sh`, `infra/deploy/restore-drill.sh`) — all present. Re-ran both plan-level automated `<verify>` node scripts (Task 1 and Task 2) directly — both pass. Verified `apps/api/src/config.ts`'s `parseTrustProxy`/`requireEnv` and `apps/api/src/server.ts`'s startup-guard behavior match the document's descriptions word-for-word (accepted forms, boolean rejection, the generation command).

## Task Commits

Task 1 and Task 2 were preserved as one commit rather than split retroactively — see Deviations below for why.

1. **Tasks 1 & 2: README known-gaps rewrite + deployment-requirements.md (combined)** - `cc567d9` (docs)

Plus this close-out session's own work:

2. **Verification fix: stale test count in README** - `ff98b8d` (fix)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `docs/deployment-requirements.md` - New document: seven deployment-requirement areas, each with failure mode and loudness, closing with a tunable-limits table
- `README.md` - § Known gaps rewritten (three bullets replaced, four retained unchanged); security-properties section updated; operations link to the new document added; stale test count corrected (this session)

## Decisions Made

- **Single combined commit for Tasks 1 and 2, not split retroactively.** The interrupted first executor left both tasks' README edits interleaved in one uncommitted working-tree change before an account rate limit killed it. The orchestrator reviewed and preserved that work as-is; attempting to split it after the fact into two commits risked mis-attributing which lines belonged to which task, when the actual edits genuinely touched the same file for related reasons (both tasks add to README's operations/Known-gaps material). This is recorded as a deviation from the atomic-commit-per-task rule, not silently normalized.
- **Fixed a stale test count found during verification, outside either task's declared scope.** README's Checks section read "357 tests" — a figure set at the end of Phase 4, unchanged through all of Phase 5's plans even as they collectively added ~140 tests (496 by this session's `pnpm test` run). Task 1's scope is specifically § Known gaps and the security-properties section immediately above it; the Checks section is a different part of the same file. Fixed as a Rule 1 (bug — factual inaccuracy) auto-fix rather than left for a future plan, since this session's own explicit verification instructions called for checking factual claims against the tree, and README's job is being true.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale test count in README's Checks section**
- **Found during:** close-out verification (this session), while running `pnpm test` to confirm the committed documentation changes broke nothing
- **Issue:** `README.md` line 144 read `pnpm test # 357 tests, no Docker required` — a count set in Phase 4's closing commit (`683270f`, confirmed via `git log -p -S"357 tests" -- README.md`) and never updated as Phase 5's plans (05-01 through 05-07) added session, config, observability, and matrix-fixtures test files.
- **Fix:** Updated the line to `pnpm test # 496 tests, no Docker required`, matching the actual `pnpm test` run in this worktree (34 files, 496 passed, 1 skipped — the skip is the Postgres-only describe block in `store-contract.test.ts`, correctly skipped with no local database reachable, consistent with "no Docker required").
- **Files modified:** `README.md`
- **Verification:** `pnpm test` run directly in this worktree, output matches the corrected number exactly.
- **Committed in:** `ff98b8d`

### Not a deviation, but recorded per this session's instructions

**Task 1 and Task 2's README edits were preserved as a single commit (`cc567d9`) rather than one commit per task**, because the interrupted first executor's uncommitted work already had them interleaved. See Decisions Made above.

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug), plus 1 documented commit-structure departure (not a code deviation).
**Impact on plan:** The test-count fix is a pure factual correction with no behavior change. The single-commit structure has no functional impact — both tasks' acceptance criteria are independently verified to pass regardless of how the work is committed.

## Issues Encountered

None beyond the deviation above.

## Truthfulness verification (this session)

Checked explicitly against the four things Phase 5 did not earn, per this session's instructions:

1. **SOCD hardware verification** — not claimed anywhere in README or `docs/deployment-requirements.md`. README's existing "on-hardware verification is still outstanding" line (Status section, unrelated to this plan's files) was left untouched, and is itself correct — confirmed no `04-05-SUMMARY.md` exists.
2. **CI merge gate proven blocking** — `docs/deployment-requirements.md` states explicitly: "it has been authored and reasoned about, but it has not yet been observed blocking a real pull request," matching `05-06-SUMMARY.md`'s `status: partial` and the open row in `05-VALIDATION.md`. README's smoke-matrix bullet states the same thing in its own words ("that gate has not yet been exercised against a real pull request").
3. **Live OTLP export** — `docs/deployment-requirements.md` states the OTLP collector is optional and unset is "a fully supported state" with telemetry fully inert; no claim of having verified against a live collector anywhere.
4. **The pinned image's Go-toolchain CVE** — `docs/deployment-requirements.md` documents it explicitly as "a known, currently-open finding, not a defect in the workflow," stating the `scan` job will trip on the next gated-path pull request until the image is refreshed.

Also confirmed: the smoke-matrix diversity criterion (only 1 of 4 members has a multi-position layout) is stated in both README and `docs/deployment-requirements.md`'s referenced `docs/matrix-selection.md`, and tracked as open item #2 in `.planning/WINDOWS.md`. The session-issuance limit's per-process multiplication caveat is stated in both documents. No overclaim found beyond the one factual staleness fixed above (which was an understatement of test coverage, not an overclaim of capability).

## User Setup Required

None - no external service configuration required. This plan is documentation-only.

## Next Phase Readiness

- Phase 5's DOC-tier accountability is closed: every requirement's README-facing gap statement matches the tree, and the deployment prerequisites this phase introduced are collected in one document.
- Three items remain genuinely open and are correctly represented as such in both documents, tracked in `.planning/WINDOWS.md` and `05-VALIDATION.md`: the CI merge gate has not been observed blocking a real PR (05-06 Task 4), the smoke matrix's layout-diversity criterion is unmet by one member, and the pinned build image carries a fixable high-severity CVE.
- `05-VALIDATION.md` was not edited by this plan, per its own instruction — that file remains owned by `/gsd-validate-phase`.
- Phase 5 is otherwise ready to close.

## Self-Check: PASSED

- `docs/deployment-requirements.md` confirmed present with `[ -f ]`.
- `README.md` confirmed present and modified as described.
- Both commits (`cc567d9`, `ff98b8d`) confirmed present via `git log --oneline`.
- Both plan-level automated `<verify>` node scripts (Task 1, Task 2) re-run directly in this session — both pass.
- `pnpm typecheck` and `pnpm test` (34 files, 496 passed, 1 skipped) re-run in this session — both clean.
- Every file referenced by a link added in this plan confirmed present via `[ -f ]`.
- Truthfulness constraints re-checked against both documents' actual text — no overclaim found.

---
*Phase: 05-hardening-and-scale*
*Completed: 2026-09-03*
