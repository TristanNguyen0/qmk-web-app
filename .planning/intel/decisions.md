# Decisions (from ADRs)

Extracted from ADR-classified documents. Precedence tier: ADR (highest).
All four source ADRs carry `Status: Accepted` and were classified `locked: true`.

---

## ADR-0001-language: TypeScript across frontend, API, and worker
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: TypeScript across frontend, API, and worker. `packages/domain` is the single literal definition of the configuration schema. Migration constraint: any future non-TS service must consume the JSON Schema emitted from `packages/domain`, never re-declare the model by hand.
- scope: language, configuration model ownership

## ADR-0001-frontend: Next.js (App Router) + React
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: Next.js (App Router) + React for the frontend. Migration constraint: the frontend must render only from catalog/config API responses (no unofficial client-side keyboard catalog), so it stays replaceable.
- scope: frontend framework, visual keymap editor

## ADR-0001-backend: Fastify HTTP API
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: Fastify HTTP API, schema-first, integrated with the Zod/JSON-Schema domain types. Migration constraint: API contracts are versioned and published as JSON Schema; the framework is an implementation detail behind them.
- scope: backend framework, HTTP API

## ADR-0001-api-style: REST + OpenAPI generated from domain schemas
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: REST + OpenAPI generated from domain schemas. Migration constraint: payload versioning required from day one.
- scope: API style, contract testing

## ADR-0001-database: PostgreSQL 16
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: PostgreSQL 16 as the relational store for configurations, revisions, builds, artifacts; transactional state transitions for the build state machine. Migration constraint: schema changes go through migrations; no application code may assume SQLite semantics.
- scope: database, build state machine persistence

## ADR-0001-queue: Database-backed queue (`SELECT … FOR UPDATE SKIP LOCKED`)
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: Database-backed queue using `SELECT … FOR UPDATE SKIP LOCKED`; avoids a second datastore and keeps build state and job state in one transaction. Migration constraint: the queue is accessed only through `services/worker`'s job-claim interface, so swapping to Redis/BullMQ later touches one module.
- scope: queue, job system

## ADR-0001-artifact-storage: S3-compatible object storage (MinIO in dev)
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: S3-compatible object storage, MinIO in development, chosen for signed URLs and retention policies without exposing storage keys or worker paths. Migration constraint: all access goes through the artifact service; storage keys never leave the server.
- scope: artifact storage backend, download mechanism
- note: RESOLVED at ingest — ADR 0001's artifact-storage row is now annotated "Amended by ADR 0004" in the source ADR. Current truth: `ArtifactStore` interface, filesystem-backed; S3/MinIO deferred until the API and worker no longer share a filesystem; downloads stream through the API (no signed URLs). Do not plan MinIO provisioning or signed-URL work from this row.

## ADR-0001-build-isolation: Docker, one disposable container per build
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: Docker containers, one disposable container per build, with `--network=none`, read-only QMK base mount, tmpfs workspace, non-root user, dropped capabilities, and CPU/memory/pid/wall-clock limits. Migration constraint: the worker executes builds behind a `BuildSandbox` interface so a microVM backend can replace the Docker one without touching the generator.
- scope: build isolation, sandbox interface

## ADR-0001-auth: Anonymous signed-cookie sessions
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: Anonymous signed-cookie sessions, with ownership-based authorization present from day one; only the identity source changes when accounts arrive. Migration constraint: every configuration, build, log, and artifact read is authorized by `ownerId`; no code may assume `ownerId` is anonymous-only.
- scope: authentication, authorization model

## ADR-0001-styling: Tailwind CSS + Radix headless primitives
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: Tailwind CSS + headless primitives (Radix), chosen for fast iteration and accessible primitives for the editor's keyboard-navigation requirements. Migration constraint: none recorded.
- scope: styling, UI primitives, accessibility

## ADR-0001-testing: Vitest + Playwright
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: Vitest (unit/integration) + Playwright (e2e). Migration constraint: fixture compilations run in the real isolated build image, not a mock.
- scope: testing tools

## ADR-0001-observability: Structured JSON logs now, OpenTelemetry before public access
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: Structured JSON logs now; OpenTelemetry-compatible exporters before public access, to avoid premature vendor lock-in. Migration constraint: log redaction rules apply to every sink added later.
- scope: observability, logging

## ADR-0001-browser-flashing: Deferred to Phase 6, undecided
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: Browser flashing is deferred (Phase 6) and undecided; it requires the real compatibility matrix from actual artifacts/bootloaders. Migration constraint: no flashing claim may ship before verified detection.
- scope: browser flashing (deferred / open)

