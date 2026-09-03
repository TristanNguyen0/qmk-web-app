---
phase: 05-hardening-and-scale
plan: 06
subsystem: ci
tags: [github-actions, self-hosted-runner, branch-protection, trivy, pnpm-audit, fork-pr-guard]

# Dependency graph
requires:
  - phase: 05-hardening-and-scale
    provides: "05-02's `pnpm run matrix` script (services/worker/scripts/run-matrix.ts) and infra/qmk/manifest.json — the matrix job invokes the former and asserts against the latter"
provides:
  - "The repository's first two workflows: .github/workflows/ci-fast.yml (job `fast`) and .github/workflows/ci-matrix.yml (jobs `changes`, `matrix`, `scan`, `matrix-result`)"
  - "docs/runbooks/ci-runner.md — runner registration, image-refresh process, offline procedure, branch-protection config, fork-PR controls"
  - "Branch protection on `main` requiring `matrix-result` and `fast` (operator-attested, Task 3)"
  - "vitest@^3.2.7 and targeted pnpm-workspace.yaml overrides clearing pre-existing high/critical audit findings that blocked Task 1's own acceptance criterion"
affects: ["any future pull request against this repository, which now runs `fast` and (path-gated) `matrix-result` as required checks", "the next attempt at Task 4, which needs `main` pushed to `origin` and either `gh` installed or the web UI"]

# Actuals (#2632)
actuals:
  tokens: 60000
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: ["vitest@^3.2.7 (root devDependency, up from 2.1.9)", "aquasec/trivy:0.74.0 (digest-pinned container image, not a marketplace action)"]
  patterns:
    - "Step-level fork-PR guard with explicit `exit 1` in single-job workflows (ci-fast.yml), vs. job-level `if:` + a separate always()-aggregator that fails explicitly on fork (ci-matrix.yml) — because a job-level `if:` alone reports 'success/skipped', which satisfies a required check"
    - "Assert-don't-rebuild: the matrix job compares the local Docker image against infra/qmk/manifest.json's name/tag/digest and fails loudly rather than ever running `docker build` in CI"
    - "Trivy invoked as a digest-pinned container image (two passes per target: full report, then a severity/unfixed-scoped gate) instead of a marketplace action, to avoid granting a third party the self-hosted runner's Docker socket"

key-files:
  created:
    - .github/workflows/ci-fast.yml
    - .github/workflows/ci-matrix.yml
    - docs/runbooks/ci-runner.md
  modified:
    - package.json (deviation: vitest bump)
    - pnpm-workspace.yaml (deviation: dependency overrides, new file)
    - vitest.config.ts (deviation: fileParallelism: false)
    - apps/api/src/routes/builds.test.ts (deviation: explicit delay to fix a vitest-3-exposed race)
    - pnpm-lock.yaml (deviation)

key-decisions:
  - "Both workflows run on the self-hosted runner, not just the matrix — the runner's Node/pnpm versions are the ones that actually build firmware, so a fast check on a different environment would prove something about a machine no artifact is ever produced on (plan's planner_notes, carried through unchanged)"
  - "The fork guard is a step-level explicit `exit 1` in ci-fast.yml (single job, no aggregator to fail on its behalf) but a job-level `if:` plus a separate always()-run `matrix-result` failure branch in ci-matrix.yml (matrix/scan have a legitimate skip case — not-applicable — that fast does not); documented in ci-runner.md's own words as the reason the two workflows use different granularities for the same guarantee"
  - "Scanning gates only on fixable high/critical findings, full report always printed — a 3.7GB toolchain image will always carry unfixable OS findings, and a permanently-red gate is one that gets disabled"
  - "vitest bumped to ^3.2.7 (deviation, not in this plan's declared files_modified) because Task 1's own acceptance criterion requires `pnpm audit --audit-level high` to pass locally as proof the fast-check workflow's contents are runnable, and pre-existing critical/high findings in vitest@2.1.9/vite@5.4.21/fast-uri blocked it before any workflow existed"

requirements-completed: []
requirements-partial: [REQ-smoke-matrix]

