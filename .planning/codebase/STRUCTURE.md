# Codebase Structure

**Analysis Date:** 2026-08-27

## Directory Layout

```
qmk-web-app/                       # Monorepo root (pnpm workspaces)
├── apps/
│   ├── api/                       # Fastify API server
│   │   ├── src/
│   │   │   ├── app.ts            # Fastify app factory
│   │   │   ├── server.ts         # Server entrypoint, env setup
│   │   │   ├── catalog-store.ts  # Catalog loading & search
│   │   │   ├── session.ts        # Session cookie middleware
│   │   │   ├── errors.ts         # Error response formatting
│   │   │   ├── routes/           # Route handlers
│   │   │   │   ├── catalog.ts    # GET /v1/catalog/*
│   │   │   │   ├── configurations.ts  # POST/PATCH /v1/configurations
│   │   │   │   └── builds.ts     # POST/GET /v1/builds/*
│   │   │   ├── configurations/   # Configuration persistence & validation
│   │   │   │   ├── types.ts      # ConfigurationRepository interface
│   │   │   │   ├── service.ts    # Create/update logic, draft validation
│   │   │   │   ├── postgres-repository.ts  # Postgres implementation
│   │   │   │   ├── memory-repository.ts    # Test implementation
│   │   │   │   └── repository-contract.test.ts  # Interface contract tests
│   │   │   ├── builds/           # Build queue operations
│   │   │   │   ├── service.ts    # Prepare build, validate quota, idempotency
│   │   │   │   └── store-contract.test.ts  # Queue contract tests
│   │   │   └── db/               # Database
│   │   │       └── migrate.ts    # Schema migration runner
│   │   ├── migrations/           # SQL schema files (order matters)
│   │   │   ├── 001_configurations.sql  # Configurations & revisions
│   │   │   ├── 002_builds.sql         # Builds queue & leases
│   │   │   └── 003_worker_role.sql    # Worker user permissions
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                       # Next.js frontend
│       ├── src/
│       │   ├── app/              # Next.js App Router pages & layouts
│       │   │   ├── layout.tsx    # Root layout (header, nav, main)
│       │   │   ├── page.tsx      # Home: keyboard picker
│       │   │   ├── globals.css   # Global styles
│       │   │   ├── keyboards/    # Keyboard detail pages
│       │   │   │   └── [...keyboardId]/page.tsx  # Keyboard detail + editor
│       │   │   ├── configurations/  # Configuration list & editor
│       │   │   │   ├── page.tsx      # List saved configurations
│       │   │   │   └── [id]/page.tsx # Edit configuration
│       │   │   └── api/          # Next.js API routes (fetch proxy)
│       │   │       └── [...path]/route.ts  # Proxy to backend API
│       │   ├── components/       # React UI components
│       │   │   ├── KeymapEditor.tsx     # Main editor (uses editor-state reducer)
│       │   │   ├── KeyboardLayout.tsx   # Visual layout renderer
│       │   │   ├── BindingPicker.tsx    # Keycode/action picker
│       │   │   ├── MacroEditor.tsx      # Macro step editor
│       │   │   ├── BuildPanel.tsx       # Build submit/status/download
│       │   │   └── CreateConfigurationButton.tsx  # New config modal
│       │   └── lib/              # Utilities & state management
│       │       ├── api.ts        # Typed API client (catalog fetches)
│       │       ├── client.ts     # HTTP client (configuration & build APIs)
│       │       ├── editor-state.ts      # Configuration editor state reducer (pure)
│       │       ├── editor-state.test.ts # Undo/redo, macro, layer tests
│       │       ├── layout-geometry.ts   # Visual layout calculation
│       │       └── layout-geometry.test.ts
│       ├── package.json
│       ├── tsconfig.json
│       ├── next.config.ts
│       └── .next/                # Build output (git-ignored)
│
├── packages/                      # Shared libraries (zero-dependency for reuse)
│   ├── domain/                   # Core domain types & validation
│   │   ├── src/
│   │   │   ├── index.ts          # Barrel export
│   │   │   ├── configuration.ts  # Configuration schema (Zod)
│   │   │   ├── catalog.ts        # Catalog & keyboard types
│   │   │   ├── build.ts          # Build state machine & types
│   │   │   ├── keycodes.ts       # Allowlisted keycodes
│   │   │   ├── limits.ts         # BUILD_LIMITS (quota, retention, lease)
│   │   │   ├── identifiers.ts    # ID shape validation
│   │   │   ├── errors.ts         # DomainError, ERROR_CODES
│   │   │   ├── validate.ts       # validateConfiguration() & helpers
│   │   │   ├── build.test.ts     # Build state tests
│   │   │   ├── validate.test.ts  # Configuration validation tests
│   │   │   ├── keycodes.test.ts
│   │   │   └── ... more tests
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── dist/                 # Compiled output
│   │
│   ├── build-queue/              # Build repository & queue abstraction
│   │   ├── src/
│   │   │   ├── index.ts          # Barrel export (BuildRepository, BuildQueue)
│   │   │   ├── types.ts          # BuildRepository interface
│   │   │   ├── memory-store.ts   # In-memory implementation (tests)
│   │   │   ├── postgres-store.ts # Postgres implementation (production)
│   │   │   └── ... no tests here; contract tested elsewhere
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── dist/
│   │
│   ├── artifact-store/           # Firmware & log persistence
│   │   ├── src/
│   │   │   ├── index.ts          # Barrel export
│   │   │   ├── types.ts          # ArtifactStore interface
│   │   │   ├── keys.ts           # Key generation & validation
│   │   │   ├── filesystem-store.ts  # Filesystem implementation
│   │   │   ├── memory-store.ts      # In-memory implementation
│   │   │   ├── store.test.ts     # Contract tests (both implementations)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── dist/
│   │
│   ├── qmk-catalog/              # Catalog format, loading, normalization
│   │   ├── src/
│   │   │   ├── index.ts          # Barrel export
│   │   │   ├── types.ts          # Catalog, Keyboard, Layout types
│   │   │   ├── normalize.ts      # Extract → catalog transformation
│   │   │   └── normalize.test.ts # Normalization tests
│   │   ├── scripts/              # Catalog build scripts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── dist/
│   │
│   ├── qmk-generator/            # Keymap JSON generation (deterministic)
│   │   ├── src/
│   │   │   ├── index.ts          # Barrel export
│   │   │   ├── generate.ts       # Main generation algorithm
│   │   │   ├── write-workspace.ts # Filesystem writing utilities
│   │   │   ├── generate.test.ts  # Generation tests (fixture configs)
│   │   │   └── write-workspace.test.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── dist/
│   │
│   ├── qmk-sandbox/              # Docker-based build isolation
│   │   ├── src/
│   │   │   ├── index.ts          # Barrel export
│   │   │   ├── types.ts          # BuildSandbox interface, SandboxLimits
│   │   │   ├── docker.ts         # Docker implementation (run, monitor, collect)
│   │   │   └── ... no tests; integration tested via worker
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── dist/
│   │
│   ├── qmk-fixtures/             # Test data (small real-world examples)
│   │   ├── data/                 # Fixture catalogs & configurations
│   │   ├── src/                  # TypeScript fixture loaders
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── domain/                   # (described above)
│
├── services/
│   └── worker/                   # Background build worker
│       ├── src/
│       │   ├── index.ts          # Entrypoint, CLI arg parsing
│       │   ├── main.ts           # Worker initialization (catalog, queue, sandbox)
│       │   ├── queue-runner.ts   # Main loop: claim → process → record
│       │   ├── run-build.ts      # Build execution (pure: config in → artifact out)
│       │   ├── collect-artifact.ts # Firmware collection, validation
│       │   ├── redact.ts         # Log sanitization (remove paths, temp files)
│       │   ├── catalog-provider.ts # Load catalogs from filesystem
│       │   ├── queue-runner.test.ts  # Queue loop tests
│       │   ├── collect-artifact.test.ts
│       │   └── redact.test.ts
│       ├── scripts/              # Utility scripts
│       │   └── smoke-build.ts    # Offline compilation test
│       ├── package.json
│       ├── tsconfig.json
│       └── dist/
│
├── catalogs/                      # Published keyboard catalogs (versioned, immutable)
│   └── 0.33.13-1/                # Catalog version (matches QMK tag)
│       ├── index.json            # Metadata + keyboard summaries (~1.3 MB)
│       └── keyboards/            # Sharded keyboard details (loaded on demand)
│           ├── 0000.json
│           ├── 0001.json
│           └── ... more shards
│
├── infra/
│   ├── qmk/                      # QMK tree management & build container
│   │   ├── manifest.json         # QMK pin: tag, commit, paths
│   │   ├── scripts/              # Fetch, verify, extract keyboard data
│   │   └── extract/              # Catalog extraction source
│   └── deploy/                   # Deployment infrastructure
│       ├── docker-compose.yml    # Local Postgres + config
│       └── ...
│
├── docs/
│   └── adr/                      # Architecture Decision Records
│       ├── 0001-technology-stack.md
│       ├── 0002-...
│       ├── 0003-...
│       └── 0004-the-builds-table-is-the-queue.md
│
├── var/                          # Runtime data (git-ignored)
│   └── artifacts/                # Compiled firmware & logs (shared with worker)
│       └── builds/
│
├── .planning/                    # GSD planning documents (this file)
│   └── codebase/
│
├── .claude/                      # Claude project configuration
├── .git/
├── .gitignore
├── package.json                  # Monorepo root (pnpm-workspace)
├── pnpm-lock.yaml                # Lockfile
├── pnpm-workspace.yaml           # Workspace config
├── tsconfig.base.json            # Base TypeScript config (path aliases)
├── tsconfig.json                 # Root tsconfig
├── vitest.config.ts              # Vitest config (shared across packages)
├── claude.md                      # Operating guide (precedence over README)
└── README.md                      # Project overview
```

