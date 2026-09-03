---
phase: 05-hardening-and-scale
plan: 05
subsystem: auth
tags: [fastify, session, rate-limit, fastify-rate-limit, trust-proxy, cookie]

# Dependency graph
requires:
  - phase: 05-hardening-and-scale
    provides: "05-01's race-free multi-predicate build admission (packages/domain/src/limits.ts, apps/api/src/builds/service.ts) — this plan composes with it, not replaces it"
provides:
  - "IP-bounded session-issuance minting: SESSION_LIMITS.issuancePerIpPerHour, enforced only in the mint branch of the session onRequest hook"
  - "requireEnv()/parseTrustProxy() pure start-up guards (apps/api/src/config.ts), removing the hardcoded dev session-secret fallback everywhere"
  - "QWA_TRUST_PROXY environment variable, fatal in production when unset, 'trust nothing' in development"
  - "RATE_LIMITED transport-level error code + sendRateLimited() (429 + retry-after)"
  - "A refusal scoped to session-requiring paths (/v1/configurations, /v1/builds); health and the read-only catalog stay reachable via a throwaway, uncookied owner id"
  - "The owner-id invariant test: request.ownerId is assigned in exactly one file, apps/api/src/session.ts"
affects: [05-07 (OTel/observability — will read from the same session/app.ts wiring), 05-08 (deployment consolidation — QWA_TRUST_PROXY documentation), any future phase touching apps/api/src/session.ts or the identity source]

# Actuals (#2632)
actuals:
  tokens: 9187
  tasks: 3
  commits: 6

# Tech tracking
tech-stack:
  added: ["@fastify/rate-limit@^11.2.0"]
  patterns:
    - "Pure start-up guards (requireEnv/parseTrustProxy) over an injected environment object, so fatal-at-boot checks are unit-testable instead of top-level process.env statements"
    - "Fastify manual rate-limit check (app.createRateLimit, called once via app.after()) scoped to one branch of an existing hook, not global middleware"
    - "Transport-level error codes (RATE_LIMITED) live in ApiErrorBody's code union, separate from the domain ErrorCode enum"

key-files:
  created:
    - apps/api/src/config.ts
    - apps/api/src/config.test.ts
    - apps/api/src/session.test.ts
  modified:
    - apps/api/src/server.ts
    - apps/api/src/app.ts
    - apps/api/src/session.ts
    - apps/api/src/errors.ts
    - packages/domain/src/limits.ts
    - apps/api/package.json

key-decisions:
  - "requireEnv/parseTrustProxy take an injected environment object rather than reading process.env directly, so server.ts's start-up guards are unit-testable — the equivalent logic was previously top-level statements only a spawned process could exercise"
  - "app.createRateLimit() is called exactly once via app.after(), not per-request: fastify-rate-limit@11's manual-check seam spawns a fresh, empty child counter store on every call (verified by reading the installed package's LocalStore.child), so calling it inside the onRequest hook body would silently reset the count on every request"
  - "RATE_LIMITED joins ApiErrorBody's transport-level code union rather than extending the domain ErrorCode enum, per the plan's planner_notes — a session-issuance refusal is not a BUILD_QUEUE_LIMITED condition and claude.md fixes the domain enum"
  - "A refused mint to a non-session-required path (health, catalog) gets a throwaway, uncookied owner id rather than a refusal — the only way to keep request.ownerId typed as always-present without turning a busy NAT into a dead site"

patterns-established:
  - "Session-issuance rate limiting: manual @fastify/rate-limit check invoked only inside the mint branch of the existing cookie-verification hook, never as global middleware"
  - "Path-prefix-scoped refusal: a list of prefixes distinguishes 'needs an identity' from 'does not', with the default drawn from the route groups whose every handler reads request.ownerId"

requirements-completed: [REQ-hardening-abuse-controls]