coverage:
  - id: D1
    description: "A pull request touching the generator, templates, QMK pin, or build image cannot merge without the curated smoke matrix compiling"
    requirement: "REQ-smoke-matrix"
    verification:
      - kind: unit
        ref: ".github/workflows/ci-matrix.yml `changes`/`matrix`/`matrix-result` job structure, read against RESEARCH.md Pattern 4/5"
        status: pass
      - kind: manual_procedural
        ref: "Task 4 — open a real gated-path pull request with a broken fixture and confirm the merge is blocked"
        status: not_performed
    human_judgment: true
  - id: D2
    description: "A documentation-only pull request is never blocked forever by a required check a path filter skipped"
    requirement: "REQ-smoke-matrix"
    verification:
      - kind: unit
        ref: "no `paths`/`paths-ignore` key on either workflow's `on:` trigger (verified by the plan's own automated <verify> node script); matrix-result's not-applicable branch"
        status: pass
      - kind: manual_procedural
        ref: "Task 4 case 1 — a real docs-only pull request observed to report matrix-result success"
        status: not_performed
    human_judgment: true
  - id: D3
    description: "A fork pull request cannot satisfy the gate by being skipped — it fails the check explicitly"
    requirement: "REQ-smoke-matrix"
    verification:
      - kind: unit
        ref: "ci-fast.yml step-level guard with exit 1; ci-matrix.yml matrix-result's explicit fork failure branch"
        status: pass
      - kind: manual_procedural
        ref: "no real fork pull request was opened against this repository in this run"
        status: not_performed
    human_judgment: true
  - id: D4
    description: "Container image and filesystem vulnerability scanning runs on the host holding the build image, gating on fixable high/critical findings"
    requirement: "REQ-backup-retention-controls"
    verification:
      - kind: unit
        ref: "ci-matrix.yml `scan` job — Trivy digest-pinned, two passes per target (image, filesystem), --severity HIGH,CRITICAL --ignore-unfixed on the gating pass"
        status: pass
    human_judgment: false
  - id: D5
    description: "Runner registered with labels self-hosted/qmk-build; fork-PR approval required for outside collaborators; branch protection on main requires matrix-result and fast"
    requirement: "REQ-smoke-matrix"
    verification:
      - kind: manual_procedural
        ref: "Operator attestation — replied \"runner registered\" to Task 3's resume-signal, confirming all three settings"
        status: pass
    human_judgment: true

duration: ~35min (commit span across deviation + Tasks 1-2; Task 3 attestation and this close-out add no further duration)
completed: 2026-09-03
status: partial
---

# Phase 05 Plan 06: CI Merge Gate (D-06/D-09) Summary — 3 of 4 tasks complete

**The repository's first CI: an always-on `fast` check (typecheck/test/audit) and a path-gated curated-matrix workflow with a fork-PR guard, an image-digest assertion, and Trivy scanning, both wired to run on a self-hosted runner the operator has now registered and protected `main` with — but the gate has not yet been watched block a real pull request.**

## Status: partial

Tasks 1, 2, and the pre-existing checkpoint Task 3 are done. **Task 4 — the only task that
proves the gate blocks on a real pull request — was not performed and is deferred to
user-acceptance testing by explicit operator decision.** This is the single most important fact
in this summary: everything described below is a correctly-authored gate that has been read and
reasoned about, not one that has been observed working end-to-end on GitHub. The "merge gate is
literally blocking" row in `05-VALIDATION.md` § Manual-Only Verifications remains **OPEN**. Do
not read anything below as evidence that row is closed — it isn't, and closing it requires the
real pull requests Task 4 specifies.

## Accomplishments

### Deviation: pre-existing dependency vulnerabilities blocking Task 1's own acceptance criterion

Before either workflow file was written, `pnpm audit --audit-level high` — one of Task 1's stated
acceptance criteria, run to prove the fast-check workflow's contents are actually runnable and
not merely well-formed YAML — failed against pre-existing findings that predate this plan
entirely:

- `vitest@2.1.9` carried a critical vulnerability (fixed at `>=3.2.6`); its transitive `vite@5.4.21`
  carried a high-severity `server.fs.deny` bypass (fixed at `>=6.4.3`). Bumped the root
  `vitest` devDependency to `^3.2.7` and pinned `vite` forward via a new `pnpm-workspace.yaml`
  overrides block.
- `fast-uri`, pulled in via three separate chains under fastify (`ajv`'s 3.x line,
  `@fastify/ajv-compiler`'s own 3.x dependency, and `fast-json-stringify`'s 4.x line), carried
  multiple high-severity host-confusion/SSRF advisories below `3.1.6`/`4.1.3` respectively. Pinned
  all three forward via targeted `pnpm-workspace.yaml` overrides (a single blanket override would
  break whichever major the other chain needs).

