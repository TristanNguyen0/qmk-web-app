# ADR 0001 — Technology stack

- **Status:** Accepted (artifact-storage row amended by [ADR 0004](0004-the-builds-table-is-the-queue.md), 2026-08-09)
- **Date:** 2026-08-08
- **Context:** `claude.md` § "Technology decisions — intentionally open" requires an explicit user
  decision before any stack is introduced, recorded here with rationale and migration constraints.

## Decisions

| Area | Decision | Rationale | Migration constraint |
| --- | --- | --- | --- |
| Language | TypeScript across frontend, API, and worker | The typed configuration model is the spine of this product (`claude.md` § Configuration model). One language lets `packages/domain` be the single literal definition of that schema rather than two drifting copies. | Any future non-TS service must consume the JSON Schema emitted from `packages/domain`, never re-declare the model by hand. |
| Frontend | Next.js (App Router) + React | Largest ecosystem; the visual keymap editor is genuinely client-heavy. | The frontend must render only from catalog/config API responses (`claude.md` rule: no unofficial client-side keyboard catalog), so it stays replaceable. |
| Backend | Fastify HTTP API | Small, fast, schema-first; integrates directly with the Zod/JSON-Schema domain types. | API contracts are versioned and published as JSON Schema; framework is an implementation detail behind them. |
| API style | REST + OpenAPI generated from domain schemas | Broadly interoperable and contract-testable. | Payload versioning required from day one. |
| Database | PostgreSQL 16 | Relational fit for configurations, revisions, builds, artifacts; transactional state transitions for the build state machine. | Schema changes go through migrations; no application code may assume SQLite semantics. |
| Queue | Database-backed queue (`SELECT … FOR UPDATE SKIP LOCKED`) | Avoids a second datastore. Build state and job state stay in one transaction, which makes the atomic/auditable transitions required by `claude.md` § Deterministic generation straightforward. | The queue is accessed only through `services/worker`'s job-claim interface, so swapping to Redis/BullMQ later touches one module. |
| Artifact storage | S3-compatible object storage (MinIO in dev). **Amended by [ADR 0004](0004-the-builds-table-is-the-queue.md):** access goes through an `ArtifactStore` interface (`packages/artifact-store`), filesystem-backed today; S3/MinIO is deferred until the API and the worker no longer share a filesystem. | Signed URLs and retention policies without exposing storage keys or worker paths. **Amended by ADR 0004:** signed URLs are not used — the API reads the object and streams it, so a key never leaves the server. | All access goes through the artifact service; storage keys never leave the server. Keys are derived from a build id by `keys.ts` and nowhere else. |
| Build isolation | Docker containers, one disposable container per build | Satisfies `claude.md` rule 7 in full: `--network=none`, read-only QMK base mount, tmpfs workspace, non-root user, dropped capabilities, CPU/memory/pid/wall-clock limits. Docker is already present on the target host. | The worker executes builds behind a `BuildSandbox` interface so a microVM backend can replace the Docker one without touching the generator. |
| Authentication | Anonymous signed-cookie sessions | Minimises friction for the prototype. Critically, ownership-based authorization exists from day one; only the *identity source* changes when accounts arrive. | Every configuration, build, log, and artifact read is authorized by `ownerId`. No code may assume `ownerId` is anonymous-only. |
| Styling | Tailwind CSS + headless primitives (Radix) | Fast iteration; accessible primitives matter for the editor's keyboard-navigation requirements. | — |
| Testing | Vitest (unit/integration) + Playwright (e2e) | Framework-native, matches the TS decision. | Fixture compilations run in the real isolated build image, not a mock. |
| Observability | Structured JSON logs now; OpenTelemetry-compatible exporters before public access | Avoids premature vendor lock-in. | Log redaction rules (`claude.md` § Build isolation) apply to every sink added later. |
| Browser flashing | Deferred (Phase 6), undecided | Requires the real compatibility matrix from actual artifacts/bootloaders. | No flashing claim may ship before verified detection. |

## QMK pin

- Upstream: `https://github.com/qmk/qmk_firmware.git`
- Tag: `0.33.13`
- Commit: `332fa30e173e5b0ecc0c70ff166974b6db86525e`

Recorded in `infra/qmk/manifest.json`, which is the single source of truth for discovery and builds.
A QMK update is a new catalog version and a new build image — never an in-place mutation.