## Directory Purposes

**`apps/api/src/`:**
- Purpose: Fastify API server implementation
- Contains: Route handlers, repository implementations, catalog loading, session middleware, error formatting
- Key files: `server.ts` (entrypoint), `app.ts` (app factory), `routes/` (HTTP handlers)

**`apps/web/src/`:**
- Purpose: Next.js frontend SPA
- Contains: Page components (keyboard picker, editor, configuration list), React UI components, client-side state management
- Key files: `app/page.tsx` (home), `app/keyboards/[...]/page.tsx` (editor), `components/KeymapEditor.tsx` (main UI)

**`packages/domain/src/`:**
- Purpose: Core business logic, schema, types, validation (zero external dependencies for maximum reuse)
- Contains: Configuration & build schemas (Zod), keycode allowlist, validation functions, error codes, product limits
- Key files: `configuration.ts` (configuration schema), `validate.ts` (semantic validation), `limits.ts` (quotas, retention)

**`packages/build-queue/src/`:**
- Purpose: Abstract build repository / queue operations
- Contains: Interface definitions, in-memory store (tests), Postgres store (production)
- Key files: `types.ts` (BuildRepository interface), `postgres-store.ts`, `memory-store.ts`

**`packages/artifact-store/src/`:**
- Purpose: Abstract artifact persistence (firmware + logs)
- Contains: Interface definitions, filesystem store, in-memory store, key generation
- Key files: `types.ts` (ArtifactStore interface), `filesystem-store.ts`, `keys.ts`

