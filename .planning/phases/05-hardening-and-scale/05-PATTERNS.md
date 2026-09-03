# Phase 5: Hardening and Scale - Pattern Map

**Mapped:** 2026-09-02
**Files analyzed:** 17 (new + modified)
**Analogs found:** 15 / 17

**Correction carried from RESEARCH.md:** D-05 in CONTEXT.md asserts `apps/web` "already carries
the [Tailwind/Radix] patterns." This is false — `apps/web/package.json` has no Tailwind/Radix
dependency, there is no `tailwind.config.*`, and `apps/web/src/app/globals.css`'s own header states
"Deliberately plain CSS for Phase 1." All frontend pattern assignments below (D-02, D-03) map
against the actual plain-CSS / server-component convention already in `apps/web`, not against any
Tailwind/Radix analog, because none exists.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/build-queue/src/postgres-store.ts` (`create()`, modified) | model/repository | CRUD (atomic insert) | same file, `create()` at lines 116-153 | exact (self-extension) |
| `packages/build-queue/src/memory-store.ts` (`create()`, modified) | model/repository | CRUD | `postgres-store.ts` `create()` (counterpart in the contract pair) | exact (contract pair) |
| `apps/api/src/builds/service.ts` (`assertWithinQuota`, removed/replaced) | service | request-response | same file, lines 112-138 | exact (self-extension) |
| `apps/api/src/builds/store-contract.test.ts` (new concurrency assertions) | test | CRUD/concurrency | same file, existing contract suite | exact (self-extension) |
| `apps/api/src/session.ts` (IP rate-limit + `SameSite`, modified) | middleware | request-response | same file, `registerSessions` lines 68-102 | exact (self-extension) |
| `apps/api/src/server.ts` (drop dev secret fallback; `trustProxy` fail-loud, modified) | config | request-response | same file, lines 34-40 (existing fail-loud guard) | exact (self-extension) |
| `apps/api/src/app.ts` (`SameSite`, `trustProxy` wiring, modified) | config | request-response | same file, `registerConfigurationRoutes` / hook registration area | role-match |
| `services/worker/scripts/run-matrix.ts` (new) | utility/script | batch (compile pipeline) | `services/worker/scripts/socd-compile-matrix.ts` (full file) + `smoke-build.ts` (full file) | exact (extraction target) |
| `services/worker/scripts/fixtures/smoke.ts` (new, data) | config/fixture data | batch | `smoke-build.ts` lines 33-60 (fixture construction) | exact |
| `services/worker/scripts/fixtures/socd.ts` (new, data) | config/fixture data | batch | `socd-compile-matrix.ts` `FIXTURES` table + guard, lines ~140-176 | exact |
| `services/worker/scripts/smoke-build.ts` (thinned to wrapper) | utility/script | batch | same file (current form) | exact (self-extension) |
| `services/worker/scripts/socd-compile-matrix.ts` (thinned to wrapper) | utility/script | batch | same file (current form) | exact (self-extension) |
| `services/worker/src/queue-runner.ts` (`maintain()`/`reap()`, modified) | service | event-driven/batch | same file, `maintain()` lines 162-194 | exact (self-extension) |
| `services/worker/src/retention-ledger.ts` (new, if table chosen) | model | CRUD | `packages/build-queue/src/postgres-store.ts` (row shape + query style) | role-match |
| `apps/api/src/observability/otel.ts` (new) | provider/bootstrap | event-driven (metrics export) | none (first OTel usage) — closest structural analog: `apps/api/src/server.ts` bootstrap sequencing | no analog |
| `services/worker/src/observability/otel.ts` (new) | provider/bootstrap | event-driven | none — closest structural analog: `services/worker/src/redact.ts` (cross-cutting module attached at emission points) | no analog |
| `apps/web` — persistent data-loss notice (D-02) | component | request-response (render) | `apps/web/src/app/configurations/page.tsx` lines 39-43 (`.provenance` notice) | exact |
| `apps/web` — export/import controls (D-03) | component | file-I/O (client) + request-response (API) | `apps/web/src/components/CreateConfigurationButton.tsx` (full file, client component pattern) | exact |
| `apps/api/src/routes/configurations.ts` (or new `routes/export-import.ts`) — import endpoint | controller/route | request-response | same file, `asInput`/`registerConfigurationRoutes` lines 65-90 | exact |
| `.github/workflows/ci-fast.yml`, `ci-matrix.yml` (new) | config (CI) | event-driven (webhook-triggered) | none in-repo (first CI) — pattern taken from RESEARCH.md Pattern 4/5 | no analog |
| `docs/licensing-review.md` (new) | doc | — | `docs/adr/000N-*.md` (doc structure/tone convention) | role-match |

## Pattern Assignments

### `packages/build-queue/src/postgres-store.ts` `create()` (model, CRUD)

**Analog:** same file, current `create()` implementation, lines 116-153.

**Imports pattern** (lines 1-30):
```typescript
import type { Pool, PoolClient } from 'pg';
import type { BuildRecord, BuildStatus, Configuration } from '@qmk-web-app/domain';
import { assertTransition, isTerminal } from '@qmk-web-app/domain';
import { toSummary } from './memory-store.ts';
import type {
  BuildQueue, BuildRepository, BuildSummary, CancelOutcome, ClaimedBuild,
  CompleteBuildArgs, CreateBuildResult, FailBuildArgs, ListPage, ReapResult,
} from './types.ts';
```

**Current insert-with-idempotency pattern to extend** (lines 116-153):
```typescript
async create(record: BuildRecord): Promise<CreateBuildResult> {
  // DO NOTHING + a second read, rather than checking first: the unique index is what
  // makes two simultaneous submissions of one idempotency key produce one build.
  const inserted = await this.#pool.query<BuildRow>(
    `INSERT INTO builds
       (id, configuration_id, configuration_revision, owner_id, catalog_version,
        qmk_commit, generator_version, build_image_ref, build_image_digest, status,
        idempotency_key, requested_at, attempt_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (owner_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [ /* ...params... */ ],
  );
  const row = inserted.rows[0];
  if (row) return { build: toRecord(row), created: true };
  const existing = await this.#pool.query<BuildRow>(
    'SELECT * FROM builds WHERE owner_id = $1 AND idempotency_key = $2',
    [record.ownerId, record.idempotencyKey],
  );
  const found = existing.rows[0];
  if (!found) throw new Error('build insert conflicted but no existing build was found');
  return { build: toRecord(found), created: false };
}
```

**What to change:** Fold the admission-control CTE (RESEARCH.md Pattern 1: `pg_advisory_xact_lock`
+ `counts` CTE + `WHERE global_active < $x AND owner_active < $y AND owner_hourly < $z`) into this
same `INSERT ... SELECT` before the `ON CONFLICT`. Keep the existing "insert returns nothing → check
existing idempotency row → check cap-rejection vs conflict" branching shape; add a third outcome
(rejected by a specific cap) that must produce the same three user-facing message strings currently
in `assertWithinQuota` (see below), reattached to this path.

**Class-level transaction helper already available** (lines 96-110):
```typescript
async #transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await this.#pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```
Use this (or the pool directly, since the advisory lock is transaction-scoped and a single
multi-CTE statement is one implicit transaction) — do not introduce a second transaction-management
pattern.

---

### `apps/api/src/builds/service.ts` `assertWithinQuota` (service, request-response) — being removed

**Analog:** same file, lines 112-138 (the code being replaced; also the source of the three
user-facing messages that must survive the refactor).

```typescript
export async function assertWithinQuota(
  repository: BuildRepository,
  ownerId: string,
): Promise<void> {
  const active = await repository.countActiveForOwner(ownerId);
  if (active >= BUILD_LIMITS.maxActiveBuildsPerOwner) {
    throw new DomainError(
      ERROR_CODES.BUILD_QUEUE_LIMITED,
      `you already have ${active} builds queued or running; wait for one to finish or cancel it`,
    );
  }
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await repository.countRequestedSince(ownerId, since);
  if (recent >= BUILD_LIMITS.maxBuildsPerOwnerPerHour) {
    throw new DomainError(
      ERROR_CODES.BUILD_QUEUE_LIMITED,
      'you have reached the hourly build limit; try again later',
    );
  }
}
```

**Instruction for planner:** delete the two-round-trip check; the caller (wherever
`assertWithinQuota` is invoked before `repository.create()`) should be simplified to just call
`create()` and interpret a cap-rejection outcome, preserving these three message strings
("you already have N…", "you have reached the hourly limit…", and a new third string for the
global cap, e.g. "the build queue is full; try again shortly").

**Error mapping already wired** — `apps/api/src/errors.ts` lines 20-29:
```typescript
const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  ...
  [ERROR_CODES.BUILD_QUEUE_LIMITED]: 429,
  ...
};
```
No new error code needed (per D-11) — reuse `BUILD_QUEUE_LIMITED`.

---

### `apps/api/src/session.ts` (middleware, request-response) — IP rate limit + `SameSite`

**Analog:** same file, full file already read (129 lines).

**Imports pattern** (lines 1-13):
```typescript
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
```

**Cookie-mint branch to attach the D-12 rate limit inside** (lines 68-102):
```typescript
app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
  const existing = verify(readCookie(request.headers.cookie, SESSION_COOKIE) ?? '', options.secret);
  if (existing) {
    request.ownerId = existing;
    return;
  }
  // No valid cookie: mint a new session. [D-12 rate-limit check belongs HERE, before
  // randomUUID() — a rejected request must never mint a session.]
  const sessionId = randomUUID();
  request.ownerId = sessionId;
  const value = `${sessionId}.${sign(sessionId, options.secret)}`;
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax', // already explicit; D-04 review confirms this stays, not inherited default
  ];
  if (options.secure) attributes.push('Secure');
  reply.header('set-cookie', attributes.join('; '));
});
```
Note: `SameSite=Lax` is already explicit in this file — D-04's "set SameSite explicitly" is
effectively already satisfied here; the planner should verify this and treat D-04's session.ts scope
as confirmation, not a new line of code, while `server.ts`'s dev-secret fallback is the real change.

**Fail-loud guard convention to mirror for `trustProxy`** — `apps/api/src/server.ts` lines 34-39:
```typescript
const sessionSecret = process.env['QWA_SESSION_SECRET'] ?? 'dev-only-insecure-session-secret-0123456789';
if (isProduction && !process.env['QWA_SESSION_SECRET']) {
  console.error('QWA_SESSION_SECRET must be set when NODE_ENV=production');
  process.exit(1);
}
```
Apply the identical `isProduction && !process.env['QWA_TRUST_PROXY_HOP']` shape for D-14, and remove
the dev-secret fallback string entirely per D-04 ("required in every environment," not just
production).

**`@fastify/rate-limit` manual-check attachment point:** RESEARCH.md Pattern 2 (`app.register(rateLimit, { global: false })`, then a manual check inside the `else` branch above) is the concrete shape — no in-repo analog exists since no rate-limit plugin is installed yet; follow RESEARCH.md's Pattern 2 code block directly and verify the exact manual-check API against the pinned `@fastify/rate-limit` version at execute time.

---

### `services/worker/scripts/run-matrix.ts` (utility/script, batch) — new extraction

**Analog:** `services/worker/scripts/socd-compile-matrix.ts` (full pipeline + registry guard) and
`services/worker/scripts/smoke-build.ts` (double-build reproducibility check), both already read in
full this session.

**Shared pipeline shape to extract** (from both files' structure):
```typescript
import { resolve } from 'node:path';
import { validateConfiguration /* or validateForMatrix */, type Catalog } from '@qmk-web-app/domain';
import { openPublishedCatalog } from '@qmk-web-app/qmk-catalog';
import { GENERATOR_VERSION } from '@qmk-web-app/qmk-generator';
import { DockerSandbox } from '@qmk-web-app/qmk-sandbox';
import { runBuild } from '../src/index.ts';
import { buildImageRef, loadManifest, qmkSourcePath } from '../../../infra/qmk/manifest.ts';

// 1. loadManifest() + openPublishedCatalog(resolve(catalogPath)) — identical in both source files
// 2. for each fixture: build a Configuration input, validate, generate, DockerSandbox, runBuild()
// 3. assert result.status === 'succeeded'
```

**Registry-fixture guard to preserve byte-for-byte** — `socd-compile-matrix.ts` lines 155-176:
```typescript
// The guard runs in the direction that keeps a registry claim honest: any keyboard
// already recorded compile-verified for this catalog version (D-02) must have a
// fixture.
const verifiedKeyboards = socdVerifiedKeyboards(published.index.catalogVersion);
const missingFixtures = [...verifiedKeyboards].filter((id) => !FIXTURES[id]);
if (missingFixtures.length > 0) {
  console.error(
    `these keyboards claim SOCD verification but have no compile fixture: ${missingFixtures.join(', ')}`,
  );
  process.exit(1);
}
```
This must survive the refactor unchanged in behavior — move it into `run-matrix.ts` as a check that
runs only for the SOCD fixture set (it is SOCD-specific, not shared with the plain smoke fixture).

**Double-build reproducibility check** — `smoke-build.ts`'s existing double-build-and-diff logic
(lines beyond 60, not yet needed verbatim since only the trigger point matters): becomes an optional
`assertDoubleReproducible` flag per fixture (RESEARCH.md Pattern 3's `MatrixFixture` interface),
attached to exactly one designated matrix entry per D-10.

**CLI usage convention to preserve** (`smoke-build.ts` lines 12, `socd-compile-matrix.ts` lines
19-20):
```
Usage: node --experimental-strip-types services/worker/scripts/<name>.ts <catalog.json>
```
Both `smoke-build.ts` and `socd-compile-matrix.ts` become thin wrappers calling `run-matrix.ts` with
their respective fixture module (`fixtures/smoke.ts`, `fixtures/socd.ts`), preserving `pnpm
socd:matrix` as a named entry point per D-07.

---

### `services/worker/src/queue-runner.ts` `maintain()` (service, event-driven/batch)

**Analog:** same file, `maintain()`, lines 162-194 (already read in full).

```typescript
async maintain(): Promise<{ requeued: number; failed: number; objectsDeleted: number }> {
  const reclaimed = await this.#options.queue.reclaimExpiredLeases({
    maxAttempts: BUILD_LIMITS.maxBuildAttempts,
  });
  // The database rows go first. If deleting a blob then fails, the result is an
  // orphaned object rather than a build row promising a download that is gone.
  const reaped = await this.#options.queue.reap({
    logRetentionMs: BUILD_LIMITS.logRetentionMs,
  });
  let objectsDeleted = 0;
  for (const key of [...reaped.artifactKeys, ...reaped.logKeys]) {
    try {
      if (await this.#options.artifacts.delete(key)) objectsDeleted += 1;
    } catch (error) {
      this.#log({ level: 'warn', message: 'failed to delete expired object', error: (error as Error).message });
    }
  }
  if (reclaimed.requeued > 0 || reclaimed.failed > 0 || objectsDeleted > 0) {
    this.#log({ level: 'info', message: 'maintenance', requeued: reclaimed.requeued, failed: reclaimed.failed, objectsDeleted });
  }
  return { ...reclaimed, objectsDeleted };
}
```

**What to add:** a durable retention record written alongside/before this existing `this.#log({...
message: 'maintenance' ...})` call — either extend this structured log event with the specific keys
deleted (`reaped.artifactKeys`, `reaped.logKeys`, timestamps) if the planner picks log-only, or write
to a new `retention-ledger.ts` table (patterned on `postgres-store.ts`'s row-mapping/query style)
inside the same loop, before the artifact delete attempt. Follow this file's existing
`this.#log({ level, message, ...fields })` structured-event shape — do not introduce a second
logging convention.

---

### `services/worker/src/redact.ts` (shared pattern, cross-cutting)

**Analog / model for "redaction on every sink":** same file, full file already read.

```typescript
const PATH_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  [/\/workspace\/userspace\/keyboards\//g, ''],
  [/\/workspace\/qmkroot\//g, ''],
  [/\/qmk\//g, ''],
];
const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/(https?:\/\/[^\s?]+)\?[^\s]*/g, '$1?[redacted]'],
  [/\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*)=\S+/gi, '$1=[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
];
export interface RedactOptions { maxBytes?: number; extraPaths?: readonly string[]; }
export const DEFAULT_MAX_LOG_BYTES = 256 * 1024;
```
Apply this same module (call its exported redact function, do not duplicate its regex tables) to
whatever the OTel exporters emit that could carry a build log excerpt or path — per
`ADR-0001-observability`, "redaction on every sink."

---

### `apps/web` — persistent data-loss notice (component, D-02)

**Analog:** `apps/web/src/app/configurations/page.tsx`, lines 39-43 (existing `.provenance` notice —
the closest thing to a persistent disclosure already shipping).

```tsx
<p className="provenance">
  Configurations are tied to this browser session — there are no accounts yet, so clearing
  cookies loses them.
</p>
```

**Existing CSS class this maps to** — `apps/web/src/app/globals.css` lines 98-107 (`.provenance`)
and lines 178+ (`.notice`, used for dismissable/error-style text — do NOT reuse `.notice` for the
non-dismissable line since `.notice` in this codebase is used for transient/error states across
`BuildPanel.tsx`, `KeymapEditor.tsx`, `MacroEditor.tsx`, `CreateConfigurationButton.tsx`,
`SocdPanel.tsx`). D-02's line is closer in spirit to `.provenance` (a permanent, factual disclosure)
already used on the configurations list page — extend that class or add a sibling class in
`globals.css` following its plain-CSS convention, and place the same text (or an editor-chrome
variant of it) into `KeymapEditor.tsx`'s existing render tree next to its current `.notice` usages
(lines 194, 210, 220).

**Do not** introduce Tailwind utility classes or a Radix `Dialog`/`Toast` primitive for this — no
such dependency exists in `apps/web/package.json`, and RESEARCH.md's Anti-Patterns section
explicitly rejects this for D-02/D-03.

---

### `apps/web` — export/import controls (component, D-03)

**Analog:** `apps/web/src/components/CreateConfigurationButton.tsx` (full file, 68 lines) — the
closest existing "client component that calls the API and reports an error inline" pattern.

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, createConfiguration } from '../lib/client.ts';

export function CreateConfigurationButton(props: CreateConfigurationButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const created = await createConfiguration({ /* ...fields... */ });
      router.push(`/configurations/${created.id}`);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'could not reach the server');
      setBusy(false);
    }
  }

  return (
    <div className="create-config">
      <button type="button" onClick={() => void start()} disabled={busy}>
        {busy ? 'Creating…' : `Edit a keymap for ${props.layoutId}`}
      </button>
      {error ? <p className="notice" role="alert">{error}</p> : null}
    </div>
  );
}
```

**Pattern to copy for export:** a plain `<a download>` or `<button>` that fetches the configuration
JSON via the existing `lib/client.ts` request helper (see `ApiRequestError`/`createConfiguration`
import convention) and triggers a browser download — no new dependency needed, plain DOM APIs
(`URL.createObjectURL` + a synthetic anchor click) fit this codebase's "no framework beyond what's
installed" convention.

**Pattern to copy for import:** an `<input type="file">` wired to the same `busy`/`error` state
shape as above, reading the file client-side (`FileReader`/`file.text()`), then POSTing the parsed
JSON through a new API call that reuses `apps/api/src/routes/configurations.ts`'s existing
`asInput`/validation path (see below) — never construct a `ConfigurationRecord` client-side and
never accept `id`/`ownerId`/`revision`/`schemaVersion` from the uploaded file.

**API-side import endpoint — analog:** `apps/api/src/routes/configurations.ts`, `asInput()`
(lines 65-81):
```typescript
function asInput(body: unknown): ConfigurationInput {
  if (typeof body !== 'object' || body === null) {
    throw new DomainError(ERROR_CODES.CONFIG_INVALID, 'request body must be an object');
  }
  const b = body as Record<string, unknown>;
  // Only these fields are read. Anything else the client sends — `ownerId`,
  // `revision`, `id` — is ignored rather than merged.
  return {
    name: b['name'] as string,
    catalogVersion: b['catalogVersion'] as string,
    qmkCommit: b['qmkCommit'] as string,
    keyboardId: b['keyboardId'] as string,
    layoutId: b['layoutId'] as string,
    layers: b['layers'],
    macros: b['macros'] ?? [],
    socd: b['socd'] ?? null,
  };
}
```
D-03's import handler is this same `asInput` shape applied to an uploaded document, then passed
through `createRecord` (imported from `../configurations/service.ts` in the same file) exactly as
the existing create-configuration route does — this is explicitly the "no new trust boundary" reuse
CONTEXT.md/RESEARCH.md require. The `projectRecord()` function (lines 45-63) in the same file is the
analog for export's response shape — it already excludes `ownerId` and is the field set to
JSON-serialize for a download.

---

## Shared Patterns

### Fail-loud production configuration guard
**Source:** `apps/api/src/server.ts` lines 34-39
**Apply to:** `server.ts` (D-04 secret requirement), `app.ts`/`server.ts` (D-14 `trustProxy`
requirement)
```typescript
if (isProduction && !process.env['QWA_SESSION_SECRET']) {
  console.error('QWA_SESSION_SECRET must be set when NODE_ENV=production');
  process.exit(1);
}
```

### SQL-expressed atomicity, not application-level checks
**Source:** `packages/build-queue/src/postgres-store.ts` `create()`, ON CONFLICT idempotency
**Apply to:** the D-11/D-13 admission-control insert; the same file's module comment (lines 1-15)
already states the principle: "`create()` relies on the unique index for idempotency rather than a
read-then-write, which would race."

### Structured JSON log event shape
**Source:** `services/worker/src/queue-runner.ts` `this.#log({ level, message, ...fields })` calls
(e.g. `maintain()` line ~186)
**Apply to:** worker-side telemetry/liveness signals and the retention deletion record, so a new
sink does not introduce a second logging convention.

