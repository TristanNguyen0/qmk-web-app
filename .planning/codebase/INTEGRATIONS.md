# External Integrations

**Analysis Date:** 2026-08-27

## APIs & External Services

**QMK Firmware:**
- QMK GitHub repository and CLI
  - SDK/Client: Docker-based QMK CLI in `infra/qmk/Dockerfile`
  - Integration: Pinned checkout via `pnpm qmk:fetch` script
  - Purpose: Keyboard definition source, compile toolchain
  - Usage: Worker calls QMK compile via Docker sandbox

**Hardware/Keyboard Registry:**
- Published keyboard catalogs (internal database)
  - Location: `catalogs/` directory
  - Format: JSON-based catalog files per keyboard version
  - Updated via: `pnpm catalog:build` script in `packages/qmk-catalog/`

## Data Storage

**Databases:**
- PostgreSQL 16
  - Connection: Via `pg` client library (v8.22.0)
  - Default URL: `postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa`
  - Environment variable: `QWA_DATABASE_URL`
  - Credentials: 
    - API role: `qwa` (full permissions)
    - Worker role: `qwa_worker` (limited, read-only on some tables)
  - Location: `apps/api/migrations/` (3 migration files)
  - Tables:
    - `configurations` - User keyboard configurations (1:1 per owner)
    - `builds` - Firmware build requests and status
    - Worker-specific tables defined in `003_worker_role.sql`

**File Storage:**
- Filesystem-based artifact store (primary implementation)
  - Location: `<repo>/var/artifacts` (default) or `QWA_ARTIFACT_DIR`
  - Implementation: `packages/artifact-store/` with `FilesystemArtifactStore` class
  - Usage: Stores compiled firmware binaries from successful builds
  - Artifacts include: SHA256 hash, MIME type, expiration timestamp
  - Future migration path: S3-compatible backend (mentioned in ADR 0004)
  - Access: Read by API for downloads, written by worker service

**Caching:**
- None detected - HTTP cache control set to `no-store` for all responses in `apps/api/src/app.ts` (line 42)
- In-memory catalog store loaded at startup in `apps/api/src/catalog-store.ts`

## Authentication & Identity

**Auth Provider:**
- Custom anonymous signed-cookie sessions (no third-party auth)
  - Implementation: `apps/api/src/session.ts`
  - Mechanism: 
    - Session cookie: `qwa_session`
    - Format: UUID + HMAC-SHA256 signature
    - Signing key: `QWA_SESSION_SECRET` environment variable (required in production)
    - Security: Timing-safe comparison, HttpOnly flag, SameSite=Lax
    - Duration: 1 year (365 days)
  - Owner ID: Stable UUID per session used for authorization
  - Future upgrade path: Custom identity providers can swap the session source

**Authorization:**
- Ownership-based: All resources (configurations, builds) tied to `ownerId` from session
- No user accounts in current implementation - each session owns its data
- Session loses all data if cookie is deleted (no persistent account recovery)

## Monitoring & Observability

**Error Tracking:**
- None detected - No external error tracking service integration

**Logs:**
- Structured JSON logging per ADR 0001
- Implementation: `services/worker/src/main.ts` (lines 42-45)
- Output: `stdout` with fields: `{level, worker, time, ...rest}`
- Application logging:
  - API: Fastify logger enabled via `logger: true` in `apps/api/src/server.ts`
  - Worker: Custom structured JSON logging to stdout
- Log levels: `info`, `warn`, `error` observed in worker code

## CI/CD & Deployment

**Hosting:**
- Docker for containerization
  - QMK build image: Docker-based sandbox in `infra/qmk/Dockerfile`
  - Base image: `qmkfm/qmk_cli` (pinned by digest)
  - Development database: PostgreSQL 16 via `infra/deploy/docker-compose.yml`

**CI Pipeline:**
- None detected - No CI/CD service configured
- Manual testing: `pnpm test` (Vitest), `pnpm typecheck`
- Manual deployment: Node.js processes run directly with `node --experimental-strip-types`

**Build Infrastructure:**
- Docker image for QMK compilation
  - Reference: Built via `docker build -t <imageRef> infra/qmk`
  - Image digest stored in manifest and recorded with each build
  - Mounts QMK source read-only, workspace writable
  - Unprivileged user (builder:builder, UID/GID 2000)

## Environment Configuration

**Required Environment Variables (Production):**
- `QWA_SESSION_SECRET` - HMAC signing key (minimum 32 characters)
- `NODE_ENV=production` - Enables production security checks

**Configuration Files:**
- `infra/deploy/docker-compose.yml` - Local development PostgreSQL setup
- `infra/qmk/manifest.ts` - Build image reference and QMK checkout configuration
- `.env` - Not committed; create locally for development
- Lockfile: `pnpm-lock.yaml` - All dependencies pinned by version

**Secrets Location:**
- Development: Hardcoded in code (QMK catalog, test fixtures)
- Production: Environment variables only
  - `QWA_SESSION_SECRET` - Required
  - `QWA_DATABASE_URL` - Can override default
- No external secrets vault detected

## Webhooks & Callbacks

**Incoming:**
- None detected - No webhook receivers implemented

**Outgoing:**
- None detected - No webhooks sent to external services

## Database Connectivity

**Connection Pattern:**
- `apps/api/src/server.ts`: Creates PostgreSQL connection pool (max: 10 connections)
- `services/worker/src/main.ts`: Creates PostgreSQL connection pool (max: 4 connections)
- Connection string resolved from `QWA_DATABASE_URL` environment variable
- Pool lifecycle managed per process (closed on SIGINT/SIGTERM)

**Migrations:**
- Run automatically at API startup via `runMigrations()` in `apps/api/src/db/migrate.ts`
- Migration files: `apps/api/migrations/001_*.sql` through `003_*.sql`
- Worker never runs migrations - schema owned by API process only

## API Design

**Session Flow:**
1. Client request arrives without session cookie
2. `registerSessions()` hook in `apps/api/src/session.ts` (line 75) creates new session UUID
3. HMAC-SHA256 signature appended: `<uuid>.<mac>`
4. Cookie set in response with `Set-Cookie` header (HttpOnly, SameSite=Lax, 1-year Max-Age)
5. Subsequent requests pass cookie, hook verifies signature and restores `request.ownerId`

**Build Request Flow:**
1. Client posts to `/v1/configurations/<id>/builds` with idempotency key
2. API validates configuration ownership via `ownerId`
3. Build record created in PostgreSQL `builds` table with `preparing` status
4. Worker picks up build from queue via `PostgresBuildStore`
5. Worker runs QMK compile in Docker sandbox
6. Artifacts written to `QWA_ARTIFACT_DIR`
7. Worker updates build status to `succeeded`/`failed`/`cancelled`
8. Client polls `/v1/builds/<id>` for status and artifact download URL

**Artifact Download:**
- API serves artifacts at `/api/v1/builds/<id>/artifact` (session-authorized, not direct storage access)
- Prevents exposing storage keys to client
- Includes auth check on `ownerId` ownership of build

---

*Integration audit: 2026-08-27*