**`packages/qmk-catalog/src/`:**
- Purpose: Catalog format, normalization, type definitions
- Contains: Catalog loader, keyboard/layout/position types, normalization logic from QMK extractor
- Key files: `types.ts`, `normalize.ts`

**`packages/qmk-generator/src/`:**
- Purpose: Deterministic keymap JSON generation
- Contains: JSON generation algorithm, file writing, validation of output structure
- Key files: `generate.ts` (main function), `write-workspace.ts`

**`packages/qmk-sandbox/src/`:**
- Purpose: Hardened build isolation via Docker
- Contains: Docker image control, resource limit enforcement, artifact collection
- Key files: `docker.ts` (Docker implementation), `types.ts` (interface)

**`services/worker/src/`:**
- Purpose: Background build processing
- Contains: Queue polling loop, build execution, artifact & log collection, lease recovery
- Key files: `queue-runner.ts` (main loop), `run-build.ts` (pure build logic), `index.ts` (entrypoint)

**`catalogs/`:**
- Purpose: Immutable, versioned keyboard metadata
- Generated: Yes (via `pnpm catalog:build`)
- Committed: Yes (snapshots of specific QMK revisions)

**`infra/qmk/`:**
- Purpose: QMK tree management, manifest, build container definition
- Key files: `manifest.json` (QMK version pin), `Dockerfile` (build image)

**`infra/deploy/`:**
- Purpose: Local development & deployment infrastructure
- Key files: `docker-compose.yml` (Postgres, secrets)

**`var/artifacts/`:**
- Purpose: Compiled firmware, logs, metadata storage
- Generated: Yes (by worker)
- Committed: No (build artifacts, git-ignored)

## Key File Locations

**Entry Points:**
- `apps/api/src/server.ts` — API server startup; resolves env vars, loads catalog, connects Postgres
- `apps/web/src/app/layout.tsx` — Next.js root layout; header, nav, main outlet
- `services/worker/src/index.ts` — Worker service startup; CLI parsing, initialization

**Configuration:**
- `apps/api/package.json`, `apps/web/package.json`, `services/worker/package.json` — Package dependencies
- `tsconfig.base.json` — Path aliases (`@qmk-web-app/*`)
- `infra/qmk/manifest.json` — QMK version pin (repository source of truth)
- `.env`, `.env.local` — Environment variables (development)

**Core Logic:**
- `packages/domain/src/` — Schema, validation, type definitions
- `apps/api/src/routes/` — HTTP route handlers
- `apps/api/src/configurations/` — Configuration persistence & service logic
- `apps/api/src/builds/service.ts` — Build admission & preparation
- `services/worker/src/queue-runner.ts` — Worker loop
- `packages/qmk-generator/src/generate.ts` — Keymap generation