## ADR-0001-qmk-pin: QMK pinned to 0.33.13
- source: docs/adr/0001-technology-stack.md
- status: locked (Accepted, 2026-08-08)
- decision: Upstream `https://github.com/qmk/qmk_firmware.git`, tag `0.33.13`, commit `332fa30e173e5b0ecc0c70ff166974b6db86525e`. Recorded in `infra/qmk/manifest.json`, the single source of truth for discovery and builds. A QMK update is a new catalog version and a new build image — never an in-place mutation.
- scope: QMK pin, catalog versioning, build image

---

## ADR-0002: The catalog is derived by QMK's own tooling, not a re-implemented parser
- source: docs/adr/0002-catalog-derives-from-qmk-tooling.md
- status: locked (Accepted, 2026-08-08)
- decision: Discovery runs in two stages with a hard boundary. (1) Extraction inside the pinned build image in Python: `infra/qmk/extract/extract_catalog.py` uses QMK's own `lib/python/qmk` API at the pinned revision to enumerate keyboards and resolve each one's info JSON, emitting newline-delimited JSON plus a provenance header; it makes no product decisions and does not filter, default, or repair anything. (2) Normalization in TypeScript (`packages/qmk-catalog`): the dump is parsed against a strict schema; entries that are incomplete, ambiguous, or unresolvable are recorded as unsupported with a reason, never repaired; the output is an immutable, versioned catalog artifact. The extractor's output is treated as untrusted input by the normalizer.
- scope: keyboard catalog discovery, QMK tooling boundary, normalization, unsupported-entry handling
- consequences: catalog builds require the pinned build image and are an offline administrative pipeline step, not a request-time operation; QMK metadata-model changes break the extractor loudly at a known seam; the normalizer is fully testable against checked-in extractor dumps without Docker (`packages/qmk-fixtures`).

## ADR-0003: Generated keymaps live in an external QMK userspace, not inside the QMK tree
- source: docs/adr/0003-generated-keymaps-live-in-an-external-userspace.md
- status: locked (Accepted, 2026-08-08)
- decision: A per-build ephemeral writable `/workspace/` holds `userspace/` (with `qmk.json` and `keyboards/<keyboardId>/keymaps/<generatedKeymapName>/` containing the allowlisted generated files `keymap.json`, `rules.mk`, `config.h`, `keymap.c`), `build/` as `BUILD_DIR`, `qmkroot/` as a symlink farm used as the build working directory, `tmp/` as `TMPDIR`, and `home/` as `HOME`. `/qmk` (the pinned QMK source) is mounted READ-ONLY with no exceptions. The generator writes only inside `/workspace/userspace/keyboards/<keyboardId>/keymaps/<generatedKeymapName>/`.
- scope: build workspace layout, QMK userspace, read-only QMK tree, symlink-farm working directory, artifact collection path
- rationale (verbatim substance): with the working directory set to the read-only mount, QMK's `generated-files` marker unlink and `cpfirmware_qmk` copy fail after a successful link step, so a successful build exits non-zero (verified on the pinned revision: firmware produced and size-checked `20624/28672`, yet `qmk compile` exited 2). Running in `/workspace/qmkroot`, a writable directory of symlinks to every top-level entry of `/qmk`, makes `qmk compile` exit 0 on success and non-zero on genuine failure. Confirmed on `crkbd/rev1`: exit 0, byte-identical artifact, pinned tree unmodified.
- consequences: no per-build copy of the QMK tree, the read-only mount is shared across concurrent builds; `BUILD_DIR=/workspace/build` must be passed to every compile; the userspace mechanism is revision-sensitive — `services/worker` asserts its availability against the pinned tree at startup and a QMK bump must re-verify it.
- reinterprets: claude.md rule 3 is to be read as "an application-owned keymap directory the build resolves as the selected keyboard's keymap".
- artifact collection: exactly one predetermined path, `$(QMK_USERSPACE)/<target>.<ext>`; anything else found in the workspace is rejected.

