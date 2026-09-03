# Phase 5: Hardening and Scale - Research

**Researched:** 2026-09-02
**Domain:** Production hardening for a single-host QMK firmware build service — abuse controls,
observability, CI-gated compile matrix, backup/retention, and a launch identity decision already
taken (anonymous-only).
**Confidence:** MEDIUM-HIGH — the phase is dominated by extending existing, well-understood patterns
in this codebase (SQL-based atomicity, structured logging, the existing sandbox/matrix scripts)
rather than adopting new frameworks. The genuinely new territory (OpenTelemetry wiring, GitHub
Actions self-hosted CI) is externally documented and cross-checked below.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Launch identity model**

- **D-01:** Anonymous-only is the launch identity model, recorded as a stated constraint rather
  than an unfixed gap. Accounts are not built in this phase. This is criterion 5's second branch,
  taken deliberately. — Reversibility: reversible — `ADR-0001-auth` already confines the change to
  where `ownerId` originates, and every read and write predicate authorizes by `ownerId` today.

- **D-02:** Data-loss behaviour is surfaced by a persistent, non-dismissable line on the
  configurations list and in the editor chrome: this work belongs to this browser's cookie, and
  clearing it loses the work. A dismissable first-visit notice was rejected — the dismissal itself
  lives in the cookie that is at risk, so the user most likely to be harmed is the one who would
  never see it again.

- **D-03:** Export and import both ship. Export a configuration as JSON; import adopts an uploaded
  document into the current session as a new configuration. Import MUST go through the same
  `validateConfiguration` path as any other write — untrusted JSON never bypasses the schema — and
  the client still cannot set `id`, `ownerId`, `revision`, or `schemaVersion` (Phase 2, criterion 4).
  — Reversibility: costly — an export format published to users becomes a compatibility surface;
  changing it later breaks files people have already saved.

- **D-04:** Session cookie hardening is in scope. Remove the hardcoded dev secret fallback at
  `apps/api/src/server.ts:36` so `QWA_SESSION_SECRET` is required in every environment, and set
  `SameSite` explicitly rather than inheriting a browser default. Established during this
  discussion: the cookie's `Max-Age` is already a deliberate one year (`apps/api/src/session.ts`),
  so lifetime is a review item, not a change.

- **D-05:** No UI contract for this phase. A status line and a download/upload control are
  conventional and `apps/web` already carries the patterns. The UI surface is noted here instead.

**Smoke matrix and merge gate**

- **D-06:** The gate runs on a self-hosted GitHub Actions runner on the build host, with branch
  protection and a required status check so "cannot merge" is literal. The host already has Docker,
  the 3.73 GB `qmk-web-app/qmk-build:0.33.13-1` image, and the pinned QMK checkout, so a run costs
  the compiles and nothing else. Recorded constraint: the self-hosted runner must never execute fork
  PRs. Acceptable in a solo repository; it becomes a hard constraint the day it is not. —
  Reversibility: costly — moving to hosted runners later requires a registry, an image publish step
  folded into the controlled QMK refresh process, and a pinned QMK clone per run.

- **D-07:** One matrix runner over several fixture sets. Extract the setup that
  `services/worker/scripts/smoke-build.ts` and `services/worker/scripts/socd-compile-matrix.ts`
  already duplicate — open published catalog, validate, generate, `DockerSandbox`, assert firmware —
  into one runner taking a fixture set. `pnpm socd:matrix` stays a named entry point. The invariant
  `socd-compile-matrix.ts` enforces must survive intact: every keyboard `MODULE_REGISTRY` records as
  compile-verified for this catalog version must have a fixture. That guard is the evidence behind
  the registry's `verifiedFor` records. — Reversibility: costly — the registry's verification story
  depends on this script; a refactor that loses the guard silently weakens a shipped claim.

- **D-08:** Matrix membership is chosen for toolchain and bootloader diversity — extending from
  `crkbd/rev1` (AVR) and `mode/m256wh` (ARM/STM32) across distinct MCU families, bootloaders, and
  layout shapes present in the pinned catalog. The selection criteria are written down so a later
  addition is justified rather than arbitrary. Popularity-based selection was rejected: no popularity
  signal exists in the pinned catalog, so the list would be invented — which the standing
  never-invent-metadata constraint forbids.

- **D-09:** The matrix is path-filtered to changes touching the generator, QMK pin, templates, or
  build image, with a fast always-on check (typecheck + vitest) on every PR. One sharp edge to
  handle deliberately: a required status check skipped by a path filter can block a PR forever or
  pass vacuously depending on wiring — the skip path must report an explicit status rather than
  being absent.

- **D-10:** Every matrix entry must produce firmware; one designated entry additionally builds twice
  and asserts byte-identical output, preserving the Phase 0 reproducibility claim without doubling
  the gate's wall clock. Determinism is a property of the generator and the pinned image, not of a
  particular keyboard — the same proportionality reasoning that kept Phase 4's hardware matrix
  narrow.

**Abuse controls**

- **D-11:** The global limit is on queue depth — total queued plus running builds across all owners
  — enforced in the same SQL statement that inserts the build, so it cannot race and stays correct
  with more than one API process. Depth is the right signal: it is what protects the single host,
  and a deep queue already means every user's build is slow. Rejection is `BUILD_QUEUE_LIMITED`,
  which already maps to HTTP 429 at `apps/api/src/errors.ts:27` — no new error code is needed. —
  Reversibility: costly — it changes the insert path that `ADR-0004-queue` defines as the queue
  itself.

- **D-12:** The IP axis is applied to session issuance, not to builds. Minting a fresh anonymous
  session is the cheap step that defeats every per-owner quota, and it happens in exactly one place;
  once bounded, the existing 2-concurrent / 20-per-hour limits do their job again and a per-IP build
  quota is largely redundant. The limit must be generous enough for many legitimate users behind one
  NAT (office, campus). No IP is recorded on build rows — nothing personal to redact or retain.
  Distributed sources remain the global cap's job, by design.

- **D-13:** Both per-owner quota checks become atomic, folded into the same conditional insert as
  the global cap. The read-then-check at `apps/api/src/builds/service.ts:125` is removed. This is
  the identical reasoning `ADR-0004-idempotency` already applied when idempotency became a unique
  index — an application-level check races with itself. — Reversibility: costly — touches the build
  creation path and its contract tests, which exist precisely to pin concurrency guarantees.

- **D-14:** Fastify `trustProxy` is configured explicitly to the known proxy hop, and "sits behind a
  reverse proxy that sets `X-Forwarded-For`" becomes a stated deployment requirement. Production
  start-up fails loudly if it is not configured, mirroring the existing session-secret guard in
  `apps/api/src/server.ts`. The failure this prevents is silent: without it, every request either
  shares the proxy's address — collapsing all users into one bucket — or trusts a spoofable header.
  There is no `trustProxy` and no use of `request.ip` anywhere in the API today.

### Claude's Discretion

The user chose not to discuss these. Defaults are recorded with reasoning so the planner has a
starting position rather than an open question — none of them is locked by the user.

- **Telemetry (`REQ-observability-telemetry`).** Default: the OpenTelemetry SDK with an OTLP
  exporter, which satisfies `ADR-0001-observability`'s "OpenTelemetry-compatible exporters … to
  avoid premature vendor lock-in" literally; the collector is a deployment concern, not an
  application dependency. Signals must cover the four criterion 2 names — queue depth, build
  throughput, failure classification (`builds.failure_code` already carries it), worker liveness.
  Existing redaction (`services/worker/src/redact.ts`) must apply to every sink, per the same ADR.
  Whether a dashboard ships is the planner's call: criterion 2 says an operator *can see*, which
  exported signals plus a documented query set satisfies.

- **Backups and restore drills (`REQ-backup-retention-controls`).** Default: back up Postgres only,
  not artifacts. Artifacts are 7-day-ephemeral and deterministically reproducible from a
  configuration revision plus the pinned catalog version, QMK commit, generator version, and image
  digest — which is exactly the property the Phase 0 spike proved. A restore drill restores Postgres
  to a scratch database and re-runs a build. Criterion 4's second half — "state what retention
  actually deleted and when" — needs a durable record: `QueueRunner.maintain()` currently deletes
  without one. Structured log events at minimum; a deletions table if the planner judges logs
  insufficient.

- **Dependency and image vulnerability scanning, and the QMK / bundled-asset licensing review.**
  `claude.md` § Build isolation and security names both as prerequisites to public deployment.
  Default: scanning lands as a CI job on the same runner as D-06; the licensing review lands as a
  recorded document in this phase.

- **Open numbers and mechanics:** the global queue-depth cap and the session-issuance limit; the
  matrix's size cap; runner provisioning and how it is kept current with the pinned image; whether
  the catalog build belongs in CI; whether a failing matrix entry can be quarantined rather than
  blocking every merge.

### Deferred Ideas (OUT OF SCOPE)

No scope creep was raised during this discussion — every area stayed inside the phase boundary.