**Testing:**
- `packages/domain/src/*.test.ts` — Domain logic tests
- `apps/api/src/configurations/repository-contract.test.ts` — Repository interface contract
- `apps/web/src/lib/editor-state.test.ts`, `layout-geometry.test.ts` — Client-side logic
- `services/worker/src/*.test.ts` — Worker tests

**Database:**
- `apps/api/migrations/` — SQL schema files (001, 002, 003 in order)
- `apps/api/src/db/migrate.ts` — Migration runner

## Naming Conventions

**Files:**
- Types/interfaces: kebab-case (e.g., `build-repository.ts`, `artifact-store.ts`)
- Services/implementations: kebab-case with domain suffix (e.g., `postgres-repository.ts`, `memory-store.ts`)
- React components: PascalCase (e.g., `KeymapEditor.tsx`, `BuildPanel.tsx`)
- Utilities: kebab-case (e.g., `layout-geometry.ts`, `editor-state.ts`)
- Tests: `{filename}.test.ts` or `{filename}.spec.ts`

**Directories:**
- Feature directories are lowercase plural (e.g., `configurations/`, `builds/`, `routes/`)
- Page directories are lowercase singular (e.g., `keyboards/`, `configurations/`)
- Shared packages are scoped with `@qmk-web-app/` in package.json

**TypeScript:**
- Interfaces: PascalCase starting with capital letter (e.g., `BuildRepository`, `ConfigurationRecord`)
- Types: PascalCase (e.g., `BuildStatus`, `ConfigurationInput`)
- Constants: SCREAMING_SNAKE_CASE (e.g., `MAX_PAGE_SIZE`, `BUILD_LIMITS`)
- Functions: camelCase (e.g., `prepareBuild`, `validateConfiguration`)
- Classes: PascalCase (e.g., `PostgresBuildStore`, `FilesystemArtifactStore`)

## Where to Add New Code

**New Feature (e.g., "Add build cancellation API"):**
- Primary code: `apps/api/src/routes/builds.ts` (new route), `apps/api/src/builds/service.ts` (logic), `packages/build-queue/src/types.ts` (repository method)
- Tests: `apps/api/src/routes/builds.test.ts` (route contract), `apps/api/src/builds/store-contract.test.ts` (store contract if repository method changes)
- Domain changes: `packages/domain/src/build.ts` (if build state or schema changes)

**New Component/Module:**
- UI component: `apps/web/src/components/{ComponentName}.tsx` (follow existing structure)
- Page: `apps/web/src/app/{route}/page.tsx` (Next.js App Router convention)
- Backend service: `apps/api/src/{domain}/{service}.ts` (follow existing domains: configurations, builds)
- Shared library: `packages/{new-package}/src/index.ts` (barrel export)

**Utilities:**
- Client-side: `apps/web/src/lib/{utility-name}.ts` (API client, state management, layout calculations)
- Backend: `apps/api/src/{domain}/{utility-name}.ts` or `packages/{package}/src/{utility-name}.ts`
- Domain: `packages/domain/src/{concept}.ts` (types, validation, constants)

**Tests:**
- Route contract tests: `apps/api/src/routes/{route}.test.ts` (Fastify request/response)
- Repository contract tests: `packages/build-queue/src/` or `packages/artifact-store/src/` (in-memory + real implementations)
- Unit tests: co-located with implementation (e.g., `editor-state.test.ts` next to `editor-state.ts`)

**Database changes:**
- New schema: `apps/api/migrations/{NNN}_{description}.sql` (number must be higher than last)
- Migrations are run automatically on API startup (`apps/api/src/db/migrate.ts`)

## Special Directories

**`packages/qmk-fixtures/`:**
- Purpose: Test data (small real configurations, catalogs)
- Generated: No
- Committed: Yes (fixtures are version-controlled as test assets)

**`catalogs/`:**
- Purpose: Published catalogs (indexed keyboard metadata)
- Generated: Yes (via `pnpm catalog:build`)
- Committed: Yes (snapshots of catalog versions; builds pin to these)
- Note: One directory per QMK version (e.g., `catalogs/0.33.13-1/`); version matches QMK tag

**`var/artifacts/`:**
- Purpose: Build outputs (firmware, logs)
- Generated: Yes (by worker service)
- Committed: No (large binaries, transient)
- Shared: Yes (same storage as API reads for downloads)

**`.claude/`:**
- Purpose: Claude Code configuration and worktrees
- Committed: Yes (project settings)

**`.planning/codebase/`:**
- Purpose: GSD codebase mapping documents (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, STACK.md, INTEGRATIONS.md, CONCERNS.md)
- Generated: Yes (by gsd-map-codebase)
- Committed: Yes (navigation & reference)

---

*Structure analysis: 2026-08-27*