### Redaction before any sink
**Source:** `services/worker/src/redact.ts`
**Apply to:** whatever OTel exporters or new log destinations carry build-log content or paths.

### `.provenance` / `.notice` CSS class convention (plain CSS, no framework)
**Source:** `apps/web/src/app/globals.css` lines 98-107 and 178+; usage sites in
`apps/web/src/app/configurations/page.tsx`, `KeymapEditor.tsx`, `BuildPanel.tsx`,
`CreateConfigurationButton.tsx`
**Apply to:** D-02's persistent notice (extend `.provenance`, not `.notice`) and any inline error
state on D-03's import control (`.notice`, matching existing usage).

### Client-component API-call error handling
**Source:** `apps/web/src/components/CreateConfigurationButton.tsx` (`busy`/`error` state,
`ApiRequestError` catch)
**Apply to:** D-03's export/import buttons.

### Server-side validation reuse — no new trust boundary
**Source:** `apps/api/src/routes/configurations.ts` `asInput()` + `createRecord()`
**Apply to:** D-03's import endpoint — must go through `validateConfiguration` exactly as every
other write does.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/api/src/observability/otel.ts` | provider/bootstrap | event-driven | No OpenTelemetry package or bootstrap module exists yet anywhere in the repo; follow RESEARCH.md § Architecture Patterns (System Diagram, telemetry annotations) and § Standard Stack installation block instead of an in-repo analog. |
| `services/worker/src/observability/otel.ts` | provider/bootstrap | event-driven | Same as above — mirror the API-side bootstrap once written, so both processes share one shape. |
| `.github/workflows/ci-fast.yml`, `ci-matrix.yml` | config (CI) | event-driven | This is the repository's first CI (`.github/workflows/` does not exist). Follow RESEARCH.md Patterns 4 and 5 (path-filtered required check; fork-PR job-level guard) verbatim — both are cited from external GitHub documentation/community discussions, not an in-repo precedent. |
| `apps/api` dependency/image scanning CI job | config (CI) | batch | No scanning tooling installed yet; follow RESEARCH.md § Standard Stack (Trivy/Grype/`npm audit`) and § Don't Hand-Roll. |
| `docs/licensing-review.md` | doc | — | Partial analog only — `docs/adr/*.md` gives document tone/structure conventions (numbered header, rationale-first prose) but no ADR covers licensing; the planner should follow ADR prose conventions without treating this as an ADR itself. |

## Metadata

**Analog search scope:** `apps/api/src` (builds, session, server, app, routes, configurations,
errors), `packages/build-queue/src`, `packages/domain/src/limits.ts`, `services/worker/src`
(queue-runner, redact), `services/worker/scripts` (smoke-build.ts, socd-compile-matrix.ts full
reads), `apps/web/src` (components, app/configurations/page.tsx, globals.css), `docs/adr/`.
**Files scanned:** ~20 read directly (several in full), plus targeted greps across
`apps/web/src/components`, `apps/web/src/app`, and `apps/api/src/routes`.
**Pattern extraction date:** 2026-09-02
