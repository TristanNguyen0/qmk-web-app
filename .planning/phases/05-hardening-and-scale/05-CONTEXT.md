# Phase 5: Hardening and Scale - Context

**Gathered:** 2026-09-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 makes the application safe to expose to people who are not the developer who built it. Five
requirements land here: `REQ-hardening-abuse-controls`, `REQ-observability-telemetry`,
`REQ-smoke-matrix`, `REQ-backup-retention-controls`, `REQ-launch-identity-model`.

**Depends on Phase 4, which is not closed.** `04-05-PLAN.md` — hardware verification on
`mode/m256wh` — is the Phase 4 gate and the milestone success metric. It remains open. Nothing in
Phase 5 front-runs it, but Phase 5 does not start until it passes.

**In scope, as settled by this discussion:**

1. Global build backpressure and an IP axis that per-owner quotas cannot see.
2. A curated smoke matrix and a real merge gate that enforces it.
3. The launch identity decision, taken as anonymous-only — plus the in-product visibility and the
   export/import escape hatch that make it defensible.
4. Telemetry, backups and restore drills, dependency/image scanning and the licensing review — all
   discussed only as recorded defaults (see Claude's Discretion), not as user decisions.

**Out of scope:** accounts and any authentication provider; S3/MinIO artifact storage and signed URLs
(`ADR-0004-artifact-store` defers both, and the revisit trigger — API and worker no longer sharing a
filesystem — has not fired); `LISTEN/NOTIFY` behind `BuildQueue.claim`; browser flashing (Phase 6).

**Frontend surface, flagged:** the ROADMAP anticipated frontend work only if identity landed on
"accounts". It landed on anonymous-only, but the persistent data-loss notice and the export/import
controls are still real UI. The user decided **against** a UI contract (`/gsd-ui-phase 5`) — the
planner treats this as ordinary work against the existing `apps/web` Tailwind/Radix patterns.

</domain>

<decisions>
## Implementation Decisions

### Launch identity model

- **D-01:** **Anonymous-only is the launch identity model**, recorded as a stated constraint rather
  than an unfixed gap. Accounts are not built in this phase. This is criterion 5's second branch,
  taken deliberately. — **Reversibility:** reversible — `ADR-0001-auth` already confines the change
  to where `ownerId` originates, and every read and write predicate authorizes by `ownerId` today.

- **D-02:** Data-loss behaviour is surfaced by a **persistent, non-dismissable line** on the
  configurations list and in the editor chrome: this work belongs to this browser's cookie, and
  clearing it loses the work. A dismissable first-visit notice was rejected — the dismissal itself
  lives in the cookie that is at risk, so the user most likely to be harmed is the one who would
  never see it again.

- **D-03:** **Export and import both ship.** Export a configuration as JSON; import adopts an
  uploaded document into the current session as a new configuration. Import MUST go through the same
  `validateConfiguration` path as any other write — untrusted JSON never bypasses the schema — and
  the client still cannot set `id`, `ownerId`, `revision`, or `schemaVersion` (Phase 2, criterion 4).
  — **Reversibility:** costly — an export format published to users becomes a compatibility surface;
  changing it later breaks files people have already saved.

- **D-04:** **Session cookie hardening is in scope.** Remove the hardcoded dev secret fallback at
  `apps/api/src/server.ts:36` so `QWA_SESSION_SECRET` is required in every environment, and set
  `SameSite` explicitly rather than inheriting a browser default. Established during this discussion:
  the cookie's `Max-Age` is **already a deliberate one year** (`apps/api/src/session.ts`), so
  lifetime is a review item, not a change.

- **D-05:** **No UI contract for this phase.** A status line and a download/upload control are
  conventional and `apps/web` already carries the patterns. The UI surface is noted here instead.

### Smoke matrix and merge gate

- **D-06:** The gate runs on a **self-hosted GitHub Actions runner on the build host**, with branch
  protection and a required status check so "cannot merge" is literal. The host already has Docker,
  the 3.73 GB `qmk-web-app/qmk-build:0.33.13-1` image, and the pinned QMK checkout, so a run costs
  the compiles and nothing else. **Recorded constraint: the self-hosted runner must never execute
  fork PRs.** Acceptable in a solo repository; it becomes a hard constraint the day it is not.
  — **Reversibility:** costly — moving to hosted runners later requires a registry, an image publish
  step folded into the controlled QMK refresh process, and a pinned QMK clone per run.

- **D-07:** **One matrix runner over several fixture sets.** Extract the setup that
  `services/worker/scripts/smoke-build.ts` and `services/worker/scripts/socd-compile-matrix.ts`
  already duplicate — open published catalog, validate, generate, `DockerSandbox`, assert firmware —
  into one runner taking a fixture set. `pnpm socd:matrix` stays a named entry point. **The
  invariant `socd-compile-matrix.ts` enforces must survive intact:** every keyboard `MODULE_REGISTRY`
  records as compile-verified for this catalog version must have a fixture. That guard is the
  evidence behind the registry's `verifiedFor` records. — **Reversibility:** costly — the registry's
  verification story depends on this script; a refactor that loses the guard silently weakens a
  shipped claim.

- **D-08:** Matrix membership is chosen for **toolchain and bootloader diversity** — extending from
  `crkbd/rev1` (AVR) and `mode/m256wh` (ARM/STM32) across distinct MCU families, bootloaders, and
  layout shapes present in the pinned catalog. The selection criteria are written down so a later
  addition is justified rather than arbitrary. Popularity-based selection was rejected: no popularity
  signal exists in the pinned catalog, so the list would be invented — which the standing
  never-invent-metadata constraint forbids.

- **D-09:** The matrix is **path-filtered** to changes touching the generator, QMK pin, templates, or
  build image, with a **fast always-on check (typecheck + vitest) on every PR**. One sharp edge to
  handle deliberately: a required status check skipped by a path filter can block a PR forever or
  pass vacuously depending on wiring — the skip path must report an explicit status rather than being
  absent.

- **D-10:** Every matrix entry must **produce firmware**; **one designated entry additionally builds
  twice and asserts byte-identical output**, preserving the Phase 0 reproducibility claim without
  doubling the gate's wall clock. Determinism is a property of the generator and the pinned image,
  not of a particular keyboard — the same proportionality reasoning that kept Phase 4's hardware
  matrix narrow.

### Abuse controls

- **D-11:** The global limit is on **queue depth** — total queued plus running builds across all
  owners — **enforced in the same SQL statement that inserts the build**, so it cannot race and stays
  correct with more than one API process. Depth is the right signal: it is what protects the single
  host, and a deep queue already means every user's build is slow. Rejection is `BUILD_QUEUE_LIMITED`,
  which **already maps to HTTP 429** at `apps/api/src/errors.ts:27` — no new error code is needed.
  — **Reversibility:** costly — it changes the insert path that `ADR-0004-queue` defines as the queue
  itself.

- **D-12:** The IP axis is applied to **session issuance, not to builds.** Minting a fresh anonymous
  session is the cheap step that defeats every per-owner quota, and it happens in exactly one place;
  once bounded, the existing 2-concurrent / 20-per-hour limits do their job again and a per-IP build
  quota is largely redundant. **The limit must be generous enough for many legitimate users behind
  one NAT** (office, campus). **No IP is recorded on build rows** — nothing personal to redact or
  retain. Distributed sources remain the global cap's job, by design.

- **D-13:** **Both per-owner quota checks become atomic**, folded into the same conditional insert as
  the global cap. The read-then-check at `apps/api/src/builds/service.ts:125` is removed. This is the
  identical reasoning `ADR-0004-idempotency` already applied when idempotency became a unique index —
  an application-level check races with itself. — **Reversibility:** costly — touches the build
  creation path and its contract tests, which exist precisely to pin concurrency guarantees.

- **D-14:** Fastify **`trustProxy` is configured explicitly** to the known proxy hop, and "sits
  behind a reverse proxy that sets `X-Forwarded-For`" becomes a **stated deployment requirement**.
  Production start-up **fails loudly** if it is not configured, mirroring the existing session-secret
  guard in `apps/api/src/server.ts`. The failure this prevents is silent: without it, every request
  either shares the proxy's address — collapsing all users into one bucket — or trusts a spoofable
  header. There is **no `trustProxy` and no use of `request.ip` anywhere in the API today.**

### Claude's Discretion

The user chose not to discuss these. Defaults are recorded with reasoning so the planner has a
starting position rather than an open question — none of them is locked by the user.

- **Telemetry (`REQ-observability-telemetry`).** Default: the OpenTelemetry SDK with an OTLP
  exporter, which satisfies `ADR-0001-observability`'s "OpenTelemetry-compatible exporters … to avoid
  premature vendor lock-in" literally; the collector is a deployment concern, not an application
  dependency. Signals must cover the four criterion 2 names — queue depth, build throughput, failure
  classification (`builds.failure_code` already carries it), worker liveness. **Existing redaction
  (`services/worker/src/redact.ts`) must apply to every sink**, per the same ADR. Whether a dashboard
  ships is the planner's call: criterion 2 says an operator *can see*, which exported signals plus a
  documented query set satisfies.

- **Backups and restore drills (`REQ-backup-retention-controls`).** Default: **back up Postgres only,
  not artifacts.** Artifacts are 7-day-ephemeral and deterministically reproducible from a
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and product rules
- `.planning/ROADMAP.md` § Phase 5 — the five success criteria and the scope notes. The scope notes
  name `README.md` § Known gaps as the concrete target list.
- `.planning/REQUIREMENTS.md` — `REQ-hardening-abuse-controls`, `REQ-observability-telemetry`,
  `REQ-smoke-matrix`, `REQ-backup-retention-controls`, `REQ-launch-identity-model` (lines 250–291),
  each with its source and overriding decision.
- `claude.md` § Build isolation and security — "Limit concurrent builds per user/IP/session and
  globally; add queue backpressure and abuse monitoring before public access"; periodic
  restore/reproducibility drills; dependency and image update scanning; legal/licensing review before
  public deployment. § Testing strategy — the merge gate sentence D-06 and D-09 implement.
  **SPEC tier — outranks `README.md` and `.planning/PROJECT.md`.**
- `README.md` § Known gaps (lines 227–242) — the DOC-tier statement of what is missing; must be
  updated as each gap closes.

### Locked decisions this phase must not contradict
- `docs/adr/0001-technology-stack.md` — `ADR-0001-auth` (ownership authorization exists from day one;
  only the identity source changes when accounts arrive; **no code may assume `ownerId` is
  anonymous-only**), `ADR-0001-observability` (structured JSON logs now, OTel-compatible exporters
  before public access, redaction on every sink), `ADR-0001-testing` (fixture compilations run in the
  real isolated build image, never a mock — this is why the gate needs Docker and the pinned tree),
  `ADR-0001-qmk-pin` (`0.33.13` / `332fa30e…`; a bump is a new catalog version and a new build image).
- `docs/adr/0004-the-builds-table-is-the-queue.md` — `ADR-0004-queue` (the builds table *is* the
  queue; the claim is one conditional `UPDATE`), `ADR-0004-idempotency` (idempotency is a unique
  index, **not** a read-then-write in the API, "which would race with itself" — the precedent D-13
  follows), `ADR-0004-retention` (retention is a worker responsibility; rows are deleted before
  blobs), `ADR-0004-artifact-store` (**S3/MinIO and signed URLs stay deferred; do not schedule
  them**), `ADR-0004-worker-role` (the `qwa_worker` grant set any new migration must respect).
- `docs/adr/0003-generated-keymaps-live-in-an-external-userspace.md` — `/qmk` read-only with no
  exceptions; the generated-file allowlist; the `/workspace/qmkroot` symlink farm; the artifact comes
  from exactly one predetermined path. Constrains anything the matrix runner does.
- `docs/adr/0005-socd-is-a-first-party-community-module.md` — accepted in Phase 4; the SOCD fixture
  set D-07 folds into the matrix runner rests on it.

### Prior phase context
- `.planning/phases/04-verified-socd-support/04-CONTEXT.md` — in particular **D-06** (a keyboard must
  pass `socd:matrix` before entering the registry) and **D-10** (compile-verified vs
  hardware-verified are distinct claims and must not be flattened). D-07 here must preserve both.

### Code the phase modifies or extends
- `apps/api/src/builds/service.ts:125` — the read-then-check per-owner quota D-13 replaces.
- `apps/api/src/errors.ts:27` — `BUILD_QUEUE_LIMITED` → HTTP 429, already mapped.
- `packages/domain/src/limits.ts` — `BUILD_LIMITS` (`maxActiveBuildsPerOwner: 2`,
  `maxBuildsPerOwnerPerHour: 20`, lease and attempt constants). The new global cap and
  session-issuance limit belong beside these, with the same comment discipline.
- `apps/api/src/session.ts` — anonymous session issuance (D-12's chokepoint); `SESSION_COOKIE`,
  the one-year `MAX_AGE_SECONDS`, HMAC verification.
- `apps/api/src/server.ts:36` — the hardcoded dev session secret (D-04) and the existing fail-loud
  production guard that D-14 mirrors.
- `apps/api/src/app.ts` — cookie options; where `SameSite` and `trustProxy` land.
- `services/worker/scripts/smoke-build.ts`, `services/worker/scripts/socd-compile-matrix.ts` — the
  two scripts D-07 refactors into one runner.
- `services/worker/src/queue-runner.ts` — `maintain()`, the retention and lease-reclaim path that the
  deletions record and worker-liveness telemetry attach to.
- `services/worker/src/redact.ts` — the redaction that must reach every new sink.
- `infra/qmk/Dockerfile`, `infra/qmk/manifest.json` — the build image (3.73 GB, base pinned by
  digest; QMK **not** baked in, mounted read-only at `/qmk`) and the pin the runner must match.
- `apps/api/migrations/` — `001_configurations.sql`, `002_builds.sql`, `003_worker_role.sql`,
  `004_socd_module_version.sql`. Any new migration follows this numbering and respects
  `ADR-0004-worker-role`.

### Codebase intel (refreshed 2026-08-27)
- `.planning/codebase/CONCERNS.md` — sourced D-04 (hardcoded dev secret; missing `SameSite`) and the
  session-storage and orphaned-artifact items in Deferred below.
- `.planning/codebase/ARCHITECTURE.md` — the three-tier layout, the build request path, and the
  documented anti-patterns the new insert path must not reintroduce.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/domain/src/limits.ts` — `LIMITS` and `BUILD_LIMITS` are already the single home for
  product limits, with comments explaining *why* each number exists. The global queue-depth cap and
  the session-issuance limit extend this, they do not need a new home.
- `apps/api/src/errors.ts` + `packages/domain/src/errors.ts` — `BUILD_QUEUE_LIMITED` exists and maps
  to 429. Criterion 1's required response is already wired.
- `services/worker/scripts/smoke-build.ts` — already runs the whole pipeline (published catalog →
  validation → generation → isolated compile → artifact identification and checksum) and already
  builds twice asserting byte-identical firmware. D-10's reproducibility check is this behaviour,
  moved rather than invented.
- `services/worker/scripts/socd-compile-matrix.ts` — already compiles every (keyboard × policy) pair
  for real in the isolated image, and already carries the registry-fixture guard. The curated matrix
  is a generalization of this, not a new capability.
- `services/worker/src/redact.ts` — existing log redaction with its own tests; the model for
  "redaction applies to every sink".
- `apps/api/src/session.ts` — one function issues sessions. D-12's rate limit has exactly one place
  to attach.

### Established Patterns
- **Contract testing over mocking.** `apps/api/src/builds/store-contract.test.ts` runs the same suite
  against the in-memory and Postgres stores. A new atomic quota/backpressure insert must be expressed
  in that contract, or the in-memory store will diverge silently — `CONCERNS.md` already flags that
  the in-memory store's concurrency guarantees are unenforced by type.
- **Fail loud on missing production configuration.** `server.ts` already exits when
  `QWA_SESSION_SECRET` is unset in production. D-04 and D-14 extend one existing pattern rather than
  introducing two new ones.
- **Constraints in SQL, not in application logic.** Idempotency is a unique index; the queue claim is
  one conditional `UPDATE`. D-11 and D-13 continue this; an in-process counter would contradict it
  and would also be wrong with more than one API process.
- **Immutable pinning recorded per build.** Builds already capture `catalogVersion`, `qmkCommit`,
  `generatorVersion`, `buildImageRef`, `buildImageDigest`, and `socdModuleVersion`. The CI runner must
  use the same image digest the manifest names, not a rebuilt look-alike.

### Integration Points
- **Build creation** (`apps/api/src/builds/service.ts` → `packages/build-queue`) — where D-11 and
  D-13 land, as one conditional insert.
- **Session hook** (`apps/api/src/session.ts`, registered in `apps/api/src/app.ts`) — where D-12
  attaches; also where `SameSite` (D-04) and `trustProxy` (D-14) are configured.
- **Web app** (`apps/web/src/components/KeymapEditor.tsx`, the configurations list) — where D-02's
  persistent notice and D-03's export/import controls attach. Neither component has tests today
  (`CONCERNS.md`, high priority) — relevant if the planner touches their save path.
- **Worker maintenance** (`services/worker/src/queue-runner.ts` `maintain()`) — where the retention
  deletion record and worker-liveness signals attach.
- **New: `.github/workflows/`** — does not exist. D-06 and D-09 create the repository's first CI.

</code_context>

<specifics>
## Specific Ideas

- The data-loss notice must be **non-dismissable** for a stated reason: a dismissal stored in the
  at-risk cookie is invisible to exactly the user it was written for.
- The import path is explicitly **not** a new trust boundary — it reuses `validateConfiguration`, the
  same path every other write takes.
- The session-issuance limit is deliberately the *one* IP-scoped control, chosen because it is the
  single chokepoint that makes every other per-owner quota meaningful again.
- Reproducibility is asserted **once per matrix run, on one designated board** — determinism belongs
  to the generator and the pinned image, not to a keyboard.
- Matrix membership is justified by written criteria. "Most-used boards" was rejected on the ground
  that the pinned catalog carries no popularity signal, so any such list would be invented.

</specifics>

<deferred>
## Deferred Ideas

No scope creep was raised during this discussion — every area stayed inside the phase boundary.

**Surfaced during codebase scouting, deliberately not folded into this phase** (recorded so they are
not lost; none of these was raised by the user):

- **Unbounded configuration/session growth** — `CONCERNS.md` § Scaling Limits: there is no cleanup
  policy for old anonymous sessions or their configurations. Adjacent to
  `REQ-backup-retention-controls` but distinct from it, and D-01's anonymous-only model makes
  deleting a stale session's work a user-visible decision, not a maintenance detail.
- **Orphaned artifact reaper** — `CONCERNS.md` § Tech Debt: `maintain()` deletes rows before blobs by
  design, so a failed blob delete leaves an unreferenced file with nothing scanning for it.
- **Untested web components** — `KeymapEditor.tsx` and `BuildPanel.tsx` have no tests, flagged high
  priority. Not this phase's requirement, but D-02 and D-03 add code to that same untested surface.
- **Missing index on `configuration_revisions(configuration_id, revision)`** — `CONCERNS.md`
  § Performance, hit on every build claim.

</deferred>

---

*Phase: 5-hardening-and-scale*
*Context gathered: 2026-09-02*