The vitest 3 bump exposed two previously-latent test races (confirmed absent under 2.1.9, present
under 3.2.7 across repeated runs), fixed as part of the same commit: an explicit delay between two
sequential build-listing requests in `apps/api/src/routes/builds.test.ts` (vitest 3's faster
in-process scheduling made two requests land in the same submillisecond `requestedAt` stamp, with
no tiebreaker in the "newest first" query — not a production concern, since no real HTTP round
trip is submillisecond), and `fileParallelism: false` in `vitest.config.ts` (several suites share
one live dev Postgres instance and were never file-isolated from each other's state, only lucky
under the older scheduler).

**None of `package.json`, `pnpm-workspace.yaml`, `vitest.config.ts`, or
`apps/api/src/routes/builds.test.ts` are in this plan's declared `files_modified`.** This is a
genuine scope expansion, made under deviation Rule 3 (blocking issue) because Task 1's own
acceptance criteria could not otherwise pass. Committed separately (`4f54086`) before Task 1's
workflow file, so the fast check's audit step is provably meaningful rather than gating against a
repository already carrying findings above its own threshold.

**Verified post-merge on `main`:** `pnpm audit --audit-level high` clean (2 moderate findings
remain, below the gate); `pnpm test` green at 496 passed / 1 skipped across 34 files.

### Task 1 — the always-on fast check (`4cd3c8a`)

`.github/workflows/ci-fast.yml`: single job `fast`, triggers on `pull_request` (no filter) and
`push` to `main`. Fork guard as an explicit **step-level** `exit 1` running before
`actions/checkout` — a job-level `if:` would report the job as skipped, which GitHub treats as a
success/neutral status that satisfies a required check; the previous executor's own draft caught
this and moved the guard to step level with an explicit failure. `permissions: contents: read`.
pnpm enabled via corepack reading the version from `package.json`'s `packageManager` field rather
than a marketplace `pnpm/action-setup`. Installs frozen-lockfile, brings up the development
Postgres from `infra/deploy/docker-compose.yml` before tests and tears it down in an `if: always()`
step, runs `pnpm typecheck`, `pnpm exec vitest run --reporter=verbose` (piped to a log file), then
a dedicated step that greps that log for the Postgres contract suite's self-skip message and fails
if found — so a database that silently wasn't reachable turns a green run red instead of quietly
skipping 05-01's admission-control concurrency assertions — then `pnpm audit --audit-level high`.
`timeout-minutes: 20` and a PR-keyed `concurrency` group with `cancel-in-progress: true`.

### Task 2 — the path-gated matrix, its guards, and the runner runbook (`b715d9f`)

`.github/workflows/ci-matrix.yml`: triggers unconditionally, same as `ci-fast.yml` — no `paths`
key on the trigger. Four jobs:

- **`changes`** (runs on `ubuntu-latest`, cheap, works even when the self-hosted host is offline):
  full-history checkout, inline `git diff` (no marketplace path-filter action) against the merge
  base (PR) or previous tip (push), matched against nine gated prefixes (`packages/qmk-generator/`,
  `packages/qmk-socd-module/`, `packages/domain/src/module-registry.ts`,
  `packages/domain/src/socd.ts`, `infra/qmk/`, `packages/qmk-sandbox/`, `services/worker/src/`,
  `services/worker/scripts/`, and the workflow file itself). Fails open toward `relevant=true` on
  any diff-computation error rather than ever silently skipping the gate.
- **`matrix`** (`runs-on: [self-hosted, qmk-build]`, `timeout-minutes: 60`): gated on
  `changes.outputs.matrix-relevant` AND the fork guard; asserts the local Docker image against
  `infra/qmk/manifest.json`'s name/tag/digest via `docker image inspect` and fails with both values
  named rather than rebuilding — no `docker build` step exists anywhere in either workflow; then
  runs `pnpm run matrix` (05-02's script).
- **`scan`** (same runner, same gate): Trivy `0.74.0` invoked as a digest-pinned container image
  (`aquasec/trivy@sha256:...`), never a marketplace action — one image pass and one filesystem
  pass each, full report first (nothing hidden), then a gating pass scoped to
  `--severity HIGH,CRITICAL --ignore-unfixed`.
- **`matrix-result`** (`ubuntu-latest`, `if: always()`, depends on all three others): the only job
  used as a required status check. Explicitly fails with a named message on a fork PR before
  looking at anything else; fails if `changes` itself didn't succeed; reports success with a
  not-applicable message when the diff wasn't gate-relevant; reports success when `matrix` and
  `scan` both succeeded; otherwise fails naming both jobs' results.

`docs/runbooks/ci-runner.md` covers all six required topics: registration and labels; the
docker-group-is-host-root-equivalent framing for why the runner runs unprivileged; the
assert-don't-rebuild image-refresh process (rebuild → record digest → commit manifest, entirely
outside CI); the runner-offline procedure (nothing merges; bring the runner back up, or record a
deliberate decision to lift the branch-protection requirement — never done silently); the
branch-protection configuration naming exactly `matrix-result` and `fast`, explicitly not `matrix`
itself; and the two independent fork-PR controls (repository approval setting + in-workflow guard)
with the explicit note that approval alone is a human control that can be socially engineered.

