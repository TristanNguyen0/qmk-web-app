---
phase: 05-hardening-and-scale
plan: 07
subsystem: infra
tags: [opentelemetry, otel, metrics, observability, otlp, redaction]

# Dependency graph
requires:
  - phase: 05-hardening-and-scale
    provides: "05-01's BuildRepository.countActiveGlobal() (packages/build-queue/src/types.ts) — the queue-depth gauge's data source, named explicitly in 05-01's SUMMARY as this signal's second consumer"
  - phase: 05-hardening-and-scale
    provides: "05-04's current queue-runner.ts/queue-runner.test.ts (retention record, #log shape) — read as-modified, not as originally planned, per this plan's cross-plan check"
  - phase: 05-hardening-and-scale
    provides: "05-05's current server.ts (required session secret, explicit trustProxy) and apps/api/package.json's @fastify/rate-limit dependency — both preserved, not undone"
provides:
  - "startTelemetry()/shutdownTelemetry() — idempotent OTel metrics bootstrap, mirrored per process, disabled with QWA_OTEL_EXPORTER_URL unset"
  - "telemetryAttributes() — a closed attribute allowlist that throws on any key or value outside its declared domain, mirrored per process"
  - "redactAttributes() (services/worker/src/redact.ts) — the existing path/secret redaction tables applied to structured attribute values"
  - "The four criterion-2 signals over OTLP: qwa.builds.queue_depth, qwa.builds.completed, qwa.builds.failed, qwa.worker.heartbeat, plus qwa.builds.duration_ms"
  - "docs/runbooks/observability.md — the documented query set that makes 'an operator can see' true without shipping a dashboard"
affects: [05-08 (deployment consolidation — QWA_OTEL_EXPORTER_URL documentation), any future phase adding OTel traces, any future phase adding a telemetry attribute]

# Actuals (#2632)
actuals:
  tokens: 24681
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added:
    - "@opentelemetry/api@1.9.1"
    - "@opentelemetry/sdk-metrics@2.11.0"
    - "@opentelemetry/exporter-metrics-otlp-proto@0.222.0"
    - "@opentelemetry/resources@2.11.0"
  patterns:
    - "Lazy meter/instrument lookup inside function bodies, never at module scope — ES module imports hoist above any startTelemetry() call in the entry file, so a module-scope metrics.getMeter() binding would permanently pin to the no-op provider active at import time"
    - "Global @opentelemetry/api meter registry (metrics.setGlobalMeterProvider) rather than threading a MeterProvider through call sites — metrics.getMeter(name) already returns a working no-op meter when nothing is registered, which is exactly the disabled-telemetry behavior needed with no collector configured"
    - "Closed attribute allowlist (telemetryAttributes) as a stronger guarantee than redaction — a key not on the list is never exported, rather than relying on a regex table to catch a novel secret shape"
    - "Mirror rather than share for tiny cross-process modules (otel.ts, attributes.ts) — avoids a worker-to-API or API-to-worker package dependency for a dozen lines"

key-files:
  created:
    - apps/api/src/observability/attributes.ts
    - apps/api/src/observability/attributes.test.ts
    - apps/api/src/observability/otel.ts
    - apps/api/src/observability/otel.test.ts
    - apps/api/src/observability/metrics.ts
    - apps/api/src/observability/metrics.test.ts
    - services/worker/src/observability/attributes.ts
    - services/worker/src/observability/attributes.test.ts
    - services/worker/src/observability/otel.ts
    - services/worker/src/observability/otel.test.ts
    - services/worker/src/observability/metrics.ts
    - docs/runbooks/observability.md
  modified:
    - apps/api/src/server.ts
    - apps/api/package.json
    - services/worker/src/main.ts
    - services/worker/src/queue-runner.ts
    - services/worker/src/queue-runner.test.ts
    - services/worker/src/redact.ts
    - services/worker/src/redact.test.ts
    - services/worker/package.json

