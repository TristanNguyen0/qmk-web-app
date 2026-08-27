<!-- refreshed: 2026-08-27 -->
# Architecture

**Analysis Date:** 2026-08-27

## System Overview

The QMK Firmware Customizer is a **three-tier web application** for visually editing QMK keyboard configurations and compiling them to firmware. A web frontend (Next.js) lets users browse keyboards from an immutable catalog, edit keymaps, and request builds. An API server (Fastify) validates configurations, queues builds, and serves artifacts. A background worker service processes the queue, runs isolated Docker compiles, and stores results.

```text
┌──────────────────────────────────────────────────────────────────┐
│                        Web Frontend (Next.js)                    │
│  - Keyboard picker (catalog-driven search)                       │
│  - Keymap editor with undo/redo and real-time layout rendering  │
│  - Build panel: submit, poll status, download firmware           │
│  `apps/web/src/`                                                  │
└─────────────────┬───────────────────────────────────────────────┘
                  │ HTTPS (development HTTP)
                  │ Session cookies, POST/GET
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│              API Server (Fastify) — Core Business Logic          │
│                     `apps/api/src/`                               │
├──────────────────────────────────────────────────────────────────┤
│ Routes (/v1)                                                     │
│  - Catalog: search keyboards, list keycodes, capability queries  │
│  - Configurations: CRUD with optimistic concurrency (ETags)      │
│  - Builds: queue, status polling, download artifacts, logs       │
│                                                                   │
│ Services                                                          │
│  - CatalogStore: loads versioned keyboard metadata               │
│  - ConfigurationRepository: Postgres-backed CRUD + revisions    │
│  - BuildRepository: queue management with leases                 │
│  - BuildService: validation, idempotency, quota enforcement      │
│                                                                   │
│ Infrastructure                                                    │
│  - Postgres: configurations, builds, revisions, leases           │
│  - FilesystemArtifactStore: stores firmware + sanitized logs    │
│  - Session middleware: anonymous user via secure cookies        │
└─────────────────┬───────────────────────────────────────────────┘
                  │ Postgres connection pool
                  │ Shared filesystem (artifact store)
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│              Worker Service — Isolated Compilation               │
│               `services/worker/src/queue-runner.ts`               │
├──────────────────────────────────────────────────────────────────┤
│  - Claim builds from Postgres queue with lease heartbeat         │
│  - Re-validate configuration against catalog                     │
│  - Generate JSON keymap via qmk-generator                        │
│  - Run isolated Docker container (hardened sandboxing)           │
│  - Collect firmware artifact and sanitized compiler log          │
│  - Handle failures, timeouts, resource limits                    │
│  - Expire old leases and clean up retained artifacts             │
└────────────────┬───────────────────────────────────────────────┘
                 │ Postgres queue + lease updates
                 │ Shared filesystem (read artifacts, write logs)
                 ▼
          ┌─────────────────┐
          │   Docker Host   │
          │  (build image)  │
          └─────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **Web Frontend** | Render catalog-driven keyboard picker, keymap visual editor with undo/redo, build panel | `apps/web/src/` |
| **API Routes** | HTTP layer: routing, request parsing, session authorization, response serialization | `apps/api/src/routes/` |
| **Catalog Store** | Load published keyboard catalogs (index + sharded details), search/filter, supply keyboard metadata to validators | `apps/api/src/catalog-store.ts` |
| **Configuration Service** | Create/update configurations, revision tracking, draft validation, catalog binding | `apps/api/src/configurations/service.ts` |
| **Build Service** | Validate build requests, enforce quotas, prepare queue records, check catalog availability | `apps/api/src/builds/service.ts` |
| **Build Repository** | Abstract queue operations: claim, complete, fail, cancel, list, pagination | `packages/build-queue/src/` |
| **Domain Types & Validation** | Typed configuration schema (Zod), keycode allowlist, catalog type definitions, error codes | `packages/domain/src/` |
| **QMK Generator** | Deterministic keymap JSON generation (no C, no Make) from validated config + catalog | `packages/qmk-generator/src/generate.ts` |
| **QMK Sandbox** | Docker-based build isolation, resource limits, security constraints, artifact collection | `packages/qmk-sandbox/src/` |
| **Artifact Store** | Key-based storage and retrieval of firmware + logs (filesystem or S3-compatible) | `packages/artifact-store/src/` |
| **Queue Runner** | Worker loop: claim build, validate, generate, compile, collect artifact, update status, recover leases | `services/worker/src/queue-runner.ts` |
| **Artifact Store** | Write/read firmware, logs, metadata to persistent storage | `packages/artifact-store/src/` |

## Pattern Overview

**Overall:** Layered event-driven architecture with domain-driven boundaries and contract testing.

**Key Characteristics:**
- **Session-based anonymous users:** No accounts; user identity is a UUID stable to a session cookie, scoped on all reads/writes
- **Immutable configurations with versioning:** Configurations are MVCC-style; a build always references an exact revision; concurrent edits detected via ETag
- **Queue-as-table design:** Builds table itself is the job queue (ADR 0004); leases handle worker failure detection and task recovery
- **Deterministic reproducibility:** Builds capture the exact catalog version, QMK commit, generator version, and Docker image digest — compiles are byte-identical reruns
- **Validation on every boundary:** API re-validates against live catalog before queueing; worker re-validates before generating
- **Contract testing over mocking:** Store and repository interfaces are tested via contract suites that run against both in-memory and real (Postgres) implementations

## Layers

**Web Frontend (Next.js + React):**
- Purpose: Interactive UI for catalog browsing, keymap editing, build management
- Location: `apps/web/src/`
- Contains: Page components, client-side components (editor, layout renderer, build panel), API client, editor state reducer
- Depends on: Domain types package for TypeScript definitions, API via HTTP fetch
- Used by: End users' browsers

**API Server (Fastify):**
- Purpose: Business logic, request validation, authorization, persistence coordination
- Location: `apps/api/src/`
- Contains: Route handlers (/catalog, /configurations, /builds), repository implementations, catalog loader, session middleware, error handling
- Depends on: Domain types, repositories (Postgres, in-memory), catalogs, generators
- Used by: Web frontend (HTTP), workers (Postgres queue operations)

**Queue & Worker:**
- Purpose: Execute builds asynchronously in isolation
- Location: `services/worker/src/`
- Contains: Queue polling loop (claim → process → record), build execution, artifact collection, lease recovery, log redaction
- Depends on: Domain types, repositories, generators, sandbox, artifact store
- Used by: API server (queues work), background job runner

**Domain (Shared Types & Contracts):**
- Purpose: Single source of truth for configuration schema, keycodes, validation, error codes, business limits
- Location: `packages/domain/src/`
- Contains: Zod schema, keycode allowlist, build state machine, limits, identifiers, validation functions
- Depends on: Zod for schema
- Used by: All other packages

**Repositories (Abstract Storage):**
- Purpose: Data access abstraction; swappable implementations
- Location: `packages/build-queue/src/`, `apps/api/src/configurations/`
- Contains: Interface definitions, in-memory implementations, Postgres implementations
- Depends on: Domain types, PostgreSQL driver (pg) when concrete
- Used by: API server, worker

**Catalog System:**
- Purpose: Immutable, versioned keyboard metadata
- Location: `packages/qmk-catalog/src/`, `apps/api/src/catalog-store.ts`, `catalogs/`
- Contains: Catalog normalization, search logic, catalog loading from filesystem, sharded detail index
- Depends on: Domain types
- Used by: API (search/detail), validators, generators

**Generator:**
- Purpose: Deterministic keymap JSON generation
- Location: `packages/qmk-generator/src/`
- Contains: JSON generation algorithm, workspace layout setup, file output
- Depends on: Domain types, Zod for validation
- Used by: Worker during build

**Sandbox:**
- Purpose: Hardened Docker-based build isolation
- Location: `packages/qmk-sandbox/src/`
- Contains: Sandbox contract, Docker implementation, resource limit enforcement, capability dropping
- Depends on: Crypto (artifact key generation)
- Used by: Worker

**Artifact Store:**
- Purpose: Persist and retrieve firmware + logs
- Location: `packages/artifact-store/src/`
- Contains: Key-based storage interface, filesystem implementation, in-memory implementation
- Depends on: Crypto, Node.js fs/path
- Used by: API (download), worker (write artifacts)

## Data Flow

### Primary Request Path: Create Configuration

1. User fills keymap editor → saves configuration (`apps/web/src/components/KeymapEditor.tsx`)
2. Browser `POST /v1/configurations` with keyboard ID, layers, macros (`apps/web/src/lib/client.ts`)
3. API receives request, extracts session from cookie (`apps/api/src/routes/configurations.ts`)
4. Validates full configuration against catalog (`packages/domain/src/validate.ts`)
5. Stores configuration record and initial revision in Postgres (`apps/api/src/configurations/postgres-repository.ts`)
6. Returns configuration with revision number for optimistic locking
7. Client shows "saved" state, enables Build button

### Primary Request Path: Build Request

1. User clicks **Build firmware** button in saved configuration (`apps/web/src/components/BuildPanel.tsx`)
2. Browser `POST /v1/configurations/:id/builds` with idempotency key (required)
3. API fetches current configuration revision (`apps/api/src/builds/service.ts`)
4. **Validates configuration against current catalog** (even though valid when saved, catalog may have changed)
5. Checks build quota (2 concurrent, 20/hour per session)
6. Inserts `builds` row with `status='queued'` and idempotency key (`packages/build-queue/src/postgres-store.ts`)
7. Returns build ID
8. User polls `GET /v1/builds/:id` to watch status
9. **Worker claims build** with `SELECT … FOR UPDATE SKIP LOCKED` + lease (2-minute expiry, 30s heartbeat)
10. **Worker re-validates configuration** (once more, before generation)
11. Calls qmk-generator → generates JSON keymap (`packages/qmk-generator/src/generate.ts`)
12. Writes generated files to temporary workspace
13. Launches Docker container (read-only QMK tree, network=none, strict resource limits, unprivileged user)
14. Compile runs; worker polls for completion
15. If successful: collects firmware artifact (`packages/qmk-sandbox/src/collect-artifact.ts`), stores to artifact store with key
16. Sanitizes compiler log (redacts filesystem paths, temp names) (`services/worker/src/redact.ts`)
17. Updates build row: `status='succeeded'`, `artifact_id`, `log_reference`
18. User downloads firmware via `GET /v1/builds/:id/artifact` → API streams from artifact store

**State Management:**
- Configuration state: Postgres (immutable revisions), session cookie (ownership)
- Build state: Postgres (queue + lease), artifact store (firmware + logs)
- Catalog state: Loaded in memory at API startup, immutable per version
- Editor state: Client-side reducer (undo/redo, dirty tracking) until saved to server

## Key Abstractions

**Configuration:**
- Purpose: Represents a named keymap for a specific keyboard layout
- Examples: `apps/api/src/configurations/types.ts`, `packages/domain/src/configuration.ts`
- Pattern: MVCC with immutable revisions; server-side validated schema (Zod)

**Build:**
- Purpose: Represents a compilation request for a configuration revision
- Examples: `packages/domain/src/build.ts`, `apps/api/src/builds/service.ts`
- Pattern: State machine (queued → preparing → building → uploading → succeeded/failed/cancelled); leased queue claim

**Catalog:**
- Purpose: Immutable, versioned collection of keyboard metadata
- Examples: `packages/qmk-catalog/src/`, `catalogs/0.33.13-1/`
- Pattern: Directory-based, sharded by keyboard detail, pinned to QMK revision

**BuildRepository:**
- Purpose: Abstract interface for build queue operations
- Examples: `packages/build-queue/src/types.ts` (interface), `postgres-store.ts`, `memory-store.ts`
- Pattern: Contract interface with multiple implementations (in-memory for tests, Postgres for production)

**ArtifactStore:**
- Purpose: Abstract interface for persisting firmware and logs
- Examples: `packages/artifact-store/src/types.ts` (interface), `filesystem-store.ts`, `memory-store.ts`
- Pattern: Key-based storage with suffix-based type routing

## Entry Points

**Web Frontend:**
- Location: `apps/web/src/app/layout.tsx` (Next.js root layout)
- Triggers: Browser navigation, user interaction
- Responsibilities: Render layout, route to pages (keyboard picker / configuration editor / configuration list), manage session from cookie

**API Server:**
- Location: `apps/api/src/server.ts`
- Triggers: Process start; listens on PORT (default 3001)
- Responsibilities: Load catalog from `QWA_CATALOG_DIR`, connect to Postgres, initialize Fastify app, register routes

**Worker:**
- Location: `services/worker/src/index.ts`
- Triggers: Process start; runs continuously
- Responsibilities: Poll Postgres for queued builds, claim one, execute (validate → generate → compile → collect → update), repeat

## Architectural Constraints

- **Threading:** Single-threaded event loop (Node.js). Worker process is independent (separate service). Postgres connection pool (max 10) serializes database access.
- **Global state:** Catalog is loaded into memory at API startup and never reloaded (immutable per version). ArtifactStore and BuildRepository are singletons per process.
- **Circular imports:** None enforced via TypeScript module strategy (barrel files organize exports, no backlinks)
- **Configuration pinning:** Builds capture `catalogVersion`, `qmkCommit`, `generatorVersion`, `buildImageRef`, `buildImageDigest` — reproducibility requires all five to be immutable
- **Session scope:** All authorization is by `owner_id` (session UUID); no cross-session visibility

## Anti-Patterns

### Silent Configuration Stale-ness

**What happens:** A configuration is saved against a catalog version (e.g., `0.33.13-1`). Later, the server is restarted with a different catalog published (e.g., `0.33.14`). A build request for the old configuration should fail clearly, but without re-validation the server might silently retarget it or compile against unexpected metadata.

**Why it's wrong:** Claude.md § Source management forbids silent retargeting. Reproducibility is lost; auditing becomes impossible.

**Do this instead:** `apps/api/src/builds/service.ts` lines 43–56 — Always re-validate the configuration against the catalog it names, before queueing. If the catalog is missing, throw `CATALOG_KEYBOARD_UNAVAILABLE` explicitly.

### Missing Idempotency on Idempotent API

**What happens:** Build creation is retried (flaky network, browser refresh). Without an idempotency key, two builds are created for one request. The user sees duplicates and may waste quota.

**Why it's wrong:** Idempotency is a boundary-layer property; it must be enforced at the database level (unique index), not in application logic.

**Do this instead:** `apps/api/src/routes/builds.ts` lines 39–43 — Require `Idempotency-Key` header; use a UNIQUE INDEX on `(owner_id, idempotency_key)` in Postgres. Duplicate submissions hit the constraint and are rejected with a 409 or return the existing build.

### Trusting Configuration JSON from Database Without Validation

**What happens:** A configuration is retrieved from Postgres and passed directly to the generator. If the database row was corrupted, or if the schema evolved but data was not migrated, the generator may accept invalid input and produce incorrect firmware.

**Why it's wrong:** Storage is not a validation layer; data can change between writes and reads (corruption, migrations, schema version mismatches).

**Do this instead:** `services/worker/src/queue-runner.ts` lines ~100 — Re-validate the configuration against the Zod schema before generation, exactly as the API did when the build was queued. Validation is cheap and catches errors early.

## Error Handling

**Strategy:** Explicit error codes over opaque messages. Every `DomainError` carries a code (e.g., `CONFIG_INVALID`, `CATALOG_KEYBOARD_UNAVAILABLE`) that survives logging and API responses, enabling client logic to respond appropriately.

**Patterns:**
- **Validation errors:** Zod parse failures produce an array of field-level errors; API responds with `apiVersion`, error code, and `fieldErrors` array
- **Transient failures:** Build timeout, resource limit, compile failure → recorded in `builds.failure_code` and `builds.log_reference`; client can retry or show log
- **Non-retryable:** Catalog missing, schema invalid → immediate error, not queued
- **Lease expiry:** Worker heartbeat fails → build becomes claimable by another worker; no manual intervention
- **Artifact not produced:** Compiler succeeded but output was missing → `ARTIFACT_NOT_PRODUCED` failure code; log shows compiler output

## Cross-Cutting Concerns

**Logging:** Structured JSON to stdout (worker emits via callback in `QueueRunnerOptions.log`); API uses Fastify's logger when enabled; client errors are caught at route handlers and converted to error responses.

**Validation:** 
- **Structural:** Zod schema (`packages/domain/src/configuration.ts`) enforces layer count, position indices, macro structure
- **Semantic:** `validateConfiguration()` calls check against catalog (layout positions, keycode allowlist, capability availability like SOCD)
- **Timing:** API validates on create/update; worker re-validates before generation; no in-between trust

**Authentication:** Session UUID from secure cookie; no password, no OAuth. Anonymous sessions are long-lived until cookie expires. Ownership checks on every read/write prevent cross-session access.

---

*Architecture analysis: 2026-08-27*