Surfaced during codebase scouting, deliberately not folded into this phase (recorded so they are
not lost; none of these was raised by the user):

- Unbounded configuration/session growth — no cleanup policy for old anonymous sessions or their
  configurations. Adjacent to `REQ-backup-retention-controls` but distinct from it.
- Orphaned artifact reaper — `maintain()` deletes rows before blobs by design, so a failed blob
  delete leaves an unreferenced file with nothing scanning for it.
- Untested web components — `KeymapEditor.tsx` and `BuildPanel.tsx` have no tests. D-02 and D-03 add
  code to that same untested surface.
- Missing index on `configuration_revisions(configuration_id, revision)` — hit on every build claim.

Out of scope per CONTEXT.md `<domain>`: accounts and any authentication provider; S3/MinIO artifact
storage and signed URLs (`ADR-0004-artifact-store` defers both); `LISTEN/NOTIFY` behind
`BuildQueue.claim`; browser flashing (Phase 6).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-hardening-abuse-controls | Abuse controls sufficient for public access — global concurrency limit, IP-based rate limiting on the one chokepoint that matters | Architecture Patterns § Atomic build admission control; § Session-issuance rate limiting; Code Examples § Global+per-owner admission SQL |
| REQ-observability-telemetry | Observability adequate to operate the service — OTel-compatible exporters, redaction on every sink | Standard Stack § OpenTelemetry; Architecture Patterns § Telemetry wiring; Code Examples § OTel Node SDK bootstrap |
| REQ-smoke-matrix | Curated smoke matrix that gates merges touching generator/QMK pin/templates/build image | Architecture Patterns § One matrix runner; § CI workflow design; Common Pitfalls § Path-filtered required check |
| REQ-backup-retention-controls | Backups, retention controls, restore/reproducibility drills, dependency/image scanning, licensing review | Architecture Patterns § Postgres-only backup; § Retention ledger; Standard Stack § Scanning tools |
| REQ-launch-identity-model | Decide and record the launch identity model (already decided: anonymous-only, D-01) | User Constraints D-01–D-05; Common Pitfalls § Tailwind/Radix claim correction |
</phase_requirements>

## Summary

Phase 5 is an infrastructure-hardening phase, not a new-feature phase: almost everything it needs
extends a pattern this codebase already has, rather than introducing a new one. The build queue
already lives entirely in one `builds` table with a conditional-`UPDATE` claim (`ADR-0004-queue`);
the phase's central task (D-11/D-13) is turning the *creation* path into an equally atomic
conditional `INSERT`, replacing the read-then-check `assertWithinQuota` at
`apps/api/src/builds/service.ts:125` with counts computed and enforced inside the same statement
that performs the insert. This is a real concurrency problem — a naive `INSERT ... SELECT ... WHERE
(SELECT count(*) ...) < cap` still races under Postgres's default `READ COMMITTED` isolation, because
each transaction's subquery sees its own snapshot and two concurrent submissions can each observe
"one under the cap" before either commits. The correct, single-statement-compatible fix is a
`pg_advisory_xact_lock` acquired inside a leading CTE of the same `INSERT` statement, serializing the
count-then-insert region without a table-wide lock; this is a standard Postgres idiom `[ASSUMED]`
(not fetched from a Postgres doc this session) and needs an explicit concurrency test in the existing
`store-contract.test.ts` pattern, which already runs the real Postgres path.

The curated smoke matrix (D-06–D-10) is not a new capability either — `smoke-build.ts` already proves
double-build byte-identical reproducibility, and `socd-compile-matrix.ts` already compiles a
fixture table of real keyboards for real in the isolated image and already enforces the
"every `verifiedFor` record needs a fixture" guard. The phase's job is extracting the duplicated
scaffolding (open catalog → validate → generate → `DockerSandbox` → assert firmware) into one runner
parameterized by a fixture set, and wiring that runner into GitHub Actions on a self-hosted runner —
the repository's first CI. The two real external risks here, both confirmed by search this session,
are (1) a required status check that a path filter skips reports no status at all and blocks a PR
forever unless the skip path is made to report an explicit passing status, and (2) a self-hosted
runner is unsafe against fork pull requests by design, regardless of `GITHUB_TOKEN` scoping — GitHub's
repository-level fork-PR approval gate mitigates but does not eliminate this, so the workflow should
also carry a job-level guard that refuses to run on a PR whose head repository differs from the base
repository.