key-decisions:
  - "Installed exactly the four packages the operator approved at the package-legitimacy checkpoint — @opentelemetry/api@1.9.1, sdk-metrics@2.11.0, exporter-metrics-otlp-proto@0.222.0, resources@2.11.0 — and deliberately not sdk-node or the trace exporter, per the plan's planner_notes"
  - "Verified the installed packages' own .d.ts files (MeterProvider, PeriodicExportingMetricReader, OTLPMetricExporter, resourceFromAttributes) before writing the bootstrap, rather than copying RESEARCH.md's illustrative shape — RESEARCH.md's own Assumption A1 flagged that the OTel JS package boundaries move release to release"
  - "telemetryAttributes() returns Record<string, string | number> rather than the broader OTel Attributes type, so the worker can pipe its result straight into redactAttributes without a cast"
  - "Recording functions in metrics.ts obtain the meter and create instruments fresh on every call rather than caching at module scope — confirmed against the installed sdk-metrics source that Meter.createCounter()/createHistogram() are keyed by instrument descriptor internally, so repeated lookups correctly aggregate into one series rather than diverging or duplicating"
  - "Worker liveness is recorded on every runOnce() tick (claimed or idle) and every maintain() sweep, not just on a claimed build — liveness answers 'is the loop still running', which an idle poll cycle also proves"

patterns-established:
  - "Idempotent telemetry bootstrap: startTelemetry() guarded on a module-level handle, so a second call returns the first rather than registering a second MeterProvider and silently double-counting every metric"
  - "Exporter failures never propagate: PeriodicExportingMetricReader already swallows export errors internally and routes them through api.diag.error/warn — a custom DiagLogger installed by startTelemetry() routes those to the process's own structured warn-level log"
  - "Every worker-side recording call is wrapped so a throwing instrument (or a telemetryAttributes rejection) cannot change a build's outcome, mirroring queue-runner.ts's own stated invariant that a build never ends in a non-terminal state because of an exception"

requirements-completed: [REQ-observability-telemetry]

coverage:
  - id: D1
    description: "A closed attribute allowlist (telemetryAttributes) throws on any key or value outside its declared domain, naming the offending key — no free-text telemetry attribute is possible by construction"
    requirement: "REQ-observability-telemetry"
    verification:
      - kind: unit
        ref: "apps/api/src/observability/attributes.test.ts#telemetryAttributes"
        status: pass
      - kind: unit
        ref: "services/worker/src/observability/attributes.test.ts#telemetryAttributes"
        status: pass
    human_judgment: false
  - id: D2
    description: "redactAttributes applies the same path/secret tables redactLog uses to structured attribute values, so a new sink inherits the existing redaction rules"
    requirement: "REQ-observability-telemetry"
    verification:
      - kind: unit
        ref: "services/worker/src/redact.test.ts#redactAttributes"
        status: pass
    human_judgment: false
  - id: D3
    description: "startTelemetry()/shutdownTelemetry() are idempotent, inert with QWA_OTEL_EXPORTER_URL unset, and never let an exporter failure escape as a thrown error"
    requirement: "REQ-observability-telemetry"
    verification:
      - kind: unit
        ref: "apps/api/src/observability/otel.test.ts#startTelemetry"
        status: pass
      - kind: unit
        ref: "services/worker/src/observability/otel.test.ts#startTelemetry"
        status: pass
    human_judgment: false
  - id: D4
    description: "The queue-depth gauge observes a present 0 with no builds in the system, observes N after N active builds, is idempotent to register, and turns a failing data source into a warn log rather than a thrown error"
    requirement: "REQ-observability-telemetry"
    verification:
      - kind: unit
        ref: "apps/api/src/observability/metrics.test.ts#registerQueueDepthGauge"
        status: pass
    human_judgment: false
  - id: D5
    description: "The worker exports build throughput, failure classification, worker liveness, and build duration, attributed correctly, aggregating into one series per instrument+attribute set, and a throwing instrument cannot change a build's outcome"
    requirement: "REQ-observability-telemetry"
    verification:
      - kind: unit
        ref: "services/worker/src/queue-runner.test.ts#telemetry"
        status: pass
    human_judgment: false
  - id: D6
    description: "All existing queue-runner tests still pass unchanged after wiring in telemetry recording calls"
    verification:
      - kind: unit
        ref: "services/worker/src/queue-runner.test.ts (pre-existing describe blocks: QueueRunner.runOnce, cancellation, lease loss, failure containment, maintenance)"
        status: pass
    human_judgment: false
  - id: D7
    description: "docs/runbooks/observability.md documents every exported instrument, the exporter env var, a concrete PromQL query per criterion-2 signal with a healthy-value note against BUILD_LIMITS.maxGlobalActiveBuilds, what is deliberately not exported and why, and what adding traces would require"
    requirement: "REQ-observability-telemetry"
    verification:
      - kind: unit
        ref: "node -e assertion in Task 3's <verify> — confirms all five instrument names + QWA_OTEL_EXPORTER_URL appear in the file"
        status: pass
    human_judgment: true
    rationale: "The <human-check> in Task 3's <verify> (pointing QWA_OTEL_EXPORTER_URL at a live OTLP collector, running a build, and confirming all four signals arrive correctly attributed) requires infrastructure not available to this executor run. The automated half (instrument names present, correct query content) is proven; the live end-to-end collector check is deferred to a human with a collector available."