## ADR-0004-queue: The `builds` table is the queue
- source: docs/adr/0004-the-builds-table-is-the-queue.md
- status: locked (Accepted, 2026-08-09)
- decision: There is no separate jobs table. A build row carries its own lease: `status` (queued | preparing | building | uploading | succeeded | failed | cancelled | expired), `claimed_by`, `lease_expires_at`, `cancel_requested`. A worker claims with a single `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, and every subsequent write is conditional on `claimed_by = $workerId` and the status the worker believes it is leaving, so a worker whose lease expired matches zero rows and abandons the build.
- scope: build queue, lease and claim semantics, build state machine
- rejected alternative: a queue table beside the build record, because it makes two impossible states representable (a job with no build; a `queued` build with no job).

## ADR-0004-cancellation: Cancellation is a flag, not a status
- source: docs/adr/0004-the-builds-table-is-the-queue.md
- status: locked (Accepted, 2026-08-09)
- decision: Only the queue (while `queued`) or the worker holding the lease may write `cancelled`. The API sets `cancel_requested` and the worker observes it at a checkpoint. This prevents a cancel racing a completing build into two different terminal states.
- scope: build cancellation semantics

## ADR-0004-requeue: `preparing|building|uploading → queued` is a legal transition
- source: docs/adr/0004-the-builds-table-is-the-queue.md
- status: locked (Accepted, 2026-08-09)
- decision: A lost lease returns the build to the queue rather than stranding it (`packages/domain/src/build.ts`). Generation is deterministic and the workspace is destroyed per attempt, so a re-run is not a partial resume. After `BUILD_LIMITS.maxBuildAttempts` the build fails instead.
- scope: lease recovery, retry semantics, build state machine transitions

## ADR-0004-idempotency: Idempotency is a unique index
- source: docs/adr/0004-the-builds-table-is-the-queue.md
- status: locked (Accepted, 2026-08-09)
- decision: Idempotency is a unique index on `(owner_id, idempotency_key)`, not a read-then-write in the API, which would race with itself.
- scope: build creation idempotency

## ADR-0004-artifact-store: Artifacts go through an `ArtifactStore` interface, filesystem-backed today
- source: docs/adr/0004-the-builds-table-is-the-queue.md
- status: locked (Accepted, 2026-08-09)
- decision: `packages/artifact-store` defines `put`/`get`/`delete` over opaque keys, mirroring how `BuildSandbox` isolates the container runtime. The filesystem implementation is what runs now; an S3 implementation is a new class behind the same interface and nothing above it changes. Wiring MinIO in immediately was rejected: with the API and the worker on one host, S3 would add a dependency, credentials, and a failure mode without buying a property the application can currently use. The point at which S3 becomes necessary is when the API and the worker no longer share a filesystem. Two rules hold regardless of backend: keys are derived from a build id by `keys.ts` and nowhere else (no user-supplied text ever reaches a path); and a key never leaves the server — a client sees a build id and a filename, and the API reads the object and streams it.
- scope: artifact storage backend, artifact key derivation, download mechanism, S3/MinIO deferral
- note: this narrows ADR-0001-artifact-storage (S3-compatible / MinIO in dev, signed URLs); ADR 0001 is now annotated as amended by this ADR. This decision is the single current truth for artifact storage backend and download mechanism. Revisit trigger: when the API and the worker no longer share a filesystem.

## ADR-0004-worker-role: The worker gets its own database role
- source: docs/adr/0004-the-builds-table-is-the-queue.md
- status: locked (Accepted, 2026-08-09)
- decision: `migrations/003_worker_role.sql` creates `qwa_worker` with `SELECT, UPDATE` on `builds`, `SELECT, INSERT` on `artifacts`, and `SELECT` on `configuration_revisions` — and deliberately nothing on `configurations`. The worker is handed ids and reads the immutable revision document; it never needs to know who owns what. The migration reports and continues if the migrating user lacks `CREATEROLE`, since managed Postgres often withholds it; the deployment is then responsible for provisioning the role from the same file.
- scope: worker database privileges, boundary enforcement between worker and application database

## ADR-0004-retention: Retention is a worker responsibility
- source: docs/adr/0004-the-builds-table-is-the-queue.md
- status: locked (Accepted, 2026-08-09)
- decision: `QueueRunner.maintain()` reclaims dead leases, expires artifacts, and deletes the corresponding objects. Database rows are removed before their blobs, so a failure leaves an orphaned object rather than a build promising a download that no longer exists.
- scope: artifact retention, lease reclamation, cleanup ordering
- consequences (also recorded in ADR 0004): one `pnpm test` run exercises the queue's real concurrency semantics against Postgres (`apps/api/src/builds/store-contract.test.ts`) and skips them when no database is reachable; a second worker process is `pnpm worker` again, with no coordination beyond the database; polling costs one query per worker per idle second, and `LISTEN/NOTIFY` fits behind `BuildQueue.claim` without changing anything else.