Telemetry is new in the sense that no `@opentelemetry/*` package is in this repository's dependency
tree yet, but the target shape is already decided by `ADR-0001-observability` ("structured JSON logs
now, OpenTelemetry-compatible exporters before public access") and the existing worker already emits
one-line structured JSON per event — the OTel work is adding an SDK-and-exporter layer under logging
that already exists, not replacing it, plus new metric instruments for the four named signals (queue
depth, build throughput, failure classification, worker liveness). Backups default to Postgres-only,
which the phase context already argues for on reproducibility grounds; the interesting new work is
recording *what retention deleted and when* — `QueueRunner.maintain()`'s `reap()` currently deletes
rows and returns keys with no durable trace beyond an optional structured log line.

One correction surfaced by this session's codebase reading: CONTEXT.md's D-05 states that "apps/web
already carries the [Tailwind/Radix] patterns" for D-02's notice and D-03's export/import controls.
This is not what the code shows. `apps/web/package.json` declares no Tailwind or Radix dependency,
there is no `tailwind.config.*` anywhere in the app, and `globals.css`'s own header comment states
*"Deliberately plain CSS for Phase 1. ADR 0001 selects Tailwind + Radix for the editor; pulling that
in before there is an editor to style would be premature"* — and that premise was never revisited
through Phases 2–4; `KeymapEditor.tsx` still renders with hand-written classes (`className="editor"`,
`className="notice"`, etc.) against a 628-line plain CSS file. The planner should follow the actual
existing convention (plain CSS classes in `globals.css`, the `.notice` / `.provenance` class idiom
already used on the configurations list page) rather than introducing Tailwind/Radix mid-phase for
two small controls — that would be new dependency surface this phase does not need and CONTEXT.md
did not intend to authorize (D-05 explicitly declines a UI contract).

**Primary recommendation:** Do the SQL-atomicity and CI-gate work first (D-11/D-13, D-06/D-09) since
they touch shared infrastructure every other criterion depends on being safe; layer telemetry and
backups on top once the queue and matrix are stable; do the D-02/D-03 UI work last, against the
existing plain-CSS convention, not a new one.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Global build concurrency cap | API / Backend (Postgres) | — | Enforced in the same conditional `INSERT` that creates the build row; a database constraint the API's SQL expresses, not application-level bookkeeping |
| Per-owner build quotas | API / Backend (Postgres) | — | Folded into the same statement as the global cap (D-13); currently a racy application check at `service.ts:125` |
| Session-issuance IP rate limit | API / Backend (Fastify hook) | — | Lives in `registerSessions`'s `onRequest` hook, the one place a session is minted; not a build-queue concern |
| `trustProxy` / real client IP | API / Backend (Fastify config) | CDN/Static (reverse proxy) | Fastify must be told which hop to trust; the actual `X-Forwarded-For` value is set upstream by the deployment's reverse proxy, which is a deployment concern this phase documents as a requirement, not code it ships |
| Telemetry export (traces/metrics/logs) | API / Backend + Worker (services) | Database/Storage (collector, out of process) | Both `apps/api` and `services/worker` are instrumented; the OTel Collector that receives OTLP is a deployment concern, matching `ADR-0001-observability`'s "avoid premature vendor lock-in" |
| Curated smoke matrix / merge gate | CI (self-hosted GitHub Actions runner) | Database/Storage (build image, pinned QMK checkout) | Runs the same isolated-build pipeline as production, but triggered by CI, not user requests |
| Backups and restore drills | Database / Storage (Postgres) | — | Artifacts are deliberately NOT backed up (reproducible from a revision); only Postgres state is durable and worth protecting |
| Retention deletion ledger | Worker (`QueueRunner.maintain()`) | Database/Storage (new table or structured log sink) | Retention already executes in the worker; this phase adds durable evidence of what it did |
| Data-loss notice / export-import UI | Browser / Client (Next.js pages) | API / Backend (`validateConfiguration` reuse) | Presentation is client-side; the trust boundary for import is still server-side validation, unchanged from every other write path |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@opentelemetry/api` | 1.9.1 `[VERIFIED: npm registry — legitimacy check OK]` | Vendor-neutral tracing/metrics API surface | The stable, slow-moving API package every OTel instrumentation depends on; safe floor for the SDK below |
| `@opentelemetry/sdk-node` | 0.222.0 `[ASSUMED — package name/shape from training knowledge, cross-checked against npm registry but flagged SUS by the legitimacy gate on publish recency; see audit below]` | Node.js SDK bootstrap (tracer/meter providers, auto-instrumentation registration) | Official OpenTelemetry JS SDK; matches `ADR-0001-observability`'s literal wording |
| `@opentelemetry/exporter-trace-otlp-proto` | 0.222.0 `[ASSUMED, same caveat as sdk-node]` | OTLP trace exporter over protobuf/HTTP | The "OTLP-compatible exporter" `ADR-0001-observability` names explicitly |
| `@opentelemetry/exporter-metrics-otlp-proto` | 0.222.0 `[ASSUMED, same caveat]` | OTLP metrics exporter | Same rationale; metrics are how queue depth/throughput/liveness are exported |
| `@opentelemetry/resources` | 2.11.0 `[ASSUMED, same caveat]` | Resource attribution (service name, instance id) on every exported signal | Needed so `apps/api` and `services/worker` are distinguishable in one collector |
| `@opentelemetry/sdk-metrics` | 2.11.0 `[ASSUMED, same caveat]` | Metrics SDK (Counter/Gauge/Histogram instruments, periodic export) | The instrument types criterion 2's four signals map onto |
| `@fastify/rate-limit` | 11.2.0 `[VERIFIED: npm registry — legitimacy check OK]` | IP-scoped rate limiting on session issuance (D-12) | Official Fastify org plugin; already compatible with the installed `fastify@^5.2.0`; supports a custom `keyGenerator` (needed to key on `request.ip` only inside the "mint new session" branch, not on every request) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pg_dump` / `pg_restore` (Postgres 16, bundled with the server) | matches `postgres:16-alpine` already pinned in `infra/deploy/docker-compose.yml` | Logical backup/restore of the Postgres database | Custom/directory format (`-Fc` or `-Fd`) for the backup job; `pg_dumpall --globals-only` alongside if roles/grants (e.g. `qwa_worker`) must survive a restore to a fresh cluster `[CITED: web search, PostgreSQL community sources]` |
| Trivy (`aquasecurity/trivy-action` or CLI) | current — verify at plan time | Container image + filesystem/dependency vulnerability scanning in CI | Broadest single tool: covers the `qmk-web-app/qmk-build` image, IaC, and secrets in one pass `[CITED: web search — 2026 comparison sources]` |
| Grype (optional second opinion) | current — verify at plan time | Focused vulnerability-only scan, lower false-positive rate | Pair with Trivy only if the primary scanner's noise becomes a problem; not required to satisfy the requirement alone `[CITED: web search]` |
| `npm audit` | bundled with the pinned npm/pnpm toolchain | Node dependency vulnerability check | Cheapest, ecosystem-native first pass; run on every CI build regardless of Trivy/Grype `[CITED: web search]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pg_advisory_xact_lock`-gated single `INSERT` for admission control | `SERIALIZABLE` isolation + retry-on-conflict for build creation | Serializable is more "textbook correct" and needs no lock-key management, but requires the caller to detect `40001` serialization failures and retry — more application-level plumbing than one transaction-scoped advisory lock, for a code path (build creation) that is not a hot loop |
| `@fastify/rate-limit` for session-issuance IP limiting | A small custom in-process sliding-window counter | `@fastify/rate-limit` is maintained by the Fastify org and matches the installed major version; a hand-rolled counter is exactly the kind of "don't hand-roll" case this phase should avoid unless the plugin's shape genuinely doesn't fit the "only rate-limit the mint-a-session branch" requirement |
| Self-hosted GitHub Actions runner (D-06, locked) | Hosted GitHub-provided runners with a pushed-to-registry build image | Rejected by the user's decision already (D-06) — hosted runners need a registry, an image-publish step, and a pinned QMK clone per run; recorded here only as the documented future migration path if the solo-repo assumption stops holding |
| Postgres-only backups (discretion default) | Backing up artifacts too (filesystem snapshot or S3 sync) | Rejected by the phase's own reasoning: artifacts are 7-day-ephemeral and deterministically reproducible from a stored revision plus the pinned catalog/QMK/generator/image identifiers — backing them up would duplicate what a rebuild already recovers |

**Installation:**
```bash
# apps/api and services/worker both need the OTel packages if both emit telemetry directly
pnpm --filter @qmk-web-app/api add @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/exporter-trace-otlp-proto @opentelemetry/exporter-metrics-otlp-proto \
  @opentelemetry/resources @opentelemetry/sdk-metrics
pnpm --filter @qmk-web-app/api add @fastify/rate-limit

# services/worker: mirror the same OTel set (worker liveness/build throughput originate here)
pnpm --filter <worker-package-name> add @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/exporter-trace-otlp-proto @opentelemetry/exporter-metrics-otlp-proto \
  @opentelemetry/resources @opentelemetry/sdk-metrics
```

**Version verification:** Ran `npm view <package> version` for every OTel package and
`@fastify/rate-limit` this session (see table above and the audit below). Versions shown are what the
registry returned on 2026-09-02; re-verify at plan/execute time since the OTel JS monorepo ships
frequent coordinated releases (the whole `@opentelemetry/*` set here was published within the same
24-hour window on 2026-08-31, which is a routine synchronized-release pattern for that project, not a
sign of instability — see Package Legitimacy Audit for why this still flags `SUS` under a
recency-only heuristic).

## Package Legitimacy Audit

| Package | Registry | Age (last publish) | Downloads/week | Source Repo | Verdict | Disposition |
|---------|----------|---------------------|-----------------|--------------|---------|-------------|
| `@opentelemetry/api` | npm | 2026-03-25 | 81,882,000 | github.com/open-telemetry/opentelemetry-js | OK | Approved |
| `@opentelemetry/sdk-node` | npm | 2026-08-31 | 17,842,402 | github.com/open-telemetry/opentelemetry-js | SUS (`too-new`) | Flagged — planner must add `checkpoint:human-verify` before install |
| `@opentelemetry/exporter-trace-otlp-proto` | npm | 2026-08-31 | 20,787,292 | github.com/open-telemetry/opentelemetry-js | SUS (`too-new`) | Flagged — planner must add `checkpoint:human-verify` |
| `@opentelemetry/exporter-metrics-otlp-proto` | npm | 2026-08-31 | 18,164,082 | github.com/open-telemetry/opentelemetry-js | SUS (`too-new`) | Flagged — planner must add `checkpoint:human-verify` |
| `@opentelemetry/resources` | npm | 2026-08-31 | 116,186,807 | github.com/open-telemetry/opentelemetry-js | SUS (`too-new`) | Flagged — planner must add `checkpoint:human-verify` |
| `@opentelemetry/sdk-metrics` | npm | 2026-08-31 | 56,855,321 | github.com/open-telemetry/opentelemetry-js | SUS (`too-new`) | Flagged — planner must add `checkpoint:human-verify` |
| `@fastify/rate-limit` | npm | 2026-07-29 | 2,648,486 | github.com/fastify/fastify-rate-limit | OK | Approved |

**Packages removed due to `[SLOP]` verdict:** none.

**Packages flagged as suspicious `[SUS]`:** `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-proto`,
`@opentelemetry/exporter-metrics-otlp-proto`, `@opentelemetry/resources`, `@opentelemetry/sdk-metrics`
— all five flagged solely on the legitimacy gate's `too-new` (recency-since-publish) heuristic. Every
one of them carries the identical, authoritative `github.com/open-telemetry/opentelemetry-js` source
repository, weekly download counts in the tens of millions, and a publish timestamp within the same
24-hour window as every other package in that monorepo — the signature of a routine coordinated
version bump across a multi-package repo, not a slopsquat or a fresh malicious publish. This
mitigating context does not waive the protocol: per the Package Legitimacy Gate, the planner MUST
still insert a `checkpoint:human-verify` task before each of these five installs so a human confirms
the exact version/hash pinned at execute time, since "the legitimacy gate flags it" is a mechanical
signal independent of this session's read of *why* it flagged.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
                         │              Reverse proxy (deploy)           │
                         │  sets X-Forwarded-For; the one trusted hop    │
                         └───────────────────┬───────────────────────────┘
                                              │
                                              ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ apps/api (Fastify, trustProxy = <hop>)                                     │
 │                                                                             │
 │  onRequest (session hook)                                                  │
 │   ┌─ existing valid cookie? ──yes──▶ request.ownerId = cookie's id         │
 │   └─ no ──▶ [D-12] IP rate limit gate (session-issuance only) ──▶ mint     │
 │              session, set cookie                                          │
 │                                                                             │
 │  POST /v1/configurations/:id/builds                                       │
 │   ┌─ validateConfiguration() (existing, unchanged) ─────────────┐         │
 │   └─ prepareBuild() ──▶ [D-11/D-13] ONE atomic INSERT:            │         │
 │        WITH lock AS (pg_advisory_xact_lock(...)),                 │         │
 │             counts AS (SELECT global_active, owner_active,        │         │
 │                                owner_hourly FROM builds ...)       │         │
 │        INSERT ... SELECT ... WHERE counts satisfy all three caps  │         │
 │        ON CONFLICT (owner_id, idempotency_key) DO NOTHING          │         │
 │        RETURNING * / observed counts                               │         │
 │   ──▶ 201 (created) / 200 (idempotent replay) / 429 BUILD_QUEUE_LIMITED    │
 │                                                                             │
 │  [telemetry] OTel meter: gauge(queue.depth), counter(builds.total,         │
 │   status), histogram(build.duration) ──OTLP──▶ collector (deploy concern) │
 └───────────────────────────────┬───────────────────────────────────────────┘
                                  │ shared Postgres (builds table = the queue)
                                  ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ services/worker (QueueRunner)                                              │
 │  claim() → generate → DockerSandbox compile → redactLog() → complete/fail  │
 │  maintain() [D-retention]: reclaimExpiredLeases(); reap() ──▶ NEW: write   │
 │   a durable "what was deleted, when" record (structured log event or a    │
 │   deletions table) before/alongside deleting blobs                        │
 │  [telemetry] OTel meter: gauge(worker.liveness heartbeat), counter         │
 │   (builds.completed, failure_code) ──OTLP──▶ collector                    │
 └───────────────────────────────┬───────────────────────────────────────────┘
                                  │ same isolated build image + pinned QMK checkout
                                  ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ CI: self-hosted GitHub Actions runner (same host, same image, same QMK)   │
 │  pull_request (NOT fork; guarded by job-level `if` + repo approval gate)   │
 │   ┌─ always: typecheck + vitest (fast path) ─────────────────────────┐    │
 │   └─ path-filtered [generator|templates|QMK pin|build image changed]:      │
 │        run-matrix.ts (D-07) over the curated fixture set (D-08) —         │
 │        every entry compiles; one designated entry double-builds and      │
 │        asserts byte-identical SHA-256 (D-10)                              │
 │        skip-path job still reports an explicit `success`, never absent    │
 │        (D-09 sharp edge)                                                  │
 └───────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
apps/api/src/
├── builds/
│   ├── service.ts          # prepareBuild() unchanged shape; assertWithinQuota() removed,
│   │                        # replaced by the atomic create() call below
├── observability/           # NEW — OTel SDK bootstrap for the API process
│   └── otel.ts
├── session.ts               # D-12/D-14: rate-limit gate on mint-branch; trustProxy passed in
└── server.ts                # D-04: QWA_SESSION_SECRET required unconditionally; SameSite set

packages/build-queue/src/
├── postgres-store.ts         # create() gains the admission-control CTE (D-11/D-13)
├── memory-store.ts           # create() gains an equivalent in-process check so the contract
│                              # test (single source of truth for both stores) still passes
└── store-contract.test.ts    # NEW concurrency assertions: N simultaneous create() calls
                               # against a cap of K produce exactly K accepted builds

services/worker/
├── src/
│   ├── observability/        # NEW — OTel SDK bootstrap for the worker process
│   │   └── otel.ts
│   ├── queue-runner.ts       # maintain(): reap() results also written to a durable
│   │                          # retention record (log event or table)
│   └── retention-ledger.ts   # NEW (if the planner picks the table option over log-only)
└── scripts/
    ├── run-matrix.ts          # NEW — the D-07 extraction target
    ├── fixtures/
    │   ├── smoke.ts           # today's smoke-build.ts fixture, as data
    │   └── socd.ts            # today's socd-compile-matrix.ts FIXTURES table, as data
    ├── smoke-build.ts         # becomes a thin call into run-matrix.ts (or removed)
    └── socd-compile-matrix.ts # becomes a thin call into run-matrix.ts (pnpm socd:matrix
                                 # keeps working per D-07)

.github/workflows/            # NEW — this repository's first CI
├── ci-fast.yml                # typecheck + vitest, every PR, hosted or self-hosted either way
└── ci-matrix.yml               # path-filtered curated matrix + double-build check, self-hosted
                                 # runner only, fork-PR guard, dependency/image scanning job

docs/
└── licensing-review.md         # NEW — the recorded QMK/bundled-asset licensing review
```

### Pattern 1: Atomic multi-predicate build admission

**What:** One `INSERT` statement that (a) acquires a transaction-scoped advisory lock so the
count-then-insert region cannot race across concurrent API processes, (b) computes the global
queue-depth count, the requesting owner's active count, and the requesting owner's hourly count in
one pass over `builds`, and (c) only inserts if all three checks pass — falling straight through to
the existing idempotency `ON CONFLICT` handling if a duplicate `(owner_id, idempotency_key)` is
resubmitted.

**When to use:** Every build-creation call. Replaces `assertWithinQuota()` (currently a separate
`countActiveForOwner`/`countRequestedSince` read, then a conditional throw, then a *separate*
`create()` insert — three round trips with a race window between each) and extends
`PostgresBuildStore.create()`'s existing `ON CONFLICT DO NOTHING` insert
(`packages/build-queue/src/postgres-store.ts:112-154`, read this session) with the new predicates.

**Example (illustrative shape — exact column list must match the real `create()` insert this session
read at `packages/build-queue/src/postgres-store.ts:116-122`):**
```sql
-- Source: this session's design synthesis from PostgreSQL advisory-lock semantics
-- [ASSUMED — not fetched from a PostgreSQL doc page this session; verify locking
-- behavior with a concurrency test before relying on it in production]
WITH lock_gate AS (
  -- Transaction-scoped: blocks concurrent admission decisions until this
  -- transaction commits or rolls back, without locking the whole table.
  SELECT pg_advisory_xact_lock(hashtext('qwa:build-admission'))
),
counts AS (
  SELECT
    count(*) FILTER (WHERE status IN ('queued','preparing','building','uploading'))
      AS global_active,
    count(*) FILTER (WHERE owner_id = $4
      AND status IN ('queued','preparing','building','uploading')) AS owner_active,
    count(*) FILTER (WHERE owner_id = $4 AND requested_at >= $14) AS owner_hourly
  FROM builds, lock_gate
)
INSERT INTO builds
  (id, configuration_id, configuration_revision, owner_id, catalog_version,
   qmk_commit, generator_version, build_image_ref, build_image_digest, status,
   idempotency_key, requested_at, attempt_count)
SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
FROM counts
WHERE global_active   < $15   -- new: BUILD_LIMITS.maxGlobalActiveBuilds
  AND owner_active     < $16  -- BUILD_LIMITS.maxActiveBuildsPerOwner (existing value)
  AND owner_hourly      < $17 -- BUILD_LIMITS.maxBuildsPerOwnerPerHour (existing value)
ON CONFLICT (owner_id, idempotency_key) DO NOTHING
RETURNING *;
```
If the `INSERT ... SELECT` returns no row and no existing idempotency-key row is found either, the
caller must distinguish "rejected by a cap" from "conflicted" — this requires the caller to re-read
the `counts` values (e.g. via a preceding read in the same transaction, or by returning them
alongside `RETURNING`) to build a specific, user-safe `BUILD_QUEUE_LIMITED` message ("global queue is
full" vs. "you already have N builds queued" vs. "hourly limit reached") — the three existing user
message strings in `assertWithinQuota` should be preserved, just re-attached to a different code
path.

### Pattern 2: Session-issuance IP rate limit as a scoped hook, not global middleware

**What:** `registerSessions`'s existing `onRequest` hook (`apps/api/src/session.ts:75-102`, read this
session) already branches on "valid cookie present" vs. "mint a new session." D-12 requires the rate
limit ONLY on the mint branch — a returning user with a valid cookie must never be rate-limited by
IP, since the whole point is that per-owner quotas already govern them.

**When to use:** Attach a `@fastify/rate-limit`-backed check (or an equivalent counter) inside the
`else` branch of the existing cookie-verification logic, keyed on `request.ip` (which requires
`trustProxy` to be configured per D-14 — Fastify's `request.ip` is documented to derive from
`X-Forwarded-For` only when `trustProxy` is enabled `[CITED: fastify.dev/docs/latest/Reference/Request]`).
On rejection, respond in a way that does not silently swallow a legitimate first-time visitor behind
a busy NAT — D-12 explicitly requires the limit be "generous enough for many legitimate users behind
one NAT."

**Example:**
```typescript
// Source: this session's synthesis against Fastify's documented request.ip/trustProxy
// behavior [CITED: fastify.dev/docs/latest/Reference/Request and /Server]
import rateLimit from '@fastify/rate-limit';

// Registered once, but its default per-route application is disabled; only the
// session-mint branch below calls its check function directly, so a valid-cookie
// request never consumes a rate-limit slot at all.
await app.register(rateLimit, { global: false });

app.addHook('onRequest', async (request, reply) => {
  const existing = verify(readCookie(request.headers.cookie, SESSION_COOKIE) ?? '', options.secret);
  if (existing) {
    request.ownerId = existing;
    return;
  }
  // D-12: only the mint-a-new-session path is IP-scoped.
  // (exact API depends on the plugin version pinned at execute time — verify
  // against @fastify/rate-limit's own docs for the "manual check" pattern before
  // committing to this shape in a plan.)
  ...
});
```

### Pattern 3: Curated matrix runner as data-driven fixtures, not duplicated scripts

**What:** `smoke-build.ts` and `socd-compile-matrix.ts` (both read in full this session) already
share the identical pipeline shape: `loadManifest()` → `openPublishedCatalog()` → build a
`Configuration` input → `validateConfiguration`/`validateForMatrix` → `DockerSandbox` →
`runBuild()` → assert `result.status === 'succeeded'`. `socd-compile-matrix.ts` additionally carries
the load-bearing guard: *"any keyboard the registry already records as compile-verified for this
catalog version must have a fixture"* (`socdVerifiedKeyboards(...)` checked against the `FIXTURES`
table at lines 168-175, read this session) — this guard is the actual evidence behind
`MODULE_REGISTRY`'s `verifiedFor` claims and must survive the refactor byte-for-byte in behavior.

**When to use:** Extract a `run-matrix.ts` that takes a fixture-set argument (a smoke fixture with no
SOCD, or the SOCD fixture table) and runs the shared pipeline once per fixture; keep both
`pnpm socd:matrix` and the smoke-check as thin wrappers that call it with their respective fixture
sets, per D-07's explicit requirement that `pnpm socd:matrix` stays a named entry point.

**Example (structure, not literal code — see the two source files for exact validation logic):**
```typescript
// Source: this session's read of services/worker/scripts/{smoke-build,socd-compile-matrix}.ts
interface MatrixFixture {
  keyboardId: string;
  layoutId: string;
  buildInput: (catalog: Catalog) => unknown;  // shape validated by validateForMatrix or validateConfiguration
  assertDoubleReproducible?: boolean;          // D-10: exactly one designated fixture sets this
}

async function runMatrix(fixtures: MatrixFixture[], opts: { catalogPath: string }): Promise<void> {
  // 1. load manifest + published catalog (shared)
  // 2. verify registry-fixture guard: every MODULE_REGISTRY verifiedFor entry for this
  //    catalog version must appear in `fixtures` (D-07 invariant, unchanged from today)
  // 3. for each fixture: validate, generate, compile, assert firmware produced
  // 4. for the fixture(s) with assertDoubleReproducible: build twice, assert equal SHA-256
}
```

### Pattern 4: Path-filtered required check that always reports a status

**What:** GitHub's required-status-check mechanism has no concept of "skipped counts as passed" —
if a workflow never runs (because a `paths:` filter excluded it), the check simply never reports,
and a PR that needs it stays blocked forever `[CITED: web search — github.com/orgs/community
discussions #54877, #142210, #44490]`. D-09 explicitly calls this out as a sharp edge to handle
deliberately.

**When to use:** Do NOT put the `paths:` filter on the *workflow* trigger for the matrix job if that
job is a required check. Instead, run the workflow on every PR and use a job-level `if:` condition
(fed by a preceding "detect changed paths" step, e.g. `dorny/paths-filter` or an inline `git diff`
check) so the skip path still executes a job that reports `success` — GitHub reports a job skipped by
a conditional as a completed (success) status, which satisfies a required check, whereas a workflow
never triggered at all reports nothing `[CITED: web search synthesis of the above discussions]`.

**Example:**
```yaml
# Source: synthesis of GitHub Community discussions #54877 / #142210 / #44490,
# read via WebSearch this session [CITED]
name: curated-matrix
on: pull_request
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      matrix-relevant: ${{ steps.filter.outputs.matrix-relevant }}
    steps:
      - uses: actions/checkout@v4
      - id: filter
        run: |
          # detect touched paths against generator/, templates/, infra/qmk/manifest.json, infra/qmk/Dockerfile
          # set matrix-relevant=true/false as a step output
  matrix:
    needs: changes
    if: needs.changes.outputs.matrix-relevant == 'true'
    runs-on: [self-hosted, qmk-build]
    steps:
      - run: pnpm run matrix   # the new run-matrix.ts entry point
  matrix-skip:
    needs: changes
    if: needs.changes.outputs.matrix-relevant == 'false'
    runs-on: ubuntu-latest
    steps:
      - run: echo "no generator/template/QMK-pin/build-image changes; matrix not required for this PR"
  # Branch protection's required check name should target a check that is ALWAYS
  # produced by either `matrix` or `matrix-skip` — e.g. both jobs report under one
  # logical check name via a final always-run "matrix-result" job that depends on
  # both and never itself has a path condition.
```

### Pattern 5: Fork-PR guard on the self-hosted runner, as defense in depth

**What:** GitHub's repository setting "Require approval for all outside collaborators" (Settings →
Actions → General) gates whether a fork PR's workflow run starts at all on a public repository, but
GitHub's own guidance is explicit that *approval does not eliminate the risk* — an approver can still
be tricked into approving a malicious PR, and the runner still executes whatever the approved
workflow says `[CITED: web search — GitHub Community discussion #26722, "How to Secure a Self-Hosted
Runner Against Public-Repo PRs"]`. D-06 states the constraint in absolute terms ("must never execute
fork PRs"), so the workflow itself should carry a second, independent guard.

**When to use:** Every workflow file that targets the `[self-hosted, qmk-build]` runner.

**Example:**
```yaml
# Source: synthesis from GitHub Actions security guidance read via WebSearch this
# session [CITED]
jobs:
  matrix:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: [self-hosted, qmk-build]
    ...
```

### Anti-Patterns to Avoid

- **Checking a count, then inserting, in two separate queries (the current `assertWithinQuota` +
  `create()` shape).** This is exactly the race `ADR-0004-idempotency` already rejected for
  idempotency ("an application-level check races with itself") — D-11/D-13 apply the identical
  reasoning to the queue-depth and per-owner caps.
- **A `paths:` filter directly on a required workflow's `on:` trigger.** Produces a check that never
  reports when the filter excludes a PR's changes, blocking merges forever (Pattern 4).
- **Relying solely on GitHub's fork-PR approval setting for a self-hosted runner.** Approval is a
  human gate, not a technical control; combine it with a job-level `if:` guard (Pattern 5).
- **Backing up artifacts.** They are 7-day-ephemeral by design and deterministically reproducible
  from a stored revision — backing them up duplicates a rebuild's job for no added durability
  guarantee, and the phase's own discretion default already rejects this.
- **Introducing Tailwind/Radix for the D-02/D-03 UI work.** CONTEXT.md's premise that these patterns
  already exist in `apps/web` does not hold (see Summary correction); adding a styling framework
  mid-phase for two small controls is new dependency surface outside what D-05 (no UI contract)
  intended.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OTLP-formatted telemetry export | A custom JSON-over-HTTP sender to a collector endpoint | `@opentelemetry/exporter-trace-otlp-proto` / `-metrics-otlp-proto` | OTLP is a real wire protocol (protobuf schema, retry/backoff semantics, resource/attribute encoding); a hand-rolled sender would need to reinvent all of that to be OTLP-*compatible*, which is the literal requirement from `ADR-0001-observability` |
| IP-scoped rate limiting with correct sliding-window semantics | A `Map<ip, timestamps[]>` with manual pruning | `@fastify/rate-limit` | Off-by-one window boundaries and memory growth under a slow memory leak are exactly the kind of subtle bug a maintained library has already worked through; the plugin also has a documented `keyGenerator` seam that fits D-12's "only the mint branch" requirement |
| Container image vulnerability scanning | Parsing `docker history`/manifest layers and cross-referencing a hand-maintained CVE list | Trivy or Grype | Both maintain daily-updated vulnerability databases across OS packages and language ecosystems; a hand-rolled scanner would be permanently behind and is exactly the "controlled QMK refresh process" the phase already treats as separate, real infrastructure work |
| Postgres backup file format and restore tooling | A custom table-dump-to-JSON exporter | `pg_dump`/`pg_restore` in custom or directory format | These are the database's own, transactionally-consistent, schema-aware backup tools; a custom exporter would need to reinvent consistent snapshotting (`pg_dump` takes a single transaction snapshot) and would not restore roles/grants without also reimplementing `pg_dumpall --globals-only`'s job |

**Key insight:** every "don't hand-roll" item in this phase is a place where the *shape* of a correct
solution (a wire protocol, a sliding window, a CVE database, a consistent snapshot) is genuinely hard
to get right incrementally — these are not "convenience" libraries, they are correctness libraries.

## Common Pitfalls

### Pitfall 1: Naive conditional INSERT still races under READ COMMITTED

**What goes wrong:** A straightforward `INSERT ... SELECT ... WHERE (SELECT count(*) FROM builds
WHERE status IN (...)) < $cap` looks atomic because it is "one statement," but Postgres evaluates the
subquery against a snapshot taken at statement start under the default `READ COMMITTED` isolation
level. Two concurrent transactions running this exact statement can each see "count = cap - 1" and
each insert, exceeding the cap by up to (concurrent racers - 1).

**Why it happens:** MVCC snapshot isolation does not lock the *absence* of future rows — there is no
row to lock yet, so a plain `SELECT count(*)` inside the same statement provides no protection against
a concurrent phantom insert.

**How to avoid:** Serialize the count-then-insert region with a transaction-scoped advisory lock
(`pg_advisory_xact_lock`) inside a leading CTE of the same statement (Pattern 1), or use
`SERIALIZABLE` isolation with retry-on-`40001`. Either way, this must be proven with a real
concurrency test — the existing `apps/api/src/builds/store-contract.test.ts` (read this session,
confirmed to run "the queue's real concurrency semantics against Postgres") is exactly the place to
add "N simultaneous `create()` calls against cap K produce exactly K accepted builds."

**Warning signs:** A load test or burst of legitimate traffic produces a queue depth slightly over the
configured cap, non-deterministically, worse under higher concurrency.

### Pitfall 2: A path-filtered required check blocks merges forever

**What goes wrong:** If the curated-matrix workflow's own `on: pull_request: paths: [...]` trigger
excludes a PR (because it only touches, say, documentation), the workflow never runs, the required
check attached to it never reports, and GitHub's branch protection waits indefinitely — the PR cannot
be merged even though the required check is, semantically, "not applicable."

**Why it happens:** GitHub has no branch-protection concept of "a check that never ran counts as
passed" — only a job that ran and either succeeded, failed, or was itself skipped by an `if:` inside
a workflow that DID trigger reports a status at all `[CITED: web search — see Pattern 4 sources]`.

**How to avoid:** Trigger the workflow unconditionally on every PR; gate the expensive matrix job
itself with a job-level `if:` fed by a changed-paths detection step, and ensure a companion "skip"
job (or a single job with branching steps) reports a completed status regardless of which path is
taken (Pattern 4).

**Warning signs:** A PR that only touches, e.g., `README.md` sits with the matrix check stuck on
"Expected — Waiting for status to be reported" indefinitely.

### Pitfall 3: `request.ip` is spoofable without `trustProxy`, and wrong with it misconfigured

**What goes wrong:** Without `trustProxy` configured, `request.ip` is the reverse proxy's own socket
address for every request — every user collapses into one IP bucket, silently defeating D-12's rate
limit for everyone at once. With `trustProxy: true` (trust *any* hop) behind a proxy that does not
strip/rewrite an incoming `X-Forwarded-For`, a client can simply set that header itself and claim any
IP, defeating the limit the other way.

**Why it happens:** Fastify's documented behavior is that `request.ip` is taken from
`socket.remoteAddress`, or from `X-Forwarded-For` **only** when `trustProxy` is enabled, and
`trustProxy` accepts a specific IP/CIDR, an array, or a boolean/function — the correct configuration
is the *specific* trusted hop, not blanket `true`, when there is exactly one known reverse proxy
`[CITED: fastify.dev/docs/latest/Reference/Server and /Request]`.

**How to avoid:** D-14 already specifies this correctly — configure `trustProxy` to the known proxy
hop (not `true`), and fail loudly at startup if it is unset in production, mirroring the existing
`QWA_SESSION_SECRET` guard pattern in `apps/api/src/server.ts` (read this session, lines 37-40).

**Warning signs:** Every anonymous session appears to originate from the same IP in logs/telemetry;
or a rate limit that never triggers no matter how much traffic one source sends.

### Pitfall 4: Self-hosted runner + fork PR is a code-execution vector, not just a "noisy CI" risk

**What goes wrong:** Anyone able to open a pull request against the repository can include a modified
workflow file in their fork; if that workflow is ever executed on the self-hosted runner, it runs
with the same access as the runner process itself — filesystem, Docker socket, and any credentials
the runner's environment holds `[CITED: web search — Wiz "Hardening GitHub Actions," Legit Security,
GitHub Community discussion #26722]`.

**Why it happens:** Self-hosted runners execute arbitrary workflow-defined code by design; unlike
GitHub-hosted runners, the environment is not necessarily ephemeral, so a compromise can persist
across jobs.

**How to avoid:** D-06 already records this as a hard constraint. Enforce it in two independent
layers: the repository's fork-PR approval setting, AND a job-level `if:` guard comparing
`github.event.pull_request.head.repo.full_name` to `github.repository` (Pattern 5) — since approval
alone is a human control that can be socially engineered.

**Warning signs:** A workflow run appears against a PR from a fork; any runner job attempts network
access or file writes outside the expected build workspace.

### Pitfall 5: Redaction added to a new sink is easy to forget

**What goes wrong:** `services/worker/src/redact.ts` already redacts container-internal paths,
secrets, and bearer tokens from logs before they reach a build's stored log — but this redaction is
currently applied only at the point logs are stored for a user to read (`#storeLog` in
`queue-runner.ts`). Adding OTel log/trace/metric export is adding a *new* sink; if telemetry
attributes ever include raw error messages, file paths, or request headers, that data reaches the
collector unredacted even though the existing log-storage path is safe.

**Why it happens:** Redaction is currently a function called at one call site, not a property of a
shared logging/export abstraction — a new sink added elsewhere does not automatically inherit it.

**How to avoid:** `ADR-0001-observability` is explicit: "Log redaction rules … apply to every sink
added later." Route every OTel log record (if log export is used) and any span/metric attribute that
could carry a path or secret through `redactLog` (or an equivalent structured-attribute redaction
pass) before export, not just before storage.

**Warning signs:** A trace span attribute or metric label contains an absolute filesystem path or a
value matching the existing `SECRET_PATTERNS`/`PATH_REPLACEMENTS` regexes in `redact.ts`.

## Code Examples

### OTel Node SDK bootstrap (API or worker process)

```typescript
// Source: this session's synthesis of the OpenTelemetry JS SDK's documented
// initialization requirement — "the SDK must be initialized before any other
// module in your application is loaded" [CITED: opentelemetry.io/docs/languages/js/exporters/,
// via WebSearch this session]. Exact API surface (constructor option names) must be
// verified against the pinned package version at plan/execute time — this is
// illustrative of shape, not a literal, tested snippet.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ 'service.name': 'qwa-api' }), // or 'qwa-worker'
  traceExporter: new OTLPTraceExporter({
    url: process.env['QWA_OTEL_EXPORTER_URL'], // collector endpoint; a deployment concern
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: process.env['QWA_OTEL_EXPORTER_URL'] }),
  }),
});
sdk.start(); // must run before any instrumented module is imported
```

### Structured retention ledger event (extends the existing `maintain()` log call)

```typescript
// Source: this session's read of services/worker/src/queue-runner.ts's existing
// maintain() and #log() pattern (lines 90-92, 162-197) — this extends the pattern
// already in the file rather than introducing a new one.
async maintain(): Promise<{ requeued: number; failed: number; objectsDeleted: number }> {
  const reclaimed = await this.#options.queue.reclaimExpiredLeases({ /* ... */ });
  const reaped = await this.#options.queue.reap({ /* ... */ });

  // NEW: a durable, queryable record of what retention deleted and when —
  // criterion 4's "state what retention actually deleted and when."
  if (reaped.artifactKeys.length > 0 || reaped.logKeys.length > 0) {
    this.#log({
      level: 'info',
      message: 'retention deletion',
      artifactCount: reaped.artifactKeys.length,
      logCount: reaped.logKeys.length,
      buildsExpired: reaped.buildsExpired,
      deletedAt: new Date().toISOString(),
      // If the planner judges structured logs insufficient for an operator to
      // "state what was deleted and when" after log rotation, add a durable
      // `retention_events` table write here instead of/alongside this log line.
    });
  }
  // ... existing objectsDeleted loop unchanged
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Per-owner build quotas checked with a separate read then a separate insert (`assertWithinQuota` + `create()`) | Both checks folded into one conditional `INSERT`, alongside a new global cap, guarded by a transaction-scoped advisory lock | This phase (D-11/D-13) | Removes the race window between the count read and the insert; makes the admission decision correct with more than one API process |
| No global build concurrency limit or IP-based rate limiting (only per-session quotas) — `README.md` § Known gaps, read this session | Global queue-depth cap (D-11) + IP-scoped session-issuance limit (D-12) | This phase | Closes the exact gap `README.md` names |
| Only `crkbd/rev1` has been through a real compile; no curated smoke matrix (`README.md` § Known gaps) | A curated matrix (extending from `crkbd/rev1` AVR and `mode/m256wh` ARM/STM32, both already `verifiedFor` at `compile` strength per `packages/domain/src/module-registry.ts:219-236`, read this session) gates merges via required CI | This phase | "Catalogued" (3,743 keyboards) and "known to build" (the matrix) become distinguishable claims with an enforced gate, not just a manual script someone might forget to run |
| No CI at all (`.github/workflows/` does not exist — confirmed by directory listing this session) | Self-hosted GitHub Actions CI with a fast always-on check and a path-filtered matrix | This phase | First automated gate on this repository; also the first place fork-PR/self-hosted-runner risk becomes real |
| No `@opentelemetry/*` dependency anywhere in the repo (confirmed by dependency-tree grep this session) — only structured `console.log(JSON.stringify(...))` in the worker | OTel SDK + OTLP exporters layered under the existing structured logs | This phase | Satisfies `ADR-0001-observability`'s stated two-stage plan ("structured JSON logs now, OpenTelemetry-compatible exporters before public access") — the "before public access" trigger is this phase |

**Deprecated/outdated:** Nothing in this codebase is being deprecated by this phase — Phase 5 is
additive hardening on top of Phases 0-4's shipped decisions. The one exception is
`assertWithinQuota()`'s read-then-check shape (`apps/api/src/builds/service.ts:120-140`, read this
session), which is superseded by the atomic admission-control insert and should be removed once the
new path is proven, not left as dead code beside it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@opentelemetry/sdk-node`, `-exporter-trace-otlp-proto`, `-exporter-metrics-otlp-proto`, `@opentelemetry/resources`, and `@opentelemetry/sdk-metrics` are the correct package names/shapes for a Node OTLP setup, at the versions shown | Standard Stack; Code Examples | If the exact package boundaries have shifted (OTel JS periodically merges/splits packages), the plan's install step and bootstrap code need adjustment at execute time — mitigated by the required `checkpoint:human-verify` from the Package Legitimacy Audit |
| A2 | A `pg_advisory_xact_lock`-gated CTE inside a single `INSERT` statement correctly serializes the count-then-insert admission-control region across concurrent Postgres sessions | Architecture Patterns § Pattern 1; Common Pitfalls § 1 | If the locking semantics are subtly wrong (e.g., lock scope, hash-key collisions with an unrelated use of `pg_advisory_xact_lock` elsewhere), the global/per-owner caps could still be violated under concurrency — mitigated by the explicit requirement (stated in this doc) for a real concurrency test in `store-contract.test.ts` before this ships |
| A3 | `@fastify/rate-limit`'s API supports a "manual check inside one hook branch" usage pattern compatible with D-12's "only the session-mint branch" requirement | Architecture Patterns § Pattern 2 | If the installed version's API doesn't cleanly support scoped/manual invocation, the planner may need a small custom counter instead — still preferable to abandoning atomicity, but changes the install list |
| A4 | GitHub's fork-PR approval setting name and behavior ("Require approval for all outside collaborators") is current as described | Architecture Patterns § Pattern 5; Common Pitfalls § 4 | If GitHub has renamed or changed this setting's semantics, the planner should re-verify the exact setting name in the repository's Settings → Actions UI at execute time rather than trusting this doc's label |
| A5 | Trivy and/or Grype are the right default choice for the dependency/image scanning CI job | Standard Stack; Don't Hand-Roll | Low risk — this is a "which of several good options" choice, not a correctness-critical one; either tool (or `npm audit` alone as a first pass) satisfies the requirement's letter |

**If this table is empty:** N/A — see entries above.

## Open Questions

1. **Exact numeric value for the global queue-depth cap and the session-issuance IP limit.**
   - What we know: `BUILD_LIMITS` already documents its existing numbers with rationale comments
     (`maxActiveBuildsPerOwner: 2`, `maxBuildsPerOwnerPerHour: 20`) — the same comment discipline
     should extend to the new constants (`packages/domain/src/limits.ts`, read this session).
   - What's unclear: what global concurrent-build count the single build host can actually sustain
     (a function of CPU/memory available to the Docker sandbox, not something this research session
     can measure) and what a "generous" session-issuance-per-IP number looks like in practice.
   - Recommendation: CONTEXT.md already marks this "Claude's discretion — open numbers and
     mechanics." The planner should pick conservative starting values with the same inline-comment
     rationale style as the existing `BUILD_LIMITS`, and treat them as tunable, not load-bearing to
     get exactly right on the first attempt.

2. **Matrix membership beyond the two existing anchors.**
   - What we know: the published catalog (`catalogs/0.33.13-1/index.json`, read this session) carries
     a `processor`/`bootloader` field pair on every entry; among the 3,743 supported keyboards there
     are 59 distinct `(processor, bootloader)` pairs, with `(atmega32u4, caterina)` (crkbd/rev1's
     pair, 700 keyboards) and `(STM32F401, stm32-dfu)` (mode/m256wh's pair, 90 keyboards) already
     represented at `compile` verification strength.
   - What's unclear: exactly which additional pairs the planner should pick for the curated matrix,
     and how many entries the matrix should have (CONTEXT.md's discretion list names "the matrix's
     size cap" as open).
   - Recommendation: query the published catalog's distinct `(processor, bootloader)` pairs at plan
     time (the same query this session ran: `python3` over `index.json`, or an equivalent script) and
     pick a small number of additional pairs by frequency/toolchain distinctness (e.g. `RP2040`, a
     second ARM family distinct from STM32F401) — write the selection criteria down as D-08 already
     requires, rather than inventing a popularity ranking the catalog doesn't carry.

3. **Whether retention needs a table or structured logs suffice.**
   - What we know: `QueueRunner.maintain()`'s `reap()` already returns exactly the data needed
     (`artifactKeys`, `logKeys`, `buildsExpired`) but nothing durable records it beyond an optional
     log line today.
   - What's unclear: whether "an operator can state what retention actually deleted and when"
     (criterion 4) is satisfied by a searchable log sink (which the new OTel/structured-logging work
     in this same phase would make queryable) or needs its own Postgres table for longer-than-log-
     retention auditability.
   - Recommendation: CONTEXT.md's own discretion section already frames this as "structured log
     events at minimum; a deletions table if the planner judges logs insufficient" — start with the
     log-event extension (Code Examples § retention ledger) since it reuses the exact pattern already
     in the file, and only add a table if the chosen log retention window is shorter than the
     operational need to answer "what did retention delete last month."

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker (on the build host) | Curated smoke matrix, existing `DockerSandbox` | ✓ (already required by Phase 3/4) | — (existing infra, not re-verified this session) | — |
| GitHub (repository host) | Self-hosted Actions runner, branch protection | ✓ | `git remote -v` confirms `github.com:TristanNguyen0/qmk-web-app.git` `[VERIFIED: git remote -v output this session]` | — |
| Postgres 16 | Backups/restore drills | ✓ | `postgres:16-alpine` pinned in `infra/deploy/docker-compose.yml`, read this session | — |
| An OTLP-compatible collector (deployment-side) | Telemetry export destination | Unknown — not this repo's concern per `ADR-0001-observability` ("the collector is a deployment concern") | — | Any OTLP-compatible collector (Grafana Alloy, the OpenTelemetry Collector itself, a vendor agent) works; the application code is exporter-agnostic by design |
| A reverse proxy that sets `X-Forwarded-For` (deployment-side) | D-14's `trustProxy` requirement | Unknown — stated as a deployment requirement, not verified in this dev environment | — | None — D-14 requires production start-up to fail loudly if this is not configured, by design |

**Missing dependencies with no fallback:**
- A reverse proxy setting `X-Forwarded-For` correctly in front of the API in production — by design,
  there is no fallback; the phase's own decision (D-14) is to fail loudly rather than silently
  degrade.

**Missing dependencies with fallback:**
- The OTLP collector is a deployment-time choice with several viable options; nothing in the
  application depends on a specific one.

## Validation Architecture

`.planning/config.json`'s `workflow` key does not set `nyquist_validation` `[VERIFIED:
.planning/config.json, read this session — the file's only content is
`{"workflow": {"_auto_chain_active": false}}`]`; per the absent-key rule this section is included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^2.1.8 `[VERIFIED: package.json devDependencies, read this session]` |
| Config file | `vitest.config.ts` (repo root) — `include: ['packages/**/*.test.ts', 'services/**/*.test.ts', 'apps/**/*.test.ts']`, `testTimeout: 30_000` `[VERIFIED: vitest.config.ts, read this session]` |
| Quick run command | `pnpm test` (runs `vitest run`) |
| Full suite command | `pnpm test` (same — this repo has one suite, not a split fast/full split today; integration tests self-gate on `QWA_INTEGRATION`/Postgres reachability per the comment in `vitest.config.ts`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-hardening-abuse-controls | N simultaneous build-creation calls against a global cap of K produce exactly K accepted builds and the rest `BUILD_QUEUE_LIMITED` | integration (real Postgres) | `pnpm test -- store-contract` (extends the existing contract test) | ✅ file exists (`apps/api/src/builds/store-contract.test.ts`) — ❌ Wave 0 gap: the concurrency assertion itself does not exist yet |
| REQ-hardening-abuse-controls | Session-issuance IP limit rejects a burst from one IP but not a returning cookie-holder | unit/integration (Fastify inject) | `pnpm test -- session` | ❌ Wave 0 — no `session.test.ts` exists today (confirmed by directory listing this session) |
| REQ-smoke-matrix | `run-matrix.ts` fails if a `MODULE_REGISTRY.verifiedFor` entry has no fixture | unit | `pnpm test` (if the guard is extracted into a testable function) or `pnpm socd:matrix`-equivalent as a script-level assertion | ✅ the guard exists today in `socd-compile-matrix.ts`; ❌ Wave 0 gap if the planner wants it as a fast unit test rather than only exercised by the real (slow, Docker-dependent) matrix run |
| REQ-smoke-matrix | Two builds of the designated reproducibility fixture are byte-identical | integration (real Docker + QMK image) | `pnpm run matrix` (new) / today's `smoke-build.ts` | ✅ this exact assertion already exists in `smoke-build.ts`, read this session |
| REQ-backup-retention-controls | A retention sweep records what it deleted (queryable after the fact) | unit (`maintain()` return shape) + manual (drill) | `pnpm test -- queue-runner` | ❌ Wave 0 — no test asserts the new durable-record behavior yet, since it doesn't exist yet |
| REQ-observability-telemetry | Redaction applies to a new telemetry sink the same way it applies to stored logs | unit | `pnpm test -- redact` (extend existing `redact.ts` tests, or add an OTel-attribute-specific test) | Existing `redact.ts` has "its own tests" per this session's canonical-refs read; ❌ Wave 0 gap for the new-sink-specific case |

### Sampling Rate

- **Per task commit:** `pnpm test` (whole suite is fast enough today to run per-commit; integration
  tests self-skip without Postgres/Docker per the existing `vitest.config.ts` comment)
- **Per wave merge:** `pnpm test` + (once it exists) the new CI matrix workflow itself, run manually
  or via a draft-PR dry run before the phase's own merge-gate work is trusted
- **Phase gate:** Full suite green, AND the new CI required check green on at least one real PR,
  before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `apps/api/src/builds/store-contract.test.ts` — extend with concurrency assertions for the new
      atomic admission-control insert (global cap + both per-owner caps)
- [ ] `apps/api/src/session.test.ts` (new file) — session-issuance IP rate limit behavior
- [ ] A fast, Docker-free unit test for the "every `verifiedFor` record needs a fixture" guard,
      separate from the slow real-compile matrix run, if the planner wants that guard checked on
      every `pnpm test` rather than only on a full matrix run
- [ ] `services/worker/src/queue-runner.test.ts` (extend, if it exists — not directly read this
      session; verify at plan time) — assert `maintain()` produces a durable retention record
- Framework install: none — Vitest is already the project's framework; no new test framework needed

## Security Domain

`security_enforcement` is not set in `.planning/config.json` (absent = enabled per the default rule)
`[VERIFIED: .planning/config.json, read this session]`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No new work — anonymous-only is the locked decision (D-01); existing signed-cookie session mechanism (`apps/api/src/session.ts`) is unchanged in kind, only hardened (D-04) |
| V3 Session Management | Yes | HMAC-signed session cookie already implemented (`createHmac('sha256', secret)`, `timingSafeEqual` comparison, read this session at `session.ts:30-50`); D-04 closes the hardcoded-dev-secret gap and makes `SameSite` explicit rather than relying on browser defaults |
| V4 Access Control | No new work | Every read/write is already authorized by `ownerId` in the SQL predicate (Phase 2); this phase does not change that model |
| V5 Input Validation | Yes | `validateConfiguration`/`parseConfiguration` (Zod-backed schema, per `packages/domain/src/validate.ts`, read this session) — D-03's import path reuses this exact function, not a new validator |
| V6 Cryptography | No new work | HMAC-SHA256 session signing already in place; this phase does not introduce new cryptographic primitives |
| V7 Error Handling and Logging | Yes | `redactLog()` (`services/worker/src/redact.ts`, read this session) already strips secrets/paths from stored logs; this phase's requirement is extending the same redaction discipline to every new telemetry sink (Pitfall 5) |
| V13 API and Web Service | Yes | `BUILD_QUEUE_LIMITED` → HTTP 429 mapping already exists (`apps/api/src/errors.ts:27`, read this session); this phase adds the missing global/IP-scoped abuse controls that make that mapping meaningful under real load |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Build-queue exhaustion (one IP or many fresh anonymous sessions flooding build requests) | Denial of Service | Global queue-depth cap (D-11) + session-issuance IP rate limit (D-12), both atomic against the database |
| Session-cookie forgery to claim another owner's configurations | Spoofing / Elevation of Privilege | HMAC signature with `timingSafeEqual` comparison, already implemented; D-04 removes the one weak point (a guessable hardcoded dev secret reachable if `QWA_SESSION_SECRET` is accidentally unset in production) |
| IP-header spoofing to evade or falsely trigger rate limiting | Spoofing | `trustProxy` configured to the specific known hop, not `true` (Pitfall 3) |
| Self-hosted CI runner compromise via a malicious fork PR workflow | Tampering / Elevation of Privilege | Fork-PR approval setting + job-level `if:` guard (Pattern 5); no secrets exposed to fork-originated workflow runs |
| Sensitive infrastructure detail (paths, tokens) leaking through a newly added telemetry sink | Information Disclosure | Route every new export sink through the existing redaction discipline (Pitfall 5) |
| A dependency or the pinned build image carrying a known CVE | Tampering (supply chain) | Trivy/Grype/`npm audit` in CI, gating on the same self-hosted runner as the compile matrix |

## Sources

### Primary (HIGH confidence)
- This session's direct reads of the repository's own source: `apps/api/src/builds/service.ts`,
  `apps/api/src/session.ts`, `apps/api/src/server.ts`, `apps/api/src/app.ts`, `apps/api/src/errors.ts`,
  `packages/domain/src/limits.ts`, `packages/domain/src/module-registry.ts`,
  `packages/build-queue/src/{postgres-store,memory-store,types}.ts`,
  `services/worker/src/{queue-runner,redact}.ts`,
  `services/worker/scripts/{smoke-build,socd-compile-matrix}.ts`,
  `apps/api/migrations/002_builds.sql`, `apps/web/src/app/configurations/page.tsx`,
  `apps/web/src/lib/client.ts`, `apps/web/src/app/globals.css`, `apps/web/package.json`,
  `docs/adr/{0001-technology-stack,0004-the-builds-table-is-the-queue}.md`, `claude.md`,
  `catalogs/0.33.13-1/index.json`.
- `npm view <package> version` for `@opentelemetry/api`, `@opentelemetry/sdk-node`,
  `@opentelemetry/exporter-trace-otlp-proto`, `@opentelemetry/exporter-metrics-otlp-proto`,
  `@opentelemetry/resources`, `@opentelemetry/sdk-metrics`, `@fastify/rate-limit`, run this session.
- `gsd-tools query package-legitimacy check` output for the same package set, run this session.

### Secondary (MEDIUM confidence)
- fastify.dev `Reference/Request` and `Reference/Server` pages (`trustProxy`, `request.ip` behavior),
  via WebSearch this session.
- opentelemetry.io `docs/languages/js/exporters/` and OTLP exporter configuration pages, via
  WebSearch this session.
- GitHub Community discussions #54877, #142210, #26698, #44490 (required-status-check-vs-path-filter
  behavior) and #26722 (self-hosted runner + fork PR risk), via WebSearch this session.
- PostgreSQL backup/restore best-practice articles (pg_dump custom/directory format,
  `pg_dumpall --globals-only`, restore-drill discipline), via WebSearch this session.
- Trivy/Grype/npm audit 2026 comparison articles, via WebSearch this session.

### Tertiary (LOW confidence)
- The exact `pg_advisory_xact_lock`-in-a-CTE admission-control pattern (Pattern 1) is this session's
  own synthesis from general PostgreSQL locking semantics, not fetched from a PostgreSQL
  documentation page this session — flagged `[ASSUMED]` throughout and requires a concurrency test
  before being trusted.
- Specific `@opentelemetry/*` package names/versions were confirmed to exist on the npm registry this
  session, but the *names themselves* originate from training knowledge rather than an official docs
  page fetched this session — per the package-name provenance rule, tagged `[ASSUMED]` and gated
  behind the required `checkpoint:human-verify`.

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM — OTel package identity confirmed to exist on the registry but not fetched
  from official docs this session (context7 unavailable); `@fastify/rate-limit` and Postgres/Trivy
  tooling are well-established and cross-checked.
- Architecture: HIGH for the SQL-atomicity and matrix-extraction patterns (grounded in this session's
  direct reads of the actual source files being modified); MEDIUM for the CI-workflow YAML shapes
  (grounded in web search of GitHub's documented behavior, not executed/tested this session).
- Pitfalls: HIGH — every pitfall traces to either a direct code read this session or a specific,
  citable external source (GitHub Community discussions, Fastify docs).

**Research date:** 2026-09-02
**Valid until:** 30 days for the architecture/pitfalls content (stable, codebase-grounded); 7 days for
the exact `@opentelemetry/*` version numbers (fast-moving monorepo with frequent coordinated releases
— re-run `npm view` at plan/execute time regardless of this document's age).
