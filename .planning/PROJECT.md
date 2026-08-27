# QMK Firmware Customizer

## What This Is

A web application that builds advanced QMK firmware visually, without installing a toolchain or
writing C. A user picks a keyboard from a catalog derived from one pinned QMK revision, edits a
keymap and structured macros in the browser, requests a build, and downloads a compiled, checksummed
firmware artifact produced by an isolated server-side compile.

It is not a replacement for VIA and not a clone of QMK Configurator. It occupies the source-level
customization gap between them: features that require a real compile, exposed only where they have
been verified against the pinned revision.

## Core Value

A user gets real, compiled QMK firmware for features that require a source-level build — and every
feature offered has been verified to compile and behave on the pinned revision, never guessed.

## Milestone Success Metric

**SOCD firmware compiles and is verified on hardware.** The generator emits the required SOCD
includes, feature flags, and callbacks; an isolated build succeeds; and the resulting firmware
demonstrably applies the chosen SOCD policy on a real board.

This is the gate for Phase 4 and for closing `REQ-mvp-definition-of-done`.

## Target Runtime

Single host. Docker, one disposable container per build. PostgreSQL 16. `docker-compose` at
`infra/deploy/`. The API and the worker currently share a filesystem, which is what makes the
filesystem-backed `ArtifactStore` sufficient today (see ADR-0004-artifact-store).

## Requirements

### Validated

Shipped and confirmed working (Phases 0–3). Full text and provenance in `.planning/REQUIREMENTS.md`.

- ✓ `REQ-catalog-discovery` — Phase 1
- ✓ `REQ-keyboard-selection` — Phase 1
- ✓ `REQ-visual-keymap-editor` — Phase 2
- ✓ `REQ-limited-keycode-catalog` — Phase 2
- ✓ `REQ-structured-macros` — Phase 2
- ✓ `REQ-configuration-persistence` — Phase 2
- ✓ `REQ-ownership-authorization` — Phase 2
- ✓ `REQ-owned-keymap-generation` — Phase 3
- ✓ `REQ-isolated-compile` — Phase 3
- ✓ `REQ-build-result-storage-and-download` — Phase 3
- ✓ `REQ-build-lifecycle-api` — Phase 3
- ✓ `REQ-error-codes` — Phase 3

### Active

Current scope. Phase 4 closes the MVP; Phases 5–6 are planned post-MVP work.

- [ ] `REQ-socd-policy-choices` — Phase 4
- [ ] `REQ-curated-module-registry` — Phase 4
- [ ] `REQ-mvp-definition-of-done` — Phase 4
- [ ] `REQ-hardening-abuse-controls` — Phase 5
- [ ] `REQ-observability-telemetry` — Phase 5
- [ ] `REQ-smoke-matrix` — Phase 5
- [ ] `REQ-backup-retention-controls` — Phase 5
- [ ] `REQ-launch-identity-model` — Phase 5
- [ ] `REQ-flashing-compatibility-matrix` — Phase 6
- [ ] `REQ-flashing-rollout` — Phase 6

### Out of Scope

Verbatim from `claude.md` § Product scope — Out of scope for the MVP, plus deferrals resolved at
document ingest.

- Editing arbitrary C, Make, JSON, or QMK rules files in the browser — the product generates from a
  typed model through approved templates; free-form source is never accepted.
- Claiming support for every QMK keyboard feature, layout, or keycode — the keycode catalog is
  deliberately small and grows only behind capability flags with tests.
- Importing or modifying a user-provided firmware binary.
- VIA binary modification.
- Arbitrary user-provided source code, headers, compiler flags, or shell commands.
- Browser flashing in the MVP — designed for now, implemented in Phase 6 only after the build and
  download path is reliable and a real compatibility matrix exists.
- Automatic compatibility guarantees beyond the pinned QMK revision and validated metadata.
- **S3/MinIO artifact storage and signed-URL downloads** — deliberately deferred by
  ADR-0004-artifact-store. The `ArtifactStore` seam exists; the filesystem implementation is what
  runs. Do not schedule MinIO provisioning or signed-URL work. Revisit trigger below.