duration: 10min (commit span; full session including package-legitimacy checkpoint resolution and package verification was longer)
completed: 2026-09-03
status: complete
---

# Phase 05 Plan 07: OpenTelemetry Metrics Export Summary

**Metrics-only OpenTelemetry bootstrap (mirrored in both processes) exporting queue depth, build throughput, failure classification, worker liveness, and build duration over OTLP, behind a closed attribute allowlist that makes free-text telemetry impossible by construction, with a documented PromQL query set standing in for a dashboard.**

## Performance

- **Duration:** ~10 min commit span (the package-legitimacy checkpoint, its resolution by the operator, and package/type verification against the installed OTel packages' own `.d.ts` files extended the full session further)
- **Started:** 2026-09-03T14:59:54-04:00 (first commit)
- **Completed:** 2026-09-03T15:09:27-04:00 (last commit)
- **Tasks:** 3 (plus the package-legitimacy checkpoint, resolved by the operator before this continuation run began)
- **Files modified:** 21 (12 created, 9 modified) + lockfile

## Package Legitimacy Gate

This plan's Task 0 is a `gate="blocking-human"` checkpoint gating the install of four OpenTelemetry packages, three of which the phase's `05-RESEARCH.md` Package Legitimacy Audit flagged `SUS` on a recency-since-publish heuristic alone. **A previous executor run halted at that gate before installing anything or making any commits.** The operator subsequently reviewed the three flagged packages and replied "packages verified," confirming:

| Package | Version |
|---|---|
| `@opentelemetry/api` | 1.9.1 |
| `@opentelemetry/sdk-metrics` | 2.11.0 |
| `@opentelemetry/exporter-metrics-otlp-proto` | 0.222.0 |
| `@opentelemetry/resources` | 2.11.0 |

This continuation run installed exactly those four packages at exactly those versions into both `apps/api` and `services/worker`, and installed nothing else — `@opentelemetry/sdk-node` and `@opentelemetry/exporter-trace-otlp-proto` remain uninstalled, per the plan's `<planner_notes>`.

## Accomplishments

- **Attribute allowlist (`telemetryAttributes`).** A closed record of six allowed keys (`status`, `failureCode`, `cap`, `workerId`, `count`, `durationMs`), each with an enumerated or numeric domain; any other key or an out-of-domain value throws, naming the offender. Mirrored in both processes since `services/worker` has no dependency on `apps/api` (see Deviations).
- **`redactAttributes()`** added to `services/worker/src/redact.ts`, reusing the module's existing `PATH_REPLACEMENTS`/`SECRET_PATTERNS` tables via a shared `redactText` helper rather than restating them — closes the `REQ-observability-telemetry` redaction Wave 0 gap recorded in `05-VALIDATION.md` line 52 (`❌ W0 (new-sink case)`), via the new `redactAttributes` cases in `services/worker/src/redact.test.ts`. `05-VALIDATION.md` was not edited directly, per the plan's instruction — `/gsd-validate-phase` owns re-anchoring it.
- **Idempotent metrics bootstrap (`startTelemetry`/`shutdownTelemetry`).** Guarded on a module-level handle; registers against the global `@opentelemetry/api` meter registry so every instrument obtained via `metrics.getMeter(...)` is automatically a working no-op when telemetry is disabled, with no special-casing needed at any call site. A custom `DiagLogger` routes every OTel SDK diagnostic — including every exporter failure, which `PeriodicExportingMetricReader` already reports through `diag.error`/`diag.warn` rather than throwing or rejecting — to the process's own structured warn-level log.
- **The four signals.** `qwa.builds.queue_depth` (API, observable gauge, `BuildRepository.countActiveGlobal()`), `qwa.builds.completed` / `qwa.builds.failed` / `qwa.worker.heartbeat` (worker, counters), plus `qwa.builds.duration_ms` (worker, histogram) — wired into `queue-runner.ts` beside the existing `#log` calls at every terminal-outcome exit point and on every loop tick / `maintain()` sweep.
- **Wired into both entrypoints.** `startTelemetry()` runs before `buildApp`/before the runner starts in `server.ts`/`main.ts`; `shutdownTelemetry()` runs alongside each process's existing `SIGINT`/`SIGTERM` cleanup so a shutting-down process flushes its last export window.
- **`docs/runbooks/observability.md`.** Documents every instrument, `QWA_OTEL_EXPORTER_URL` and its inert-when-unset behavior, a concrete PromQL query per criterion-2 signal with a healthy-value note against `BUILD_LIMITS.maxGlobalActiveBuilds`, the allowlist and forbidden attribute categories, what adding traces would require, and a pointer to `backup-restore.md` for the retention question.

## Task Commits

Each task was committed atomically:

1. **Task 1: An idempotent metrics bootstrap and an attribute allowlist that admits no free text** - `dd75069` (feat)
2. **Task 2: The four signals criterion 2 names** - `4cace61` (feat)
3. **Task 3: The documented query set that makes "an operator can see" true** - `1253b91` (docs)

**Plan metadata:** not committed by this executor — worktree mode; the orchestrator commits `SUMMARY.md`/`REQUIREMENTS.md` after merge, per this plan's parallel-execution instructions.

## Files Created/Modified

- `apps/api/src/observability/attributes.ts` / `.test.ts` - the closed attribute allowlist and its tests
- `apps/api/src/observability/otel.ts` / `.test.ts` - `startTelemetry()`/`shutdownTelemetry()` and their tests
- `apps/api/src/observability/metrics.ts` / `.test.ts` - `registerQueueDepthGauge()` and its tests
- `apps/api/src/server.ts` - `startTelemetry()` wired before `buildApp`; `registerQueueDepthGauge()` wired after; `shutdownTelemetry()` in the signal handler
- `apps/api/package.json` - the four approved OTel packages
- `services/worker/src/observability/attributes.ts` / `.test.ts` - worker-side mirror of the allowlist (see Deviations)
- `services/worker/src/observability/otel.ts` / `.test.ts` - worker-side mirror of the bootstrap
- `services/worker/src/observability/metrics.ts` - `recordBuildCompleted`, `recordBuildFailed`, `recordWorkerHeartbeat`, `recordBuildDuration`
- `services/worker/src/main.ts` - `startTelemetry()` wired before the runner starts; `shutdownTelemetry()` after `runner.start()` resolves
- `services/worker/src/queue-runner.ts` - the four recording calls wired in beside existing `#log` calls
- `services/worker/src/queue-runner.test.ts` - new `describe('telemetry', ...)` block, 6 tests, driven by a real `MeterProvider` + `InMemoryMetricExporter`
- `services/worker/src/redact.ts` / `.test.ts` - `redactAttributes()` and its tests
- `services/worker/package.json` - the four approved OTel packages
- `docs/runbooks/observability.md` - new runbook
- `pnpm-lock.yaml` - dependency resolution for the above

## Decisions Made

See `key-decisions` in frontmatter. The two decisions worth restating in prose:

- **Verified the installed packages' actual `.d.ts` files before writing the bootstrap**, per `05-RESEARCH.md`'s own explicit warning (Assumption A1) that the constructor/option names in its illustrative code example were not tested against a real install. The real shapes differ in small but load-bearing ways from the research doc's sketch — e.g. `resourceFromAttributes` (not a `Resource` constructor), `PeriodicExportingMetricReader({ exporter })` taking the exporter as a named option, and `OTLPMetricExporter`'s config extending `OTLPExporterNodeConfigBase & OTLPMetricExporterOptions` with `url` as the collector-endpoint field.
- **`PeriodicExportingMetricReader` never throws or rejects on an export failure** — confirmed by reading the installed `sdk-metrics` source directly (`api.diag.error('PeriodicExportingMetricReader: metrics export threw error', e)` inside a try/catch the reader owns). This meant the "exporter failure surfaces as a warn log, never a thrown error" requirement needed no defensive wrapping around the reader itself — only a `DiagLogger` that routes those diagnostics to the process's structured log.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Worker-side `attributes.ts` mirror**
- **Found during:** Task 2
- **Issue:** Task 2's action text requires `services/worker/src/observability/metrics.ts` to build every attribute record through `telemetryAttributes()`, but that function was created (Task 1) only in `apps/api/src/observability/attributes.ts`. `services/worker` has no dependency on the `apps/api` package (confirmed: no `@qmk-web-app/api` in `services/worker/package.json`, no precedent anywhere in the codebase for a worker→api import), and adding one would be architecturally backward — the API must not depend on worker internals, and the reverse direction isn't wired up as an importable package either.
- **Fix:** Created `services/worker/src/observability/attributes.ts` as a line-for-line mirror of `apps/api/src/observability/attributes.ts`, following the exact "mirror rather than share" pattern the plan itself establishes for `otel.ts` ("Keeping them as two small mirrored files rather than one shared module avoids creating a worker-to-API or API-to-worker dependency for a dozen lines"). Documented the mirroring rationale in both files' headers.
- **Files modified:** `services/worker/src/observability/attributes.ts` (new), `services/worker/src/observability/attributes.test.ts` (new)
- **Verification:** `services/worker/src/observability/attributes.test.ts` (10 tests, mirroring `apps/api`'s 14 minus the enum-exhaustive-accept and non-finite-number cases, which are redundant given the identical implementation)
- **Committed in:** `4cace61` (Task 2 commit)

**2. [Rule 2 - Missing critical functionality] `otel.test.ts` and `metrics.test.ts` files not in the plan's declared file list**
- **Found during:** Task 1 and Task 2
- **Issue:** The plan's frontmatter `files_modified` list names `apps/api/src/observability/attributes.test.ts` explicitly but no test file for `otel.ts` or `apps/api/src/observability/metrics.ts`, even though the plan's own acceptance criteria require tests for `startTelemetry()` idempotency, the disabled-with-no-URL case, the rejecting-exporter case, and the queue-depth gauge's zero/N/idempotent/failing-source behaviors.
- **Fix:** Added `apps/api/src/observability/otel.test.ts`, `services/worker/src/observability/otel.test.ts`, and `apps/api/src/observability/metrics.test.ts` — all within the `apps/api/src/observability/**` / `services/worker/src/observability/**` wildcard scope this plan's `<parallel_execution>` instructions explicitly grant, even though the exact filenames aren't in the frontmatter's file list.
- **Files modified:** the three files above (all new)
- **Verification:** 6 + 6 + 4 = 16 new tests, all passing
- **Committed in:** `dd75069` (otel tests), `4cace61` (metrics test)

**3. [Rule 3 - Blocking] Ran `pnpm install` at the workspace root**
- **Found during:** Task 1, before the first test run
- **Issue:** `pnpm --filter @qmk-web-app/api add ...` and `pnpm --filter @qmk-web-app/worker add ...` (the package-legitimacy-approved installs) only installed dependencies for those two packages. Several sibling workspace packages this worktree had never run a full install for (`packages/domain`, `packages/qmk-generator`, `packages/qmk-fixtures`, and others) had no `node_modules` of their own at all, causing 17 unrelated test files to fail with `Failed to load url zod` / `Failed to load url @qmk-web-app/domain` — nothing to do with this plan's changes.
- **Fix:** Ran `pnpm install` at the workspace root (no lockfile changes beyond a trivial `next` version-string diff already produced by the approved adds) — installed 22 previously-missing packages across the workspace, resolving all 17 unrelated failures.
- **Files modified:** none beyond the already-staged `pnpm-lock.yaml`
- **Verification:** Full `pnpm test` run: 34 files, 496 passing, 1 pre-existing skip (see Issues Encountered for one further pre-existing flake)
- **Committed in:** not a separate commit — folded into `dd75069`'s `pnpm-lock.yaml` (a link-only resolution, not a new dependency)

---

**Total deviations:** 3 auto-fixed (2 missing-critical, 1 blocking). **Impact:** All three were necessary for Task 2's correctness (the worker-side allowlist), for the plan's own acceptance criteria (the test files), and for the test suite to run at all in this worktree (the workspace install). No scope creep — every added file stays inside the parallel-execution wildcard scope.

## Issues Encountered

- One pre-existing flaky test (`apps/api/src/routes/builds.test.ts`) failed once during a full `pnpm test` run and passed cleanly on the immediate re-run and on every subsequent run. This is the same flake 05-05's SUMMARY independently documented as pre-existing and unrelated to that plan's changes — corroborating it is not caused by this plan either. Not fixed; out of scope per the deviation rules' scope boundary (the file is not in this plan's `files_modified`).

## User Setup Required

**External service requires manual configuration, but no `05-USER-SETUP.md` was created by this run.** The plan's frontmatter declares a `user_setup` entry for an `opentelemetry-collector` service (env var `QWA_OTEL_EXPORTER_URL`), and `execute-plan.md`'s standard flow would normally generate `.planning/phases/05-hardening-and-scale/05-USER-SETUP.md` for it. This run is a worktree-isolated parallel executor running alongside a sibling plan (05-06) in its own worktree; a phase-level `05-USER-SETUP.md` is outside this plan's declared file scope (`apps/api/src/observability/**`, `services/worker/src/observability/**`, `redact*`, the two `package.json`s, `server.ts`, `queue-runner*`, `main.ts`, and `docs/runbooks/observability.md`) and writing it here risks colliding with the sibling worktree's own writes. Recorded here instead:

- **Service:** an OpenTelemetry Collector, Grafana Alloy, or any OTLP/HTTP-speaking vendor agent — deliberately not chosen by this phase (`ADR-0001-observability` makes it a deployment concern).
- **Env var:** `QWA_OTEL_EXPORTER_URL` — the collector's OTLP/HTTP metrics endpoint. Leave unset to disable telemetry entirely; no collector is required to run either process or the test suite.
- **Follow-up:** the orchestrator (or `/gsd-plan-phase`/a later phase-completion step) should generate the phase-level `05-USER-SETUP.md` after merging both 05-07 and 05-06's worktrees, or a human can run `docker compose` for a local OTLP collector and set the env var directly. `docs/runbooks/observability.md` documents the four queries to run against it once configured.

## Next Phase Readiness

- Criterion 2 of Phase 5 ("an operator can see queue depth, build throughput, failure classification, worker liveness") is met: all four signals are exported and answerable from the documented query set in `docs/runbooks/observability.md`.
- The `REQ-observability-telemetry` redaction Wave 0 gap in `05-VALIDATION.md` is closed by the new `redactAttributes` test cases; `/gsd-validate-phase` should re-anchor that row (not edited directly by this plan, per instruction).
- Traces remain a documented, deliberately deferred next step behind the same `otel.ts` bootstrap module — see the runbook's "What adding traces would take" section.
- No blockers for 05-08 (deployment consolidation), which can now document `QWA_OTEL_EXPORTER_URL` alongside `QWA_SESSION_SECRET`/`QWA_TRUST_PROXY`.
- Live end-to-end collector verification (Task 3's `<human-check>`) is deferred to a human with an OTLP collector available — see coverage entry D7.

## Self-Check: PASSED

- All 12 created files confirmed present on disk with `[ -f ]`.
- All 3 task commits (`dd75069`, `4cace61`, `1253b91`) confirmed present in `git log`.
- Re-ran the plan-level `<verification>` block: `pnpm typecheck` and `pnpm test` both pass with `QWA_OTEL_EXPORTER_URL` unset (34 files, 496 tests passing, 1 pre-existing skip); the four criterion-2 instruments exist and are recorded from the named call sites; `redactAttributes`/`redactLog` agreement is asserted by test; the attribute allowlist rejects `ownerId`/`configurationName`/`storageKey`/`path` by name; `docs/runbooks/observability.md` exists and names all four instruments (confirmed via the plan's own `node -e` assertion).

---
*Phase: 05-hardening-and-scale*
*Completed: 2026-09-03*
