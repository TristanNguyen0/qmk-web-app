# Context (from DOCs)

Source document classified `DOC`: `README.md` (confidence: high, locked: false).
Precedence tier: DOC (lowest). README itself states: "`claude.md` is the operating guide for this
project and takes precedence over this file. Architectural decisions live in `docs/adr/`." — this
matches the configured precedence (ADR > SPEC > PRD > DOC), so no override is needed.

---

## Topic: Delivery status against the phased plan
- source: README.md § Status
- Phases 0 through 3 are complete: a user can select a keyboard, edit a keymap, request a build, and download compiled firmware.
- Phase 0 — foundations and decisions: **Done.** Stack decided (ADR 0001), QMK pinned, reproducibility spike passing.
- Phase 1 — catalog and read-only UI: **Done.** 3,748 keyboards published, read API, visual layout renderer, unsupported-state UX.
- Phase 2 — saved visual configurations: **Done.** Postgres persistence, revisions, anonymous sessions, layer editor, structured macros, undo/redo, autosave.
- Phase 3 — generation and server builds: **Done.** Queue, isolated worker, artifact storage, build API, quotas, retention, download from the editor.
- Phase 4 — verified SOCD support: Not started. Schema exists; validation and generation deliberately refuse it.
- Phases 5–6 — hardening, flashing: Not started.

## Topic: Local run / developer workflow
- source: README.md § What works today
- `pnpm install`
- `pnpm qmk:fetch --submodules` — fetch and verify the pinned QMK tree (~1.5 GB with submodules)
- `docker build -t qmk-web-app/qmk-build:0.33.13-1 infra/qmk`
- `pnpm catalog:build` — discover all 3,748 keyboards (~10 min)
- `docker compose -f infra/deploy/docker-compose.yml up -d` — Postgres
- `pnpm dev` — API on :3001, web UI on :3000
- `pnpm worker` — build worker, in a second terminal
- A `crkbd/rev1` build takes about 20 seconds end to end.
- `node --experimental-strip-types services/worker/scripts/smoke-build.ts catalogs/0.33.13-1` — bypasses the queue, takes a validated configuration through generation, an isolated compile, and artifact collection, then builds it twice and checks the firmware is byte-identical.

## Topic: Web UI capabilities today
- source: README.md § The web UI
- Search and page through every keyboard in the catalog.
- Real layouts drawn from validated QMK position metadata, including rotated keys.
- Keys show their physical position index and matrix coordinates, not keycodes — nothing is bound yet, and inventing legends would misrepresent the hardware.
- Keyboards the catalog cannot offer are reachable and explain why, rather than 404ing.
- Click or arrow keys to inspect a key; selection is signalled by fill, stroke width, and an inset ring, so it never depends on colour alone.
- Keymap editing: layer tabs, searchable keycode picker, layer actions, mod-taps, structured macros, undo/redo (Ctrl/Cmd-Z), debounced autosave.
- Configurations belong to an anonymous session cookie; every read and write is authorized by owner, so accounts later change only where the owner id comes from.
- Saves use `If-Match`; a concurrent edit produces a visible conflict rather than a silent overwrite.
- Build and download: request a build, watch progress, cancel it, download the firmware with its SHA-256, or read the sanitized compiler log when it fails. A build compiles a *stored revision*, so the button is disabled until edits have been saved.

## Topic: Build API surface and lifecycle as implemented
- source: README.md § Builds
- A build is a row in `builds` that carries its own queue lease — there is no separate job table (ADR 0004).
- `POST /v1/configurations/:id/builds` — validate, check quota, insert `queued` (Idempotency-Key required)
- worker claims it — `UPDATE … FOR UPDATE SKIP LOCKED`, lease + heartbeat
- `preparing → building → uploading` — re-validate, generate, compile in Docker, collect artifact
- `succeeded` — artifact row + object, sanitized log
- `GET /v1/builds/:id` — poll status
- `GET /v1/builds/:id/artifact` — authorized download, streamed by the API
- `GET /v1/builds/:id/log` — authorized, redacted, capped
- `POST /v1/builds/:id/cancel` — cancels a queued build; requests it for a running one

## Topic: Concrete product limits (BUILD_LIMITS)
- source: README.md § Builds, citing `packages/domain/src/limits.ts`
- 2 concurrent builds and 20 per hour per session
- 2-minute lease
- 3 attempts
- 7-day artifact and log retention
- `QueueRunner.maintain()` reclaims leases from dead workers and deletes expired objects.
- note: claude.md § Visual keymap editor records macro/product limits as "exact limits: TBD"; these README values are the concrete implementation and were not written back into the SPEC.

## Topic: Published catalog format
- source: README.md § Catalog format
- A published catalog is a directory, not one file:
  ```
  catalogs/0.33.13-1/
    index.json              1.3 MB — metadata + one summary per keyboard
    keyboards/NNNN.json     sharded detail, loaded on demand
  ```
- The full tree is ~150 MB of keyboard detail. Sharding keeps API startup fast and its heap small.
- Detail lookups resolve through a `detailPath` recorded at publish time, never a path built from a request.