- Accepting arbitrary community-module repositories or user-supplied C — every supported module is a
  reviewed product feature in a curated registry.

## Conditional Future Items

Not phases, not scheduled. Each is gated on a named trigger.

| Item | Trigger | Source |
|------|---------|--------|
| S3-backed `ArtifactStore` implementation | When the API and the worker no longer share a filesystem | ADR-0004-artifact-store |
| `LISTEN/NOTIFY` behind `BuildQueue.claim` | When idle-worker poll cost matters (fits behind the existing interface) | ADR 0004 consequences |
| Redis/BullMQ queue | Only if the database-backed queue stops holding; touches one module by design | ADR-0001-queue |
| microVM `BuildSandbox` backend | If Docker isolation proves insufficient; the generator is unaffected by design | ADR-0001-build-isolation |
| QMK pin bump past 0.33.13 | A bump is a new catalog version and a new build image, never an in-place mutation; re-verifies the userspace mechanism and the SOCD interface | ADR-0001-qmk-pin, ADR 0003 |

## Context

**Delivery state.** Phases 0 through 3 are complete and shipped. A user can select a keyboard from
3,748 published catalog entries, edit a keymap with layers, mod-taps and structured macros, save it
with revisions and optimistic concurrency, request a build, watch it through the queue, and download
compiled firmware with its SHA-256 — or read a sanitized compiler log when it fails. A `crkbd/rev1`
build takes about 20 seconds end to end.

**Where it stops.** SOCD is the one MVP capability still refused. The schema models it
(`packages/domain/src/configuration.ts`), and both `validateConfiguration` and `generateKeymap`
deliberately reject `socd.enabled === true` per `claude.md` rule 9, because the pinned revision's
SOCD interface has not been verified. Phase 4 is that verification and the generation work it
unblocks.

**The Phase 4 generator question, already resolved.** ADR 0003's generated-file allowlist permits
`keymap.json`, `rules.mk`, `config.h`, and `keymap.c`. The shipped generator emits JSON only and
refuses C and Make — a deliberately narrower implementation, not a different decision. Verified SOCD
support requires emitting includes, feature flags, and callbacks, so extending the generator beyond
JSON is in-scope Phase 4 work under the existing allowlist. It is not a regression of a shipped
security property. The read-only `/qmk` mount and the external-userspace rules hold with no
exceptions.

**Known gaps carried into Phases 4–6.** Only `crkbd/rev1` has been through a real compile; the
curated smoke matrix does not exist, so 3,743 keyboards are *catalogued*, which is a weaker claim
than *known to build*. Sessions are anonymous cookies, so clearing cookies loses work. There is no
global build concurrency limit or IP rate limiting, only per-session quotas. There are no end-to-end
browser tests. Worker lease reclaim can take up to 120 seconds after a worker dies.

**Repository intel.** `.planning/codebase/` holds a full map (ARCHITECTURE, STACK, STRUCTURE,
CONVENTIONS, INTEGRATIONS, TESTING, CONCERNS) refreshed 2026-08-27. `.planning/intel/` holds the
document-ingest synthesis. `docs/adr/` holds the four accepted ADRs. `claude.md` is the operating
guide and outranks `README.md`.

## Constraints

- **Precedence**: ADR > SPEC (`claude.md`) > PRD > DOC (`README.md`) — a locked ADR overrides any
  requirement or constraint below it. All 23 decisions below are ADR-sourced and locked.
- **Tech stack**: TypeScript everywhere; Next.js App Router + React; Fastify; PostgreSQL 16; Zod in
  `packages/domain` as the single literal definition of the configuration schema — because a second
  hand-written copy of the model is how the two halves drift apart.
- **QMK pin**: tag `0.33.13`, commit `332fa30e173e5b0ecc0c70ff166974b6db86525e`, authoritative in
  `infra/qmk/manifest.json` — reproducibility requires the commit be persisted with every
  configuration and build.
