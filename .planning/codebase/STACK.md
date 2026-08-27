# Technology Stack

**Analysis Date:** 2026-08-27

## Languages

**Primary:**
- TypeScript 5.9.3 - All source code; strict compilation mode with full type checking
- JavaScript (Node.js runtime execution) - Used via `--experimental-strip-types` for zero-build workflow

**Secondary:**
- SQL - PostgreSQL migrations in `apps/api/migrations/`
- Python - QMK build infrastructure in `infra/qmk/extract/extract_catalog.py`
- Bash - Container entrypoint and deployment scripts in `infra/qmk/scripts/`

## Runtime

**Environment:**
- Node.js >= 22 - Required minimum version in `package.json` engines
- Docker - Build isolation and deployment containers
- PostgreSQL 16 - Database backend

**Package Manager:**
- pnpm 11.20.0 - Monorepo package manager (pinned in `package.json`)
- Lockfile: `pnpm-lock.yaml` (lockfileVersion: 9.0)

## Frameworks

**Core:**
- Next.js 16.3.0 - Frontend framework; deployed via `apps/web/` with React 19
- React 19.2.8 - UI component library with hooks
- Fastify 5.11.2 - Backend HTTP server in `apps/api/`

**Testing:**
- Vitest 2.1.9 - Test runner; configured in `vitest.config.ts`
- Vitest assertion library - Default expectations

**Build/Dev:**
- TypeScript compiler (tsc) - No build step; type checking only with `--noEmit`
- Node.js `--experimental-strip-types` - Load TypeScript directly without compilation
- Next.js build system - Handled by `next build` and `next start`

## Key Dependencies

**Critical:**
- pg 8.22.0 - PostgreSQL client library; used in `apps/api/`, `packages/build-queue/`, `services/worker/`
- zod 3.25.76 - Schema validation in `packages/domain/`
- Fastify routing plugins - Implicit via Fastify 5.11.2

**Infrastructure:**
- @types/node 22.20.1 - Node.js TypeScript definitions
- @types/react 19.2.18 - React TypeScript definitions
- @types/react-dom 19.2.4 - React DOM TypeScript definitions
- @types/pg 8.21.0 - PostgreSQL client TypeScript definitions

## Configuration

**Environment:**
- TypeScript strict mode - Configured in `tsconfig.base.json`:
  - `strict: true`
  - `noUncheckedIndexedAccess: true`
  - `exactOptionalPropertyTypes: true`
  - `noImplicitOverride: true`
  - `noFallthroughCasesInSwitch: true`
  - `noUnusedLocals: true`
  - `noUnusedParameters: true`
  - `verbatimModuleSyntax: true`
  - `isolatedModules: true`

**Build:**
- No build artifacts - Packages export `.ts` source directly via workspace exports
- Test configuration: `vitest.config.ts` - Includes test patterns and timeout settings
- Base TypeScript config: `tsconfig.base.json` - ES2023 target, NodeNext module resolution

**Key Environment Variables:**
- `QWA_DATABASE_URL` - PostgreSQL connection string (default: `postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa`)
- `QWA_SESSION_SECRET` - HMAC session signing key (required in production, dev default provided)
- `QWA_CATALOG_DIR` - Published keyboard catalogs directory (default: `<repo>/catalogs`)
- `QWA_ARTIFACT_DIR` - Build output artifacts directory (default: `<repo>/var/artifacts`)
- `QWA_WORKSPACE_ROOT` - Worker build workspace (default: OS temp directory)
- `QWA_WORKER_ID` - Worker identifier (default: auto-generated from hostname + UUID)
- `NODE_ENV` - Controls production security settings and initialization
- `PORT` - API server port (default: 3001 for API, 3000 for web)

## Platform Requirements

**Development:**
- Node.js >= 22
- pnpm >= 11.20.0
- Docker Engine (for build sandbox)
- PostgreSQL 16 (via Docker Compose)
- ~5 GB disk for QMK source checkout and compiled catalogs
- UNIX-like system (Linux/macOS)

**Production:**
- Node.js >= 22
- PostgreSQL 16+ with `postgres` and `qwa` roles (API uses main role, worker uses restricted `qwa_worker` role)
- Shared artifact storage between API and worker processes (filesystem or S3-compatible)
- Docker for build isolation (QMK build image pinned by digest)
- HTTPS reverse proxy with cookie propagation

## Monorepo Structure

**Root package:** `package.json`
- Workspaces: `apps/`, `packages/`, `services/`
- All packages are private and internal

**Applications:**
- `apps/web/` - Next.js frontend (port 3000)
- `apps/api/` - Fastify backend (port 3001)

**Internal Packages (workspace:* imports):**
- `packages/domain/` - Core types and validation schemas
- `packages/build-queue/` - Build queue PostgreSQL store
- `packages/artifact-store/` - Artifact storage abstraction
- `packages/qmk-catalog/` - Keyboard catalog loading
- `packages/qmk-generator/` - QMK keymap code generation
- `packages/qmk-sandbox/` - Docker-based build environment
- `packages/qmk-fixtures/` - Test data and fixtures

**Services:**
- `services/worker/` - Background build queue processor

## Build Isolation

- QMK builds run in Docker containers with a pinned base image (digest: `b7d7fa8fb4432b569931de5ad59098cb788f440ed61a62c5126746b71aee0f4a`)
- Unprivileged builder user (UID 2000, GID 2000) inside container
- QMK source mounted read-only at `/qmk`
- Build workspaces are ephemeral per build request

---

*Stack analysis: 2026-08-27*
