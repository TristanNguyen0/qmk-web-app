---
phase: 05-hardening-and-scale
reviewed: 2026-09-03T23:52:48Z
depth: standard
files_reviewed: 67
files_reviewed_list:
  - .github/workflows/ci-fast.yml
  - .github/workflows/ci-matrix.yml
  - apps/api/package.json
  - apps/api/src/app.ts
  - apps/api/src/builds/service.ts
  - apps/api/src/builds/store-contract.test.ts
  - apps/api/src/config.test.ts
  - apps/api/src/config.ts
  - apps/api/src/errors.ts
  - apps/api/src/observability/attributes.test.ts
  - apps/api/src/observability/attributes.ts
  - apps/api/src/observability/metrics.test.ts
  - apps/api/src/observability/metrics.ts
  - apps/api/src/observability/otel.test.ts
  - apps/api/src/observability/otel.ts
  - apps/api/src/routes/builds.test.ts
  - apps/api/src/routes/builds.ts
  - apps/api/src/server.ts
  - apps/api/src/session.test.ts
  - apps/api/src/session.ts
  - apps/web/src/app/configurations/page.tsx
  - apps/web/src/app/globals.css
  - apps/web/src/components/DataLossNotice.tsx
  - apps/web/src/components/ExportConfigurationButton.tsx
  - apps/web/src/components/ImportConfigurationButton.tsx
  - apps/web/src/components/KeymapEditor.tsx
  - apps/web/src/lib/notices.test.ts
  - apps/web/src/lib/notices.ts
  - docs/deployment-requirements.md
  - docs/matrix-selection.md
  - docs/runbooks/backup-restore.md
  - docs/runbooks/ci-runner.md
  - docs/runbooks/observability.md
  - infra/deploy/backup.sh
  - infra/deploy/restore-drill.sh
  - package.json
  - packages/artifact-store/src/index.ts
  - packages/artifact-store/src/keys.ts
  - packages/artifact-store/src/store.test.ts
  - packages/build-queue/src/index.ts
  - packages/build-queue/src/memory-store.ts
  - packages/build-queue/src/postgres-store.ts
  - packages/build-queue/src/types.ts
  - packages/domain/src/configuration-file.test.ts
  - packages/domain/src/configuration-file.ts
  - packages/domain/src/index.ts
  - packages/domain/src/limits.ts
  - pnpm-workspace.yaml
  - services/worker/package.json
  - services/worker/scripts/fixtures/smoke.ts
  - services/worker/scripts/fixtures/socd.ts
  - services/worker/scripts/run-matrix.ts
  - services/worker/scripts/smoke-build.ts
  - services/worker/scripts/socd-compile-matrix.ts
  - services/worker/src/main.ts
  - services/worker/src/matrix-fixtures.test.ts
  - services/worker/src/matrix-fixtures.ts
  - services/worker/src/observability/attributes.test.ts
  - services/worker/src/observability/attributes.ts
  - services/worker/src/observability/metrics.ts
  - services/worker/src/observability/otel.test.ts
  - services/worker/src/observability/otel.ts
  - services/worker/src/queue-runner.test.ts
  - services/worker/src/queue-runner.ts
  - services/worker/src/redact.test.ts
  - services/worker/src/redact.ts
  - vitest.config.ts
findings:
  critical: 2
  warning: 4
  info: 0
  total: 6
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-09-03T23:52:48Z
**Depth:** standard
**Files Reviewed:** 67
**Status:** issues_found

## Summary

The concurrency-critical path (`PostgresBuildStore.create()`'s advisory-lock admission
transaction, and `InMemoryBuildStore`'s single-threaded mirror of the same three-cap
decision) is sound: the lock scope, the ordering of idempotency-check-before-cap-check,
the re-derivation of counts inside the `INSERT ... WHERE` predicate, and the contract
test's real concurrent-racer scenarios all line up with what the code actually does. The
state machine, lease-guarded writes, and retention sweep are equally solid. CI workflow
security (permissions scoping, fork-PR handling in both `ci-fast.yml` and
`ci-matrix.yml`, the always-report `matrix-result` aggregator) is correctly built and
matches its own documentation in `docs/runbooks/ci-runner.md`.