**Finding recorded in ci-runner.md and this summary:** the pinned `qmk-build:0.33.13-1` image
carries a real, fixable high-severity Go-toolchain CVE as of this writing. `scan` would currently
trip red on the next gated-path pull request. **This is the gate working as designed, not a bug in
the workflow** — the fix is the runbook's image-refresh process (rebuild, record the new digest in
`infra/qmk/manifest.json`, commit), never loosening the scan's severity/`--ignore-unfixed` filters
or adding a rebuild step to CI. Whoever runs Task 4 should expect `scan` to fail on the current
image until that refresh happens, independent of anything the matrix itself does.

### Task 3 — register the runner and turn on branch protection: COMPLETE (operator attestation)

This was a `checkpoint:human-action` requiring repository-admin steps no agent on this host can
perform or verify — `gh` is not installed here, and the settings live in GitHub's web UI. The
operator replied with the task's own resume signal, **"runner registered,"** confirming all three
items are done:

1. A self-hosted runner registered on the build host with labels `self-hosted` and `qmk-build`.
2. Fork pull request workflow approval set to require approval for all outside collaborators.
3. Branch protection on `main` requiring the status checks `matrix-result` and `fast`.

**This is recorded as complete on the operator's word alone.** There is nothing on this host —
no `gh`, no reachable GitHub API session — that can independently confirm any of the three, and
this summary makes no claim to have checked them.

## Task Commits

1. **Deviation (pre-Task-1):** `4f54086` — fix(05-06): patch pre-existing high/critical dependency vulnerabilities blocking the CI gate
2. **Task 1:** `4cd3c8a` — feat(05-06): add the always-on CI fast check (typecheck, tests, audit)
3. **Task 2:** `b715d9f` — feat(05-06): add the path-gated curated matrix workflow and runner runbook
4. **Task 3:** no commit — operator-performed repository settings, attested via resume-signal reply, nothing to commit from this host
5. **Task 4:** not performed — see below

## Outstanding: Task 4 — prove the gate blocks on a real pull request (UAT)

**Not attempted in this run.** Two hard blockers made it impossible from this host:

1. **`gh` CLI is not installed** — no scriptable way to open, inspect, or close pull requests from
   here.
2. **Local `main` is 91 commits ahead of `origin/main`.** The workflows added by this plan (and
   everything else in phases 4-5) have never reached GitHub. Pushing solely to unblock Task 4 would
   publish two unverified phases at once — the operator explicitly chose to defer Task 4 to
   user-acceptance testing rather than do that.

**Prerequisites for whoever runs Task 4 later:**

- Push local `main` to `origin/main` (a deliberate decision, not a side effect of this task).
- Either install the `gh` CLI on the host that will run this, or perform the three PR
  operations through the GitHub web UI instead — Task 4's action doesn't require `gh` specifically,
  only *some* way to open/inspect/close pull requests against the real repository.

**The three cases to run, exactly as the plan specifies (05-06-PLAN.md Task 4):**

1. **Case 1 — not applicable.** Branch changing only a documentation file (a file outside all nine
   gated prefixes listed above), pushed, PR opened. Expect: `changes` job outputs
   `matrix-relevant=false`; `matrix` and `scan` are skipped; `matrix-result` succeeds with the
   explicit not-applicable message; the PR shows as mergeable. This is the case
   RESEARCH.md Pitfall 2 warns goes wrong if the trigger itself were path-filtered instead.
2. **Case 2 — gated and failing.** On a second branch, edit
   `services/worker/scripts/fixtures/smoke.ts` to reference a keyboard id not in the published
   catalog (the smallest honest break — the matrix runner reports failures per-fixture). Open a
   PR. Expect: `changes` outputs `true`; `matrix` runs on a runner labelled `qmk-build` and fails;
   `matrix-result` fails; **GitHub reports the PR as not mergeable** — note exactly what the merge
   button says, since that wording is the evidence this row closes on. **Also expect `scan` to
   fail independently right now**, per the pinned-image CVE finding above, until the image-refresh
   process has been run — that failure is not a defect in this plan's workflow.