- **Build isolation**: every compile runs `--network=none`, `--read-only`, `--cap-drop=ALL`,
  `no-new-privileges`, unprivileged user, CPU/memory/pid/wall-clock caps, read-only `/qmk`, ephemeral
  writable workspace — because the build input is user-shaped and the QMK tree is trusted only as
  input, never as editable data.
- **No shell evaluation anywhere**: every command is an argument vector, never an interpolated
  string — no `make`, `qmk`, or cleanup command may be formed by string concatenation.
- **Never invent metadata**: keyboard metadata, matrix positions, layouts, MCU targets, bootloaders,
  output extensions, and compile targets are parsed and validated from the pinned tree. An entry that
  cannot be resolved is recorded unsupported with a reason, never repaired.
- **Never expose an unverified feature**: a capability that has not been demonstrated to compile and
  behave on the pinned revision is reported unavailable, not generated speculatively.
- **Authorization on every read**: configurations, builds, logs, and artifacts are scoped by
  `ownerId` in the SQL predicate; cross-session access returns 404 so ids cannot be probed.
- **Runtime**: single host; API and worker share a filesystem; Postgres 16 via
  `infra/deploy/docker-compose.yml`.
- **Merge gate**: no change to the generator, QMK pin, templates, or build image merges without
  compiling the curated smoke matrix (`claude.md` § Testing strategy).
- **Compliance language**: SOCD behaviour, supported directional-key groups, and game/tournament
  compliance are labelled user responsibility. The product makes no compliance claims.

## Locked Decisions

All 23 decisions below come from the four accepted ADRs in `docs/adr/`. Every one is **locked**: a
plan that contradicts one is a blocker, not a tradeoff. Full text in `.planning/intel/decisions.md`.

<decisions>

### From ADR 0001 — Technology stack (Accepted 2026-08-08)

- **ADR-0001-language** [locked] — TypeScript across frontend, API, and worker. `packages/domain` is
  the single literal definition of the configuration schema. Any future non-TS service must consume
  the JSON Schema emitted from `packages/domain`, never re-declare the model by hand.
- **ADR-0001-frontend** [locked] — Next.js (App Router) + React. The frontend renders only from
  catalog/config API responses; it carries no unofficial client-side keyboard catalog, so it stays
  replaceable.
- **ADR-0001-backend** [locked] — Fastify HTTP API, schema-first, integrated with the
  Zod/JSON-Schema domain types. API contracts are versioned and published as JSON Schema; the
  framework is an implementation detail behind them.
- **ADR-0001-api-style** [locked] — REST + OpenAPI generated from domain schemas. Payload versioning
  is required from day one.
- **ADR-0001-database** [locked] — PostgreSQL 16 for configurations, revisions, builds, artifacts,
  with transactional state transitions for the build state machine. Schema changes go through
  migrations; no code may assume SQLite semantics.
- **ADR-0001-queue** [locked] — Database-backed queue using `SELECT … FOR UPDATE SKIP LOCKED`. Build
  state and job state live in one transaction. The queue is reached only through the worker's
  job-claim interface, so swapping to Redis/BullMQ later touches one module.
- **ADR-0001-artifact-storage** [locked, AMENDED] — Originally S3-compatible object storage (MinIO in
  dev) with signed URLs. **Amended by ADR 0004** for both the storage backend and the download
  mechanism; the source ADR carries the amendment annotation. Do not plan MinIO provisioning or
  signed-URL work from this row. See ADR-0004-artifact-store for current truth.
- **ADR-0001-build-isolation** [locked] — Docker, one disposable container per build, with
  `--network=none`, read-only QMK base mount, tmpfs workspace, non-root user, dropped capabilities,
  and CPU/memory/pid/wall-clock limits. Builds execute behind a `BuildSandbox` interface so a microVM
  backend can replace Docker without touching the generator.
- **ADR-0001-auth** [locked] — Anonymous signed-cookie sessions, with ownership-based authorization
  from day one; only the identity source changes when accounts arrive. Every configuration, build,
  log, and artifact read is authorized by `ownerId`; no code may assume `ownerId` is anonymous-only.