Two BLOCKER findings came out of the areas this review was asked to weight highest,
and both were verified empirically against the actual code, not inferred from reading
alone:

1. **The stated "no client IP anywhere" invariant is violated in production.**
   `apps/api/src/server.ts` starts Fastify with `logger: true` and no
   `disableRequestLogging` or custom `req` serializer. Fastify's own default
   `logger-pino.js` request serializer includes `remoteAddress: req.ip`, and
   `disableRequestLogging` defaults to `false`, so **every single request logs the
   client's IP address** to stdout — exactly the log-sink surface
   `docs/deployment-requirements.md` says a deployment must attach a durable sink to.
   `session.ts`, `redact.ts`, and both `observability/attributes.ts` files are all
   clean on this point; the leak is entirely in `server.ts`'s Fastify construction, and
   it is untested because `buildApp()`'s tests all run with the default `logger: false`.

2. **A malformed percent-encoded `Cookie` header crashes the session `onRequest` hook**
   (`apps/api/src/session.ts`'s `readCookie()`, via an uncaught `decodeURIComponent`
   `URIError`), turning every route — including `/health` — into a 500 for that
   request, instead of the documented "a tampered or expired cookie reaches this branch
   exactly like no cookie at all." This is trivially triggered (`Cookie: qwa_session=%`)
   and is not covered by the existing "tampered cookie" test, which only exercises a
   syntactically-valid-but-wrong-MAC cookie.

Four WARNING-level findings are quality/robustness gaps: a UTF-8-unsafe log truncation
boundary, a permissions race window in `backup.sh`, and duplicated/hardcoded
active-status SQL literals in `postgres-store.ts` that could silently drift from the
`ACTIVE_STATUSES` constant the rest of the file uses.

## Critical Issues

### CR-01: Production request logging emits the client's IP address on every request

