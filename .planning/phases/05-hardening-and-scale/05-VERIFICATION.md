---
phase: 05-hardening-and-scale
verified: 2026-09-04T00:07:21Z
status: human_needed
score: 11/13 must-haves verified
behavior_unverified: 2
overrides_applied: 0
behavior_unverified_items:
  - truth: "An operator can see queue depth, build throughput, failure classification, and worker liveness from exported OpenTelemetry-compatible telemetry, with redaction applied to every sink (Success Criterion 2)"
    test: "Set QWA_OTEL_EXPORTER_URL to a real OTLP/HTTP collector endpoint (the OpenTelemetry Collector, Grafana Alloy, or a vendor agent), start the API and worker, run a handful of builds through to terminal states (succeeded, failed, cancelled), and confirm the collector actually receives qwa.builds.queue_depth, qwa.builds.completed, qwa.builds.failed, and qwa.worker.heartbeat with service.name distinguishing the two processes."
    expected: "All four signals arrive at the collector with correct instrument names, closed-enum attribute values, and no free-text/IP/path content in any attribute."
    why_human: "No OTLP collector is available to this verifier or to the executor that built this (WINDOWS.md item 3, deliberately deferred). The SDK bootstrap, allowlist, and worker-side redaction pass are unit-tested against an in-memory OTel exporter — proving the internal plumbing is correct — but no metric has ever left this codebase over the network to a real collector. 'Exported' is the one word in the criterion that has genuinely never been exercised."
  - truth: "A change to the generator, templates, QMK pin, or build image cannot merge without the curated smoke matrix compiling (Success Criterion 3)"
    test: "Push this repository to origin, open a real pull request that edits a gated path (e.g. services/worker/scripts/run-matrix.ts) with a deliberately broken fixture, and confirm GitHub's branch protection blocks the merge until matrix-result and fast both report success; separately confirm a docs-only PR is not blocked forever and a fork PR fails the gate rather than skipping it."
    expected: "The PR is unmergeable while the required checks are red or absent; a docs-only PR reports a passing matrix-result promptly; a fork PR's matrix-result fails explicitly."
    why_human: "The local branch is 102 commits ahead of origin/main and gh is not installed on this host, so Task 4 of 05-06 (proving the gate blocks a real PR) was never performed — this is 05-06-SUMMARY.md's own status: partial. The workflow YAML is well-constructed (fork guard, always-report aggregator, image-digest assertion, no paths: filter on the trigger — all independently re-read and confirmed by this verification) and the matrix itself compiled for real in 05-02, but 'cannot merge' is a GitHub repository-setting behavior no codebase inspection can prove."
coincidental_reliance_items: []
gaps: []
deferred: []
human_verification:
  - test: "Point QWA_OTEL_EXPORTER_URL at a live OTLP collector, run builds through to terminal states, and confirm queue depth, throughput, failure classification, and worker liveness all arrive with correct attributes and no leaked content."
    expected: "All four signals visible at the collector; redaction holds under whatever the build/log content actually is at the time."
    why_human: "No collector was available in this environment or the original execution; see behavior_unverified_items above."
  - test: "Open a real GitHub pull request against this repository that touches a gated path with a broken fixture, and confirm the required-status-check merge gate actually blocks it; also confirm the fork-PR and docs-only-PR cases."
    expected: "Broken-fixture PR blocked; docs-only PR passes; fork PR fails explicitly rather than being skipped."
    why_human: "Repository has never been pushed to origin in a state that let this be exercised; see behavior_unverified_items above."
---

# Phase 5: Hardening and Scale Verification Report