## Topic: Checks / test commands
- source: README.md § Checks
- `pnpm typecheck`
- `pnpm test` — 302 tests, no Docker required
- `pnpm test` runs the Postgres half of the repository contract suites too, when a database is reachable; it skips them otherwise, so the default run stays hermetic.

## Topic: Repository layout as built
- source: README.md § Layout
- `apps/api/` — Fastify API: catalog reads, configurations, builds, artifact download
- `apps/web/` — Next.js keyboard picker, visual layout renderer, keymap editor, build panel
- `packages/domain/` — typed configuration schema, keycode allowlist, identifier validation, build state machine, product limits, server-side validation
- `packages/qmk-catalog/` — normalizes extractor output into an immutable, versioned catalog
- `packages/qmk-generator/` — deterministic keymap generation (JSON only — no C, no Make)
- `packages/qmk-sandbox/` — the `BuildSandbox` contract and its hardened Docker implementation
- `packages/build-queue/` — `BuildRepository` + `BuildQueue` contracts, in-memory and Postgres stores
- `packages/artifact-store/` — `ArtifactStore` contract, key derivation, filesystem and in-memory stores
- `packages/qmk-fixtures/` — small fixtures captured from real extractions of the pinned tree
- `infra/deploy/` — docker-compose for local Postgres
- `services/worker/` — queue loop, generation + compile, artifact identification, log redaction, lease recovery and retention
- `infra/qmk/` — pinned manifest, build image, catalog extractor, entrypoint
- `docs/adr/` — architecture decision records
- note: `packages/qmk-sandbox`, `packages/build-queue`, and `packages/artifact-store` are not in claude.md's suggested repository shape, which explicitly permits adaptation.

## Topic: Security properties currently enforced
- source: README.md § Security properties currently enforced (README states each is verified by a test or by the smoke build, not just intended)
- The QMK tree is mounted read-only and is never written to — verified after every build.
- Builds run with `--network=none`, `--read-only`, `--cap-drop=ALL`, `no-new-privileges`, an unprivileged user, and CPU/memory/pid/wall-clock caps.
- No shell evaluation anywhere; every command is an argument vector.
- Generation emits only `qmk.json` and `keymap.json`. C, Make, and headers are refused.
- Keyboard ids are rejected unless they match the catalog, so user text never becomes a path.
- The generated keymap directory name is derived from the build id, never from a user name.
- Generated writes are contained: traversal, NULs, absolute paths, and symlinked path components are all rejected.
- Artifacts are accepted only at the one expected path; stray or extra firmware files fail the build.
- Logs are redacted (paths, signed URLs, credentials) and capped before a user sees them.
- Configurations are scoped by owner in the SQL WHERE clause. Cross-session access returns 404, not 403, so ids cannot be probed.
- Session cookies are HMAC-signed, `HttpOnly`, `SameSite=Lax`; a tampered cookie starts a fresh session rather than being honoured.
- Clients cannot set `id`, `ownerId`, `revision`, or `schemaVersion` — the server assigns them.
- Updates require `If-Match` and are applied under `SELECT … FOR UPDATE`, so concurrent writers cannot both win.
- Builds, logs, and artifacts are owner-scoped the same way; a cross-session request gets 404.
- Storage keys are derived from a build id and never returned to a client; downloads are streamed by the API, so there is no URL to share or replay.
- A build request needs an `Idempotency-Key`, and the key is a unique index — a retried request cannot start a second compile.
- Every worker write is conditional on holding the lease and on the status it is leaving.
- A cancelled build's firmware is discarded even if the compile had already succeeded; its log is kept.
- Per-session quotas cap concurrent and hourly builds; both return `BUILD_QUEUE_LIMITED`.
- The worker re-validates the stored configuration against the catalog rather than trusting that the API validated it before queueing.
- The worker has its own database role with no access to `configurations` at all (`apps/api/migrations/003_worker_role.sql`).

## Topic: Known gaps
- source: README.md § Known gaps
- **SOCD is not implemented.** The schema models it, and both validation and generation refuse to enable it, per `claude.md` rule 9 — the pinned revision's SOCD interface has not been verified yet.
- Only `crkbd/rev1` has been through a real compile; the curated smoke matrix does not exist yet. 3,743 keyboards are *catalogued*, which is a weaker claim than *known to build*.
- No real authentication: sessions are anonymous cookies, so clearing cookies loses your work.
- Artifact storage is a shared directory. The `ArtifactStore` seam is in place, but S3 is not implemented, so the API and the worker must share a filesystem (ADR 0004).
- The worker polls once a second per idle worker; there is no `LISTEN/NOTIFY` yet.
- No global build concurrency limit or IP-based rate limiting — only per-session quotas.
- No end-to-end browser tests yet; the UI is covered by API tests and pure geometry unit tests.

## Topic: Pinned QMK revision (restated)
- source: README.md § Pinned QMK revision
- Tag `0.33.13`; Commit `332fa30e173e5b0ecc0c70ff166974b6db86525e`.
- `infra/qmk/manifest.json` is the single source of truth. Changing it means a new catalog version and a new build image — never an in-place update.
- Identical to ADR-0001-qmk-pin and claude.md § Pinned QMK revision. No conflict across all three tiers.