3. **Case 3 — gated and passing.** On the same branch, revert the fixture break (diff still
   touches a gated path). Expect: `matrix` runs and passes; `scan` passes (assuming the image has
   been refreshed per the finding above, or the CVE has otherwise been resolved); `matrix-result`
   succeeds; the PR becomes mergeable.

Close both scratch PRs and delete their branches afterward — a deliberately broken fixture merged
by accident is explicitly called out in the plan as the worst possible outcome of running this
task. Confirm `services/worker/scripts/fixtures/smoke.ts` on `main` ends up byte-identical to what
05-02 produced.

**Once run, record in the SUMMARY** (this file, updated, or a follow-up note) the three run URLs,
which jobs ran/skipped in each, and the final `matrix-result` status per case — that record is
what closes the "merge gate is literally blocking" row in `05-VALIDATION.md` § Manual-Only
Verifications, citing the case-2 run specifically. **This close-out summary does not edit
`05-VALIDATION.md`** — that file is owned by `/gsd-validate-phase`, per the plan's own instruction.

## Deviations from Plan

### Auto-fixed / scope-expanded

**1. [Rule 3 - Blocking issue] Pre-existing dependency vulnerabilities blocked Task 1's acceptance criterion**

See "Deviation: pre-existing dependency vulnerabilities" above for full detail. Files outside this
plan's declared `files_modified` (`package.json`, `pnpm-workspace.yaml`, `vitest.config.ts`,
`apps/api/src/routes/builds.test.ts`, `pnpm-lock.yaml`) were touched because `pnpm audit
--audit-level high` — one of Task 1's own stated acceptance criteria — could not otherwise pass.
Commit: `4f54086`.

**2. [Correctness fix, found and fixed during Task 1's own drafting] Job-level fork guard would have satisfied a required check via a skipped status**

The previous executor's own working draft initially guarded `ci-fast.yml`'s self-hosted job with a
job-level `if:`. Caught before commit: GitHub Actions reports a job skipped by a job-level `if:`
as success/neutral, which *satisfies* a required check — meaning a fork PR could have passed
`fast` without ever running typecheck, test, or audit. Moved to a step-level guard with an explicit
`exit 1`, run before `actions/checkout` so a fork PR's code is never checked out onto the runner.
Landed as part of `4cd3c8a`, not as a separate fix commit — no incorrect version was ever
committed.

**3. [Operational finding, not a code deviation] Pinned build image carries a real high-severity CVE**

`qmk-build:0.33.13-1` currently carries a fixable high-severity Go-toolchain finding. `scan` will
trip on the next gated-path pull request until the image is refreshed via `ci-runner.md`'s
process. Documented in the runbook and in Task 4's outstanding-work section above so whoever runs
Task 4 isn't surprised by a `scan` failure that has nothing to do with the fixture they're testing.

### Not performed (not a deviation — explicit operator decision)

Task 4 was not executed. See "Outstanding: Task 4" above.

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired data sources were introduced by
this plan's shipped files.

## Threat Flags

None beyond what the plan's own `<threat_model>` already registers (T-05-28 through T-05-34), all
of which Tasks 1-2 mitigate as designed. No new security-relevant surface was introduced outside
that register.

## Open Item Inherited from 05-02 (not addressed by this plan)

`.planning/WINDOWS.md` id 2 (open): the curated smoke matrix's criterion 3 ("at least two members
with a real multi-position layout") is unmet by the current 4-member set — only `crkbd/rev1` has a
multi-position layout; the other three (`handwired`/`onekey` variants) are single-position
toolchain-diversity probes. This plan gates *whatever* the matrix contains; it does not change the
matrix's membership. Left open for a future deliberate addition, as already recorded.

## User Setup Required

Task 3's three items (runner registration, fork-PR approval setting, branch protection) — see
"Task 3 — register the runner and turn on branch protection" above. Completed by the operator,
attested via resume-signal reply; not independently verifiable from this host.

## Next Phase Readiness

Not ready to close this plan. Task 4 is the only remaining task, and it requires pushing `main` to
`origin` (a decision beyond this plan's scope) plus either `gh` or web-UI access. Until Task 4
runs, `05-VALIDATION.md`'s "merge gate is literally blocking" row stays open, and REQ-smoke-matrix
should be treated as partially, not fully, satisfied.

---
*Phase: 05-hardening-and-scale*
*Completed: 2026-09-03 (partial — Tasks 1-3 of 4)*