**Phase Goal:** "The application is safe to expose to people who are not the developer who built it."
**Verified:** 2026-09-04T00:07:21Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (source) | Status | Evidence |
|---|---|---|---|
| 1 | SC1: A burst of build requests is absorbed by a global concurrency limit + queue backpressure, returning `BUILD_QUEUE_LIMITED` | ✓ VERIFIED | `packages/build-queue/src/postgres-store.ts` `create()` runs inside one `pg_advisory_xact_lock`-serialised transaction; admission predicates re-expressed as `WHERE` clauses on the `INSERT` itself. `BUILD_LIMITS.maxGlobalActiveBuilds = 8` confirmed in `packages/domain/src/limits.ts`. `assertWithinQuota` confirmed absent from the entire tree (`grep` returns nothing). `apps/api/src/routes/builds.ts` maps `outcome: 'rejected'` to `BUILD_QUEUE_LIMITED`/429 with `globalCapacityMessage()` — verified worded as capacity-busy, never blaming the caller. Real-Postgres concurrency proof exists in `store-contract.test.ts` (5 iterations × N-simultaneous-vs-cap-K, exact-not-approximate, per 05-01-SUMMARY.md). |
| 2 | SC1 sub-claim: IP-scoped session-issuance rate limiting exists and never locks out a returning cookie-holder or a session-exempt route | ✓ VERIFIED | `SESSION_LIMITS.issuancePerIpPerHour = 120` in `packages/domain/src/limits.ts`. Ran `apps/api/src/session.test.ts` directly (22/22 pass): issuance-limit boundary, non-lockout of `/health` and the read-only catalog once over limit, never-rate-limits-a-valid-cookie, no-address-leak-in-refusal. |
| 3 | SC1 prohibition: no client IP is ever persisted or logged, only held in memory as a rate-limit key | ✓ VERIFIED | `grep` for `.ip` usage across `apps/api/src` and `services/worker/src` shows exactly one live use — `keyGenerator: (req) => req.ip` in `session.ts`'s in-memory rate-limit hook. `apps/api/src/observability/attributes.ts`'s closed allowlist has no IP-shaped key. **Independently confirmed the post-review fix (CR-01):** `server.ts` now passes `PRODUCTION_LOGGER_OPTIONS` (custom `serializers.req` returning only `{method, url}`) instead of `logger: true`; ran `apps/api/src/app.test.ts`'s "production request logging (CR-01 regression)" test directly — passes, building the app with logging enabled and asserting no IP appears in any captured log line. |
| 4 | SC1/security prohibition: a malformed percent-encoded session cookie must not crash any route, including `/health` | ✓ VERIFIED | **Independently confirmed the post-review fix (CR-02):** `session.ts`'s `readCookie()` now wraps `decodeURIComponent` in try/catch returning `null`. Ran the 6 new regression tests in `session.test.ts` directly (all pass) covering `%`, `%zz`, `%E0%A4` against both `/health` and the issuance-limit path. |
| 5 | SC2: An operator can see queue depth, build throughput, failure classification, and worker liveness from exported OpenTelemetry-compatible telemetry, with redaction applied to every sink | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | All four named instruments exist and are wired to real data, not stubs: `qwa.builds.queue_depth` reads `BuildRepository.countActiveGlobal()` (05-01's real admission-count query) via an `ObservableGauge` callback in `apps/api/src/observability/metrics.ts`; `qwa.builds.completed`/`qwa.builds.failed`/`qwa.worker.heartbeat` are called from real call sites in `services/worker/src/queue-runner.ts` (build terminal-state transitions and every `runOnce()`/`maintain()` tick), not from test-only code. Attribute allowlist (`telemetryAttributes()`) throws on any out-of-set key/value. Worker-side string attributes pass through `redactAttributes()` before being handed to the counter/histogram — confirmed by direct `grep` of call sites in `services/worker/src/observability/metrics.ts`. SDK bootstrap/idempotency/exporter-failure-non-fatal all unit-tested against a real `MeterProvider` + `InMemoryMetricExporter` (`otel.test.ts`, read directly). **What is unverified:** no metric has ever left this codebase over the network to a live OTLP collector — `QWA_OTEL_EXPORTER_URL` has only ever been set in tests that immediately swap in an in-memory exporter. See `behavior_unverified_items`. |
| 6 | SC3: A change to the generator, templates, QMK pin, or build image cannot merge without the curated smoke matrix compiling | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `.github/workflows/ci-matrix.yml` and `ci-fast.yml` read directly and confirmed well-built: no `paths:` filter on either trigger (path-relevance is a job-level condition fed by a `changes` job, per D-09); a step-level fork-PR guard in `ci-fast.yml` and a job-level guard plus an `if: always()` `matrix-result` aggregator in `ci-matrix.yml` that fails explicitly (not skips) on a fork PR; an image-digest assertion against `infra/qmk/manifest.json` that fails loudly rather than rebuilding; Trivy invoked as a digest-pinned container image gating on fixable high/critical only. The matrix itself compiled for real in 05-02 (8/8 fixtures, one reproducibility assertion, against the pinned image). **What is unverified:** the actual merge-blocking behavior on GitHub. `git status` confirms `main` is 102 commits ahead of `origin/main`; `gh` is not installed on this host. 05-06-SUMMARY.md's own frontmatter records `status: partial` and marks Task 4 (open a real gated-path PR with a broken fixture, confirm merge is blocked) `not_performed` for all three of its manual-only coverage rows. See `behavior_unverified_items`. |
| 7 | SC3 supplementary: curated matrix membership is diverse enough to be a meaningful sample, not just a toolchain smoke test | ⚠️ Partially met, documented not hidden | `docs/matrix-selection.md` (read directly): 4 members, 3 MCU families, 4 bootloaders, 2,670/3,743 (~71%) of catalogued keyboards by `(processor, bootloader)` pair — verified arithmetic matches `catalogs/0.33.13-1/index.json`. Its own criterion 3 ("at least two members with a real multi-position layout") is **not met** — only `crkbd/rev1` qualifies; the other three are single-key `handwired/onekey/*` probes. This is documented in the doc itself, in `README.md` § Known gaps, and in `.planning/WINDOWS.md` (open item 2) rather than glossed over. Not a blocker to the phase goal on its own — the matrix still compiles for real and gates on real failures — but it is a real breadth shortfall against the plan's own six criteria. |
| 8 | SC4: An operator can restore configurations and artifacts from a backup | ✓ VERIFIED (independently re-run) | Independently executed `infra/deploy/backup.sh` and `infra/deploy/restore-drill.sh` against a live dev Postgres in this verification session (not merely trusting the SUMMARY): backup produced a `700`-permission directory containing `database.dump` (`pg_dump -Fc`) and `globals.sql`, both `600`; restore-drill created a scratch database, restored into it, and printed exact row-count parity (`0`/`0` on all four tables against an empty dev DB, as expected for a fresh container) and dropped the scratch database on exit. Matches the SUMMARY's claimed behavior exactly. |
| 9 | SC4: An operator can state what retention actually deleted and when | ✓ VERIFIED | `services/worker/src/queue-runner.ts`'s `maintain()` (read directly): emits a `RetentionRecord` gated on `reaped.artifactKeys.length + reaped.logKeys.length + reaped.buildsExpired > 0` — i.e. conditioned on what the database returned from `reap()`, never on blob-delete success, so a sweep that reaps rows and fails every blob delete still emits a record (each object gets `outcome: 'failed'` rather than being silently dropped). Each `RetentionObjectRecord` names a `buildId` via `buildIdFromKey()`, never the raw storage key. `reap()` in `postgres-store.ts` confirmed to use `DELETE ... RETURNING`, the concurrency-safe claim mechanism the plan's must-haves require. |
| 10 | SC4: Artifacts are deliberately not backed up, and the reasoning is documented | ✓ VERIFIED | `docs/runbooks/backup-restore.md` (read directly) states this explicitly with the reproducibility rationale (revision + catalog version + QMK commit + generator version + image digest). |
| 11 | SC4: A licensing review exists, derived from the tree | ✓ VERIFIED | `docs/licensing-review.md` (154 lines, read directly): GPL-2.0-or-later determination derived from a real SPDX survey of the pinned QMK checkout, `MODULE_REGISTRY` review, and a real `pnpm licenses list --prod` run — not a template or assumption. |
| 12 | SC5: The launch identity model is decided and recorded; anonymous-only's data-loss behaviour is visible in-product | ✓ VERIFIED | `docs/adr/0006-anonymous-only-launch-identity.md` (read directly) records the decision, restates the `ADR-0001-auth` "no code may assume `ownerId` is anonymous-only" constraint, and states the consequence without softening. `DataLossNotice` (read directly) is a genuinely zero-props component — no `dismiss` prop exists anywhere in its signature or `notices.ts` — rendered on both `apps/web/src/app/configurations/page.tsx` and `apps/web/src/components/KeymapEditor.tsx` (confirmed by `grep`). |
| 13 | SC5: A user can export a configuration and import it back as a new configuration, never overwriting an existing one | ✓ VERIFIED | `packages/domain/src/configuration-file.ts` (read directly): `parseConfigurationFile` reads exactly 8 named fields via an object-literal allowlist; every server-controlled field (`id`, `ownerId`, `revision`, `schemaVersion`, etc.) is structurally impossible to smuggle through, since the return object only ever assigns from the 8 named keys. `ImportConfigurationButton.tsx` (read directly) calls only `createConfiguration()`, never `updateConfiguration` — confirmed by reading the full file, no other API call exists in it. |

**Score:** 11/13 truths verified (2 present, behavior-unverified — both were already known, documented open items, not new findings)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/domain/src/limits.ts` | `maxGlobalActiveBuilds`, `SESSION_LIMITS` | ✓ VERIFIED | Both present with rationale comments |
| `packages/build-queue/src/postgres-store.ts` | Advisory-lock admission `create()` | ✓ VERIFIED | `pg_advisory_xact_lock`, predicate-on-INSERT confirmed |
| `services/worker/src/matrix-fixtures.ts` | `MatrixFixture`, `validateFixtureSet`, `missingSocdFixtures` | ✓ VERIFIED | All three exported (confirmed via AST-safe regex read — file contains an intentional literal `\0` delimiter byte that defeats naive `grep`) |
| `packages/domain/src/configuration-file.ts` | Versioned export envelope | ✓ VERIFIED | Field-allowlist parser, `CONFIGURATION_FILE_FORMAT_VERSION` |
| `services/worker/src/queue-runner.ts` | Retention record on `maintain()` | ✓ VERIFIED | Gated on reap() result, names build ids |
| `infra/deploy/backup.sh` / `restore-drill.sh` | Real, runnable backup/restore | ✓ VERIFIED | Independently re-executed in this session against live Postgres |
| `apps/api/src/config.ts` | `requireEnv`, `parseTrustProxy` | ✓ VERIFIED | Both present as pure functions; `trustProxy: true` explicitly rejected |
| `apps/api/src/observability/attributes.ts` (both processes) | Closed telemetry allowlist | ✓ VERIFIED | Throws on unknown key; no IP/session/path admitted |
| `.github/workflows/ci-fast.yml` / `ci-matrix.yml` | Merge-gating CI | ✓ VERIFIED (configured) / ⚠️ unproven (enforcing) | See truth #6 |
| `docs/deployment-requirements.md` | Consolidated deployment prerequisites | ✓ VERIFIED | 208 lines, 7 named sections, all cross-referenced runbooks/ADRs confirmed present |
| `README.md` § Known gaps | Matches the tree | ✓ VERIFIED | Read directly — honestly states the CI gate is "configured... but has not yet been exercised against a real pull request" and the criterion-3 breadth gap; unrelated bullets (SOCD, artifact storage, LISTEN/NOTIFY) confirmed byte-identical to pre-Phase-5 |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `apps/api/src/routes/builds.ts` | `packages/build-queue/src/postgres-store.ts` | `builds.create()` → outcome switch → `BUILD_QUEUE_LIMITED` | ✓ WIRED | Confirmed by direct read |
| `services/worker/src/queue-runner.ts` | `packages/artifact-store/src/keys.ts` | `buildIdFromKey()` in the retention loop | ✓ WIRED | Confirmed |
| `apps/api/src/observability/metrics.ts` | `packages/build-queue` `countActiveGlobal()` | Observable gauge callback | ✓ WIRED, data flowing | Real DB-backed count, not a static value |
| `apps/web/src/components/ImportConfigurationButton.tsx` | `apps/api` `POST /v1/configurations` | `createConfiguration()` client call | ✓ WIRED | Confirmed — no separate import endpoint exists |
| `.github/workflows/ci-matrix.yml` | `package.json` `matrix` script | `pnpm run matrix` | ✓ WIRED | Confirmed in workflow YAML |
| `.github/workflows/ci-matrix.yml` | `infra/qmk/manifest.json` | Image-digest assertion step | ✓ WIRED | Confirmed |
| `session.ts` | `packages/domain/src/limits.ts` | `SESSION_LIMITS.issuancePerIpPerHour` | ✓ WIRED | Confirmed |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Postgres backup produces a real, restorable dump with row-count parity | `bash infra/deploy/backup.sh <dir>` then `bash infra/deploy/restore-drill.sh <dir>` against a freshly-started `docker-compose.yml` Postgres | Exit 0 both; scratch DB created, restored, parity printed, dropped | ✓ PASS |
| CR-01 regression: no client IP in logs under production logger config | `npx vitest run apps/api/src/app.test.ts` | 1/1 pass | ✓ PASS |
| CR-02 regression: malformed cookie never 500s | `npx vitest run apps/api/src/session.test.ts` | 22/22 pass | ✓ PASS |
| No `assertWithinQuota` remains anywhere | `grep -rn assertWithinQuota apps packages services` | No matches | ✓ PASS |
| No debt markers (TBD/FIXME/XXX) introduced by this phase's files | `grep -n -E "TBD\|FIXME\|XXX"` across all phase-modified files | One `TBD` match, quoting `claude.md`'s own spec text in a pre-existing comment (`limits.ts`), not a live marker | ✓ PASS (no blocker) |
| Full workspace test suite | `npx vitest run` (run once) | 35 files, 503 passed, 1 skipped (Postgres contract half self-skips without a database in this sandbox) | ✓ PASS |
| Typecheck | `pnpm typecheck` | Clean | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Status | Evidence |
|---|---|---|---|
| REQ-hardening-abuse-controls | 05-01, 05-05 | ✓ SATISFIED | Truths 1–4 |
| REQ-observability-telemetry | 05-07 | ⚠️ Present, behavior-unverified | Truth 5 |
| REQ-smoke-matrix | 05-02, 05-06, 05-08 | ⚠️ Present, behavior-unverified (gate) / satisfied (matrix itself) | Truths 6–7 |
| REQ-backup-retention-controls | 05-04, 05-06, 05-08 | ✓ SATISFIED | Truths 8–11 |
| REQ-launch-identity-model | 05-03 | ✓ SATISFIED | Truths 12–13 |

No orphaned Phase 5 requirements — all five IDs REQUIREMENTS.md maps to Phase 5 appear in at least one plan's `requirements:` frontmatter.

**Note (informational, not a gap):** `.planning/REQUIREMENTS.md`'s traceability table (bottom of file) still lists all five Phase 5 requirement IDs as `Pending`, even though 05-08-SUMMARY.md's frontmatter declares `requirements-completed` for all five. This table is evidently updated by a separate step (milestone completion) not exercised by this phase's own plans — noted for the next workflow stage, not treated as a phase-goal gap.

### Anti-Patterns Found

None blocking. One informational note: `services/worker/src/matrix-fixtures.ts` contains a literal NUL byte (`\x00`) used as a Map-key delimiter inside a template literal (`` `${fixture.keyboardId}\0${fixture.layoutId}` ``), which is functionally correct in JS/TS but caused this file to be misidentified as binary by plain `grep`/`file`. Not a defect — flagged only because it is unusual enough to be worth a maintainer's awareness.

### Human Verification Required

See `behavior_unverified_items` in frontmatter — both items already appear in `.planning/WINDOWS.md` (open items 2 and 3) and are explicitly called out in the task's own known-gaps briefing, not new discoveries:

1. **Live OTLP collector verification (SC2's "exported" word).** Point `QWA_OTEL_EXPORTER_URL` at a real collector, run builds, confirm all four signals arrive correctly attributed and redacted.
2. **Real-PR merge-gate verification (SC3's "cannot merge" phrase).** Push to `origin`, open a gated-path PR with a broken fixture, confirm the required-status-check actually blocks the merge; confirm the docs-only and fork-PR cases too.

### Gaps Summary

No FAILED truths. Every artifact this phase's 8 plans declared exists, is substantive (no stub returns, no placeholder JSX, no empty handlers), and is wired to real data — independently re-verified by reading the code directly rather than trusting SUMMARY.md claims, and by re-running the two post-review regression fixes (CR-01 IP-in-logs, CR-02 cookie-decode crash) and the entire backup/restore drill against a live database in this session.

The two items that keep this phase from a clean `passed` are both pre-existing, already-documented, and structural rather than newly discovered: OpenTelemetry export was validated against an in-memory exporter but never a live collector (a deployment concern deliberately deferred by ADR-0001-observability, per its own design), and the CI merge gate is well-built and proven to compile the matrix for real, but has never blocked or passed a real GitHub pull request because this repository has never been pushed to `origin` in a state that let Task 4 of 05-06 run. Both require access this verifier does not have (a running OTLP collector; a pushed-and-open GitHub PR) and both are already tracked as open items in `.planning/WINDOWS.md`. Given the phase goal is "safe to expose to people who are not the developer," these two gaps matter: they are exactly the operational proof that the abuse-control and merge-discipline stories actually hold under conditions nobody has yet created. The code is genuinely ready for that test; the test itself has not happened.

Two smaller, non-blocking open items, already tracked and correctly not hidden by the tree: the curated smoke matrix's own criterion 3 (layout-shape diversity) is unmet by 3 of its 4 members, and the pinned `qmk-build:0.33.13-1` image carries a fixable high-severity CVE that would currently fail the Trivy gate on a gated-path PR — meaning the scan mechanism is proven to work exactly as designed (it fails on real findings), but the image itself needs a refresh before that gate goes green. Four low-severity code-review warnings (UTF-8 truncation boundary, a backup-file permissions race window, duplicated SQL literals, fragile `sed` URL parsing) remain unfixed by deliberate choice, all correctly scoped as quality items rather than the two genuine blockers the review found, both of which are now fixed and regression-tested.

---

_Verified: 2026-09-04T00:07:21Z_
_Verifier: Claude (gsd-verifier)_