coverage:
  - id: D1
    description: "QWA_SESSION_SECRET is required in every environment with no fallback; start-up fails loudly with an actionable message when absent"
    requirement: "REQ-hardening-abuse-controls"
    verification:
      - kind: unit
        ref: "apps/api/src/config.test.ts#requireEnv"
        status: pass
      - kind: manual_procedural
        ref: "node --experimental-strip-types apps/api/src/server.ts with QWA_SESSION_SECRET unset — exits 1, prints variable name + generation command"
        status: pass
    human_judgment: false
  - id: D2
    description: "trustProxy is configured to a specific hop; QWA_TRUST_PROXY is required in production and rejects every boolean-ish spelling including true"
    requirement: "REQ-hardening-abuse-controls"
    verification:
      - kind: unit
        ref: "apps/api/src/config.test.ts#parseTrustProxy"
        status: pass
      - kind: manual_procedural
        ref: "node --experimental-strip-types apps/api/src/server.ts with NODE_ENV=production and QWA_TRUST_PROXY unset — exits 1, prints QWA_TRUST_PROXY"
        status: pass
    human_judgment: false
  - id: D3
    description: "Session cookie attributes (HttpOnly, SameSite=Lax, Path=/, one-year Max-Age, conditional Secure) are pinned by test"
    verification:
      - kind: unit
        ref: "apps/api/src/session.test.ts#session cookie attributes"
        status: pass
    human_judgment: false
  - id: D4
    description: "Session-issuance minting is IP-bounded at SESSION_LIMITS.issuancePerIpPerHour; a returning visitor with a valid cookie is never rate-limited; a different address is unaffected; a tampered cookie still consumes a slot; no refusal leaks the requesting IP"
    requirement: "REQ-hardening-abuse-controls"
    verification:
      - kind: unit
        ref: "apps/api/src/session.test.ts#session-issuance IP rate limit (D-12)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A refusal never blocks health or the read-only catalog; it refuses only paths that genuinely need an identity (configuration/build reads and writes); a request served without a session never reaches a handler with an undefined ownerId"
    requirement: "REQ-hardening-abuse-controls"
    verification:
      - kind: unit
        ref: "apps/api/src/session.test.ts#a refusal scopes to session-requiring paths (D-12 vs. D-14 non-lockout)"
        status: pass
    human_judgment: false
  - id: D6
    description: "request.ownerId is assigned in exactly one file in apps/api/src (session.ts), confirmed by scanning real source files and by deliberately adding a second assignment to prove the test catches drift"
    requirement: "REQ-hardening-abuse-controls"
    verification:
      - kind: unit
        ref: "apps/api/src/session.test.ts#owner-id invariant (05-03 assumption_delta_decision)"
        status: pass
    human_judgment: false

duration: 8min (commit span; full session including research was longer)
completed: 2026-09-03
status: complete
---

# Phase 05 Plan 05: Session Hardening (D-04/D-12/D-14) Summary

**IP-bounded session issuance via `@fastify/rate-limit`'s manual-check seam, a required session secret with no environment fallback, an explicit `trustProxy` configuration that rejects every boolean spelling, and a refusal scoped so health/catalog stay reachable while configuration/build paths are genuinely refused.**

## Performance

- **Duration:** ~8 min commit span (research, code reading, and verification extended the full session further)
- **Started:** 2026-09-03T11:22:00-04:00 (first commit)
- **Completed:** 2026-09-03T11:29:37-04:00 (last commit)
- **Tasks:** 3
- **Files modified:** 8 (3 created, 5 modified) + lockfile

## Accomplishments