- **ADR-0001-styling** [locked] — Tailwind CSS + Radix headless primitives, for fast iteration and
  accessible primitives for the editor's keyboard-navigation requirements.
- **ADR-0001-testing** [locked] — Vitest for unit and integration, Playwright for e2e. Fixture
  compilations run in the real isolated build image, not a mock.
- **ADR-0001-observability** [locked] — Structured JSON logs now; OpenTelemetry-compatible exporters
  before public access, to avoid premature vendor lock-in. Log redaction rules apply to every sink
  added later.
- **ADR-0001-browser-flashing** [locked, OPEN] — Browser flashing is deferred to Phase 6 and
  undecided; it requires the real compatibility matrix from actual artifacts and bootloaders. **No
  flashing claim may ship before verified detection.**
- **ADR-0001-qmk-pin** [locked] — Upstream `https://github.com/qmk/qmk_firmware.git`, tag `0.33.13`,
  commit `332fa30e173e5b0ecc0c70ff166974b6db86525e`, recorded in `infra/qmk/manifest.json` as the
  single source of truth for discovery and builds. A QMK update is a new catalog version and a new
  build image — never an in-place mutation.

### From ADR 0002 — The catalog derives from QMK's own tooling (Accepted 2026-08-08)

- **ADR-0002-catalog-derivation** [locked] — Discovery runs in two stages with a hard boundary.
  (1) Extraction inside the pinned build image in Python: `infra/qmk/extract/extract_catalog.py` uses
  QMK's own `lib/python/qmk` API at the pinned revision to enumerate keyboards and resolve each info
  JSON, emitting newline-delimited JSON plus a provenance header; it makes no product decisions and
  does not filter, default, or repair anything. (2) Normalization in TypeScript
  (`packages/qmk-catalog`): the dump is parsed against a strict schema, entries that are incomplete,
  ambiguous, or unresolvable are recorded as unsupported with a reason and never repaired, and the
  output is an immutable versioned catalog artifact. The extractor's output is treated as untrusted
  input by the normalizer. Catalog builds are an offline administrative pipeline step, never a
  request-time operation.

### From ADR 0003 — Generated keymaps live in an external QMK userspace (Accepted 2026-08-08)

- **ADR-0003-external-userspace** [locked] — A per-build ephemeral writable `/workspace/` holds
  `userspace/` (with `qmk.json` and
  `keyboards/<keyboardId>/keymaps/<generatedKeymapName>/` containing the allowlisted generated files
  `keymap.json`, `rules.mk`, `config.h`, `keymap.c`), `build/` as `BUILD_DIR`, `qmkroot/` as a
  symlink farm used as the build working directory, `tmp/` as `TMPDIR`, and `home/` as `HOME`.
  **`/qmk` is mounted READ-ONLY with no exceptions.** The generator writes only inside
  `/workspace/userspace/keyboards/<keyboardId>/keymaps/<generatedKeymapName>/`. The artifact is
  collected from exactly one predetermined path, `$(QMK_USERSPACE)/<target>.<ext>`; anything else
  found in the workspace is rejected. `BUILD_DIR=/workspace/build` must be passed to every compile.
  The userspace mechanism is revision-sensitive: `services/worker` asserts its availability against
  the pinned tree at startup, and a QMK bump must re-verify it. This reinterprets `claude.md` rule 3
  as "an application-owned keymap directory the build resolves as the selected keyboard's keymap".

### From ADR 0004 — The `builds` table is the queue (Accepted 2026-08-09)