**File:** `apps/api/src/server.ts:134` (and `apps/api/src/app.ts:43-50`, which passes
`logger` straight into `Fastify(...)` unmodified)
**Issue:** `server.ts` starts the app with `logger: true` and nothing else — no
`disableRequestLogging`, no custom `serializers.req`. Fastify's `disableRequestLogging`
option defaults to `false` (`node_modules/.../fastify/lib/log-controller.js`), so every
request triggers `request.log.info({ req: request }, 'incoming request')`
(`log-controller.js`'s `incomingRequest()`), and Fastify's own default `req` serializer
(`node_modules/.../fastify/lib/logger-pino.js:53`) is:

```js
const serializers = {
  req: function asReqValue (req) {
    return {
      method: req.method,
      url: req.url,
      ...
      remoteAddress: req.ip,
      remotePort: req.socket ? req.socket.remotePort : undefined
    }
  },
  ...
}
```

Verified empirically against the installed `fastify@5.11.2` and this repo's own
`buildApp()`:

```
$ node --experimental-strip-types test-cookie2.mjs   # Fastify({ logger: true }), GET /health
{"level":30, ... ,"req":{"method":"GET","url":"/health", ... ,"remoteAddress":"203.0.113.99"}, ...,"msg":"incoming request"}
```

Every request — anonymous session mint, build submission, artifact download — writes
the caller's IP address to the process's stdout, which `docs/deployment-requirements.md`
§ "A log sink, and its retention window" explicitly says a deployment attaches a durable
sink to (`journald`, a log-shipping agent, a cloud logging service). This is the exact
sink the review's stated invariant says must never see a client IP: "not on a build or
configuration row, not in an application log line, not as a telemetry attribute." The
telemetry side (`observability/attributes.ts` in both processes, `redact.ts`) is clean —
this is purely the raw Fastify request logger, which none of that redaction machinery
touches. It is untested because `apps/api/src/app.ts`'s `buildApp()` defaults `logger` to
`false`, and every test in `session.test.ts`/`builds.test.ts`/etc. either omits `logger`
or never inspects log output — so nothing in the suite exercises the exact configuration
`server.ts` ships with.
**Fix:** Suppress or scrub `remoteAddress` from the request logger in `server.ts`, e.g.:

```ts
const app = buildApp({
  ...
  logger: {
    serializers: {
      req(req) {
        return { method: req.method, url: req.url }; // no remoteAddress
      },
    },
  },
});
```

(`app.ts`'s `BuildAppOptions.logger` would need widening from `boolean` to accept a
Fastify logger options object.) Add a regression test that starts `buildApp` with the
production logger configuration and asserts no captured log line contains a probe IP —
mirroring `session.test.ts`'s existing "does not leak the requesting address in a
refusal response" test, but pointed at the logger instead of the response body.

### CR-02: A malformed percent-encoded session cookie crashes every route with a 500

**File:** `apps/api/src/session.ts:63-72` (`readCookie`), reached from the
`onRequest` hook at `session.ts:141-142`
**Issue:** `readCookie()` calls `decodeURIComponent(part.slice(eq + 1).trim())`
unconditionally on the matched cookie's raw value. `decodeURIComponent` throws a
`URIError` on malformed percent-encoding (e.g. a lone `%`), and nothing in
`registerSessions`'s `onRequest` hook catches it. Verified against the real `buildApp()`:

```
$ node --experimental-strip-types test-cookie2.mjs
# GET /health, headers: { cookie: 'qwa_session=%' }
status: 500
body: {"apiVersion":1,"error":{"code":"INTERNAL_ERROR","message":"internal error"}}
```

This contradicts the module's own stated design (`session.ts:148-150`): "A tampered or
expired cookie reaches this branch exactly like no cookie at all — minting is what
actually happens here." A malformed-encoding cookie never reaches that branch at all; it
throws inside `readCookie()`, before `verify()` or the issuance-rate-limit check ever
run — so it also silently skips the "every no-session request consumes an issuance
slot" invariant the module documents elsewhere. `/health` — the one route D-12's own
comment says must stay reachable "from an address that is over its issuance limit" — is
taken down by this for any request carrying the malformed cookie, which is the opposite
of that route's purpose. `session.test.ts`'s "a tampered cookie" test
(`'qwa_session=not-a-real-session.bad-mac'`) never exercises this path because that
string contains no `%`, so it decodes cleanly and only exercises the MAC-mismatch branch
inside `verify()`.
**Fix:** Treat a `decodeURIComponent` failure the same as "no cookie":

```ts
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
```

Add a test asserting `GET /health` (and a session-required path) with
`cookie: 'qwa_session=%'` behaves exactly like the existing "tampered cookie" test —
200/429 per the issuance limit, never a 500.

## Warnings

### WR-01: Byte-cap log truncation can split a UTF-8 character, corrupting the kept tail

**File:** `services/worker/src/redact.ts:69-79` (`redactLog`)
**Issue:** `redactLog` truncates via `buffer.subarray(buffer.byteLength - maxBytes)`
then `.toString('utf8')`. If the cut point lands inside a multi-byte UTF-8 sequence (a
compiler diagnostic quoting a non-ASCII character, or emitted through a locale that
isn't plain ASCII), `Buffer#toString('utf8')` silently replaces the truncated bytes with
U+FFFD rather than realigning to a character boundary — the "important part" the
comment at line 76 says this exists to keep can come out with a corrupted first line.
Low likelihood given QMK's build output is normally ASCII, but nothing prevents a
keymap/macro name or a toolchain message from containing non-ASCII text, and the
existing test (`redact.test.ts`'s "caps the log and keeps the tail") only exercises
ASCII input, so this gap is untested.
**Fix:** Re-align the cut point to the nearest UTF-8 character boundary before decoding,
e.g. trim leading continuation bytes (`0x80–0xBF`) from `kept` before `toString`, or cut
on a line boundary near `maxBytes` instead of an exact byte offset.

### WR-02: Backup dump files are briefly world/group-readable before `chmod 600`

**File:** `infra/deploy/backup.sh:110-120`
**Issue:** `run_pg_dump ... >"${DB_DUMP}"` and `run_pg_dumpall ... >"${GLOBALS_DUMP}"`
create the two dump files (redirection creates them at the process's default
umask-derived permissions) *before* the subsequent `chmod 600 "${DB_DUMP}"
"${GLOBALS_DUMP}"` on line 120 restricts them. `OUT_DIR` itself is correctly
`chmod 700`'d before anything is written into it (line 103), which limits exposure to
users who can already traverse into that directory tree — but on a host with a
permissive umask (e.g. `022`) and a shared group, the dump — which the script's own
header says "contains every session's configurations" — is readable by that group for
the duration of the (potentially large) `pg_dump`/`pg_dumpall` run, not just an instant.
**Fix:** Either `umask 077` near the top of the script (simplest — applies to every file
the script creates for the rest of its run), or pre-create the two files with restrictive
permissions (`install -m 600 /dev/null "${DB_DUMP}"`) before the dump commands write to
them.

### WR-03: `PostgresBuildStore`'s active-status list is hardcoded in two places instead of reusing `ACTIVE_STATUSES`

**File:** `packages/build-queue/src/postgres-store.ts:358-373` (`countActiveForOwner`,
`countActiveGlobal`)
**Issue:** The file defines `ACTIVE_STATUSES = ['queued', 'preparing', 'building',
'uploading']` at the top (line 36) and correctly binds it as a parameter in `create()`'s
admission query (`$16`/`$2` in the two `SELECT` statements at lines 150-156 and
184-188). `countActiveForOwner` and `countActiveGlobal`, however, spell the same four
statuses out as a SQL string literal — `status IN ('queued','preparing','building',
'uploading')` — independently, twice. Today the three copies agree, and the shared
contract test (`store-contract.test.ts`) exercises all three call sites, so this is not
presently a live bug — but it is three places that must be edited in lockstep by hand
if a status is ever added to or removed from the in-flight set, with nothing (compiler
or lint rule) enforcing that they stay in sync, unlike the `InMemoryBuildStore`
counterpart, which derives the same set from `!isTerminal(status)` in one place.
**Fix:** Parameterize the two queries the same way `create()` already does:

```ts
async countActiveForOwner(ownerId: string): Promise<number> {
  const result = await this.#pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM builds
      WHERE owner_id = $1 AND status = ANY($2::text[])`,
    [ownerId, ACTIVE_STATUSES],
  );
  return Number(result.rows[0]?.count ?? '0');
}
```

and similarly for `countActiveGlobal`.

### WR-04: Fragile `sed`-based `QWA_DATABASE_URL` parsing in `backup.sh`/`restore-drill.sh`

**File:** `infra/deploy/backup.sh:47-56`, `infra/deploy/restore-drill.sh:39-45`
**Issue:** Both scripts extract user/password/host/port/dbname from
`QWA_DATABASE_URL` with a chain of `sed -E` regexes keyed on literal `:`/`@`/`/`
delimiters. A password containing `@` or `:` (both legal in a URL-encoded
`postgres://` connection string) breaks the `DB_HOST`/`DB_PORT` extraction — the
`[^@]+@` pattern used to find the host greedily matches through to the *last* `@`, but
the earlier `DB_PASSWORD` capture (`[^@]+`) stops at the *first* `@`, so a password
containing `@` desyncs the two captures from each other. Low likelihood in the
documented dev-default case (`qwa_dev_password`, no special characters), but this script
is explicitly the one artifact this phase ships for production backup/restore
operations, where an operator is more likely to set a stronger, URL-encoded password.
**Fix:** Either document that `QWA_DATABASE_URL`'s password must not contain `@`/`:`, or
parse with `node -e` (already a hard dependency of this monorepo) using the built-in
`URL` class instead of a hand-rolled `sed` chain.

---

_Reviewed: 2026-09-03T23:52:48Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