- Removed the hardcoded development session-secret fallback in `server.ts` entirely — `QWA_SESSION_SECRET` is now required in every environment, with a start-up failure that names the variable and a command to generate one (D-04).
- Added `apps/api/src/config.ts` (`requireEnv`, `parseTrustProxy`) as pure, unit-testable functions over an injected environment object, replacing top-level `process.env` statements that only a spawned process could exercise.
- `parseTrustProxy` accepts a specific IP/CIDR/list and rejects every boolean-ish spelling (`true`, `1`, `yes`, …) with a message explaining the spoofing risk; production start-up fails loudly when `QWA_TRUST_PROXY` is unset (D-14).
- Registered `@fastify/rate-limit@^11.2.0` with global application disabled and invoked its manual-check seam (`app.createRateLimit`, verified against the installed 11.2.0 API — not copied from the research doc's assumed shape) only inside the session-mint branch, keyed on `request.ip` (D-12).
- `SESSION_LIMITS.issuancePerIpPerHour = 120` (rolling hour) added to `packages/domain/src/limits.ts`, with the NAT-generosity rationale and the in-process-counter limitation documented next to the constant.
- A refusal is scoped by path: `/v1/configurations` and `/v1/builds` (every handler reads `request.ownerId`) answer 429 `RATE_LIMITED`; every other path (health, the read-only catalog) is served under a throwaway, uncookied owner id so a busy NAT is never turned into a dead site (D-12's non-lockout guarantee).
- Added the owner-id invariant test: scans real files under `apps/api/src` and asserts `request.ownerId` is assigned in exactly one file (`session.ts`) — implements the suggestion from 05-03's `assumption_delta_decision`. Deliberately broke it during verification (added a second assignment in `routes/configurations.ts`), confirmed it failed, then reverted.

## Task Commits

Each task followed RED → GREEN (`tdd="true"`):

1. **Task 1: Require the session secret, and configure the trusted proxy hop explicitly**
   - `211d2fb` test(05-05): add failing tests for start-up config guards and session cookie attributes
   - `5f35966` feat(05-05): require the session secret and configure the trusted proxy hop explicitly
2. **Task 2: Rate-limit session issuance by IP, and only session issuance**
   - `38514a1` test(05-05): add failing tests for session-issuance IP rate limit
   - `331fabd` feat(05-05): rate-limit session issuance by IP, and only session issuance
3. **Task 3: A refusal must not black out the site, and owner ids come from one place**
   - `1a6a342` test(05-05): add failing tests for the session-refusal path scope and owner-id invariant
   - `aa0c7b9` feat(05-05): scope a session-issuance refusal to paths that actually need an identity

**Plan metadata:** committed separately by this same commit sequence (worktree mode — orchestrator commits SUMMARY/REQUIREMENTS after merge).

## Files Created/Modified

- `apps/api/src/config.ts` - `requireEnv()`/`parseTrustProxy()` pure start-up guards
- `apps/api/src/config.test.ts` - unit tests for both guards, including the boolean-rejection case
- `apps/api/src/session.test.ts` - new file: cookie attributes, issuance boundary, cross-address independence, valid-cookie exemption, tampered-cookie consumption, no-IP-leak, path-scoping, owner-id invariant
- `apps/api/src/server.ts` - no secret fallback anywhere; `QWA_TRUST_PROXY` read through `parseTrustProxy`; updated env header documentation including the reverse-proxy deployment requirement
- `apps/api/src/app.ts` - `trustProxy`, `sessionIssuanceLimit`, `sessionRequiredPathPrefixes` added to `BuildAppOptions`
- `apps/api/src/session.ts` - rate-limit registration, manual-check-in-mint-branch, path-scoped refusal
- `apps/api/src/errors.ts` - `RATE_LIMITED` code + `sendRateLimited()`
- `packages/domain/src/limits.ts` - `SESSION_LIMITS`
- `apps/api/package.json` / `pnpm-lock.yaml` - `@fastify/rate-limit@^11.2.0`

## Decisions Made

- **`app.after()` for exactly-once checker creation.** `app.createRateLimit(options)` must be called once, not per-request: reading the installed package's `LocalStore.prototype.child` confirmed that a second call spawns a fresh, empty counter store, which would silently reset the rate limit on every request. `app.after()` runs once the `rateLimit` plugin registration resolves, without making `registerSessions`/`buildApp` async — avoiding a ripple through every test file that constructs `buildApp` synchronously.
- **RESEARCH.md's assumed API shape (Pattern 2) was not what shipped.** The research document sketched an unverified "exact API depends on the plugin version" placeholder; the installed 11.2.0 actually exposes `app.createRateLimit(options)` returning `(req, callOptions?) => Promise<{isAllowed, ...}>` where the real signal is `result.isExceeded`, not `result.isAllowed` (confirmed by reading the package's own test suite, `test/create-rate-limit.test.js`). Implemented against the verified shape per Task 2's explicit instruction to check the installed version's own README/types rather than copy the research sketch.
- **Path-scoping test path choice.** Task 2's boundary/cross-address/valid-cookie/no-leak tests target `GET /v1/configurations` (a session-required path) rather than `/health`, so those tests remain valid unchanged after Task 3 lands the path-scoping branch — avoiding a rewrite mid-plan.

## Deviations from Plan

None — plan executed exactly as written. All three tasks' `<action>` and `<acceptance_criteria>` were implemented as specified; the two items above are within-task decisions the plan explicitly left to execution-time discretion (Assumption A3's verify-before-committing instruction, and test-path choice), not deviations from the plan's specified behavior.

## Issues Encountered

- One pre-existing flaky test (`apps/api/src/routes/builds.test.ts`, a build-listing sort-order assertion) failed once during a full `pnpm test` run and passed on every other run (including isolated re-runs). Unrelated to any file this plan touches — out of scope per the deviation rules' scope boundary. Not fixed; noted here for visibility.

## User Setup Required

None - no external service configuration required. (Deployment note: production requires `QWA_SESSION_SECRET` and `QWA_TRUST_PROXY` to be set; both are documented in `server.ts`'s header comment and fail loudly with actionable messages if missing — no separate USER-SETUP.md needed since these are standard env vars, not third-party service configuration.)

## Next Phase Readiness

- Session-layer hardening (D-04/D-12/D-14) is complete and composes with 05-01's build-admission work landed in the same `limits.ts`/`app.ts` files.
- `apps/api/src/session.ts` now has its first test file, covering the full surface this phase touches.
- Ready for 05-07 (observability) and 05-08 (deployment consolidation), both of which reference `QWA_TRUST_PROXY`/`QWA_SESSION_SECRET` documentation already in place.
- No blockers.

---
*Phase: 05-hardening-and-scale*
*Completed: 2026-09-03*