- **ADR-0004-queue** [locked] — There is no separate jobs table. A build row carries its own lease:
  `status` (queued | preparing | building | uploading | succeeded | failed | cancelled | expired),
  `claimed_by`, `lease_expires_at`, `cancel_requested`. A worker claims with a single
  `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, and every subsequent write is
  conditional on `claimed_by = $workerId` and the status the worker believes it is leaving, so a
  worker whose lease expired matches zero rows and abandons the build.
- **ADR-0004-cancellation** [locked] — Cancellation is a flag, not a status. Only the queue (while
  `queued`) or the worker holding the lease may write `cancelled`. The API sets `cancel_requested`
  and the worker observes it at a checkpoint, so a cancel cannot race a completing build into two
  terminal states.
- **ADR-0004-requeue** [locked] — `preparing|building|uploading → queued` is a legal transition. A
  lost lease returns the build to the queue rather than stranding it. Generation is deterministic and
  the workspace is destroyed per attempt, so a re-run is not a partial resume. After
  `BUILD_LIMITS.maxBuildAttempts` the build fails instead.
- **ADR-0004-idempotency** [locked] — Idempotency is a unique index on `(owner_id,
  idempotency_key)`, not a read-then-write in the API, which would race with itself.
- **ADR-0004-artifact-store** [locked] — **Current truth for artifact storage backend and download
  mechanism.** `packages/artifact-store` defines `put`/`get`/`delete` over opaque keys, mirroring how
  `BuildSandbox` isolates the container runtime. The filesystem implementation is what runs; an S3
  implementation would be a new class behind the same interface with nothing above it changing.
  Wiring MinIO in immediately was rejected: with the API and worker on one host, S3 adds a
  dependency, credentials, and a failure mode without buying a property the application can use. Two
  rules hold regardless of backend — keys are derived from a build id by `keys.ts` and nowhere else
  (no user-supplied text ever reaches a path), and a key never leaves the server: a client sees a
  build id and a filename, and the API reads the object and streams it. **Revisit trigger: when the
  API and the worker no longer share a filesystem.**
- **ADR-0004-worker-role** [locked] — `migrations/003_worker_role.sql` creates `qwa_worker` with
  `SELECT, UPDATE` on `builds`, `SELECT, INSERT` on `artifacts`, `SELECT` on
  `configuration_revisions`, and deliberately nothing on `configurations`. The worker is handed ids
  and reads the immutable revision document; it never needs to know who owns what. The migration
  reports and continues if the migrating user lacks `CREATEROLE`, since managed Postgres often
  withholds it; the deployment is then responsible for provisioning the role from the same file.
- **ADR-0004-retention** [locked] — Retention is a worker responsibility. `QueueRunner.maintain()`
  reclaims dead leases, expires artifacts, and deletes the corresponding objects. Database rows are
  removed before their blobs, so a failure leaves an orphaned object rather than a build promising a
  download that no longer exists.

</decisions>

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Database-backed queue, builds table *is* the queue | A separate jobs table makes two impossible states representable: a job with no build, and a `queued` build with no job | ✓ Good — shipped Phase 3, contract-tested against Postgres |
| Filesystem `ArtifactStore`, S3 deferred | With API and worker on one host, S3 adds a dependency, credentials, and a failure mode without buying a usable property | ✓ Good — seam in place, swap is one class |
| Generated keymaps in an external QMK userspace | With the working directory on the read-only mount, a successful `qmk compile` exits 2; a `qmkroot` symlink farm makes it exit 0 on success and non-zero on genuine failure | ✓ Good — verified byte-identical on `crkbd/rev1` |
| Catalog derived by QMK's own tooling, not a re-implemented parser | A hand-written parser silently diverges from QMK; the extractor breaks loudly at a known seam instead | ✓ Good — 3,748 keyboards published |
| SOCD refused rather than guessed | `claude.md` rule 9: the pinned revision's SOCD interface must be verified before exposure | — Pending — Phase 4 is the verification |
| Generator emits JSON only, so far | Narrower than the ADR 0003 allowlist by choice; C and Make were not yet needed | ⚠️ Revisit — Phase 4 extends it to `rules.mk`/`config.h`/`keymap.c` under the same allowlist |
| Anonymous signed-cookie sessions | Ownership authorization from day one means accounts later change only where `ownerId` comes from | ⚠️ Revisit — Phase 5 decides the launch identity model |
| Browser flashing deferred and undecided | Needs a real compatibility matrix from actual artifacts and bootloaders, not assumptions | — Pending — Phase 6 |

---
*Last updated: 2026-08-27 after document ingest and roadmap creation*
