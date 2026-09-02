---
phase: 04-verified-socd-support
plan: 02
subsystem: domain
tags: [socd, module-registry, catalog-version, capability-gating, circular-import, qmk]

# Dependency graph
requires:
  - phase: 04-verified-socd-support
    provides: >-
      04-01 landed the SOCD module package, domain policy/pair/keycode tables, the
      prerequisite-driven capability gate, generator module emission, compile matrix, SOCD
      panel, and ADR 0005 onto main.
provides:
  - "packages/domain/src/module-registry.ts: MODULE_REGISTRY, the single typed, deeply-frozen
    source of all seven REQ-curated-module-registry fields for qmkweb/socd_cleaner"
  - "socdCapabilitiesFor(catalogVersion, keyboardId) and validateConfiguration reading through
    the registry instead of a flat keyboard set — a QMK pin bump withdraws SOCD availability
    with a reason naming the catalog version, rather than guessing"
  - "SocdPanel.tsx states all three interaction rules (layers, mod-taps, macros) and uses the
    sitewide render-time failure convention for a capabilities load failure"
affects: [04-03-compile-verify-mode-m256wh, 04-04-hook-api-assertion, 04-05-hardware-flash]

# Actuals (#2632)
actuals:
  tokens: 11500
  tasks: 3
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazily-computed, self-freezing getter property to break a real circular ES-module
      import (socd.ts <-> module-registry.ts) safely regardless of which file a given entry
      point evaluates first, instead of restructuring ownership or reordering imports"
    - "Registry-verification-record match as the sole authority for a capability answer — no
      caller-supplied qmkCommit, no default-allow branch, no wildcard record (T-04-05)"
    - "A product-level 'offered' switch on the curated module entry, orthogonal to the
      per-keyboard verifiedFor list, reconciling two decisions (D-09 phase-close contingency,
      D-10 standing per-keyboard rule) that cannot both be derived rules simultaneously"

key-files:
  created:
    - packages/domain/src/module-registry.ts
    - packages/domain/src/module-registry.test.ts
  modified:
    - packages/domain/src/socd.ts
    - packages/domain/src/socd.test.ts
    - packages/domain/src/validate.ts
    - packages/domain/src/validate.test.ts
    - packages/domain/src/index.ts
    - packages/qmk-socd-module/src/module.test.ts
    - apps/api/src/routes/catalog.ts
    - apps/api/src/routes/catalog.test.ts
    - apps/web/src/components/SocdPanel.tsx
    - services/worker/scripts/socd-compile-matrix.ts
    - packages/qmk-generator/src/generate.ts

key-decisions:
  - "supportedOptions is a lazily-computed, self-caching getter on the registry entry rather
    than a plain value, to break a real circular import between socd.ts and
    module-registry.ts safely regardless of module evaluation order — verified against the
    worst case (a test importing socd.ts directly, bypassing index.ts)."
  - "validate.ts now calls socdCapabilitiesFor directly instead of re-deriving its own
    registry lookup, so there is exactly one source of truth for 'is SOCD available here'
    between the API route and the server-side validator."
  - "Availability matching uses only (catalogVersion, keyboardId) against verifiedFor records,
    not a caller-supplied third qmkCommit argument — the expected commit is intrinsic to the
    matched record, never accepted from the caller, closing the spoofing vector named in
    threat T-04-05."

patterns-established:
  - "Circular-import safety via deferred (getter-based) cross-module reference instead of
    reordering imports or merging modules — see the block comments at the top of both
    socd.ts and module-registry.ts for the full reasoning, reusable if a second curated
    module later creates a similar shape."

requirements-completed: [REQ-curated-module-registry, REQ-socd-policy-choices]

coverage:
  - id: D1
    description: >-
      MODULE_REGISTRY consolidates all seven REQ-curated-module-registry fields
      (sourceRevision, license, minimumHookApiVersion, generatedContract,
      compatibilityTests, supportedOptions, prerequisites) into one deeply-frozen entry,
      cross-checked against the module package's own constants.
    requirement: REQ-curated-module-registry
    verification:
      - kind: unit
        ref: "packages/domain/src/module-registry.test.ts (14 tests: entry count, seven-field
          enumeration, deep freeze, mutation-throws, verifiedFor shape, offered-state
          validation, supportedOptions reference identity)"
        status: pass
      - kind: unit
        ref: "packages/qmk-socd-module/src/module.test.ts (3 new cross-check tests: module
          version, license, digested-file set agree with the registry entry)"
        status: pass
    human_judgment: false
  - id: D2
    description: >-
      socdCapabilitiesFor(catalogVersion, keyboardId) and validateConfiguration resolve
      availability from MODULE_REGISTRY.verifiedFor by exact (catalogVersion, keyboardId)
      match; a QMK pin bump (new catalog version) withdraws availability with a reason
      naming the catalog version instead of guessing; the entry's offered switch and
      verification-strength distinction (compile vs compile+hardware) are both structural.
    requirement: REQ-socd-policy-choices
    verification:
      - kind: unit
        ref: "packages/domain/src/socd.test.ts (19 tests: per-record availability, empty
          + reasoned unavailability naming the catalog version, pin-bump withdrawal,
          declaration-order stability, case-differing policy-id and keycode-token
          rejection, socdVerifiedKeyboards derivation)"
        status: pass
      - kind: unit
        ref: "packages/domain/src/validate.test.ts (23 tests: accepts on the compile-verified
          combination, refuses on pin bump naming the new catalog version, refuses two
          directions sharing one position)"
        status: pass
      - kind: integration
        ref: "apps/api/src/routes/catalog.test.ts (24 tests: GET
          /v1/catalog/:catalogVersion/socd-capabilities/* returns available:false with the
          resolved catalog version in the reason for an unrecorded keyboard, and
          available:true with declaration-ordered policies for crkbd/rev1)"
        status: pass
    human_judgment: false
  - id: D3
    description: >-
      SocdPanel.tsx states all three interaction rules (layers, mod-taps, macros) in its
      "What this does" notice, and its capabilities-load-failure paragraph uses the
      sitewide `.notice` render-time-failure convention instead of `.muted`.
    requirement: REQ-socd-policy-choices
    verification:
      - kind: other
        ref: "grep assertions (Task 3 <verify>): literal 'cannot also be a mod-tap' present
          between the base-layer and macros sentences; load-failure paragraph uses
          .notice with no role attribute; globals.css unchanged; compliance string
          unchanged"
        status: pass
    human_judgment: true
    rationale: >-
      No rendered-DOM test exists for SocdPanel.tsx (none existed before this plan either);
      the grep checks confirm the literal copy and class name are present and correctly
      ordered in source, but a human should visually confirm the notice renders and wraps
      as intended in the browser.

# Metrics
duration: 19min
completed: 2026-09-02
status: complete
---

# Phase 4 Plan 02: Curated Module Registry Consolidation Summary

**One frozen `MODULE_REGISTRY` structure now carries every field `REQ-curated-module-registry`
demands, and SOCD availability is a pure function of `(catalogVersion, keyboardId)` matched
against it — a QMK pin bump withdraws SOCD with a reason instead of guessing.**

## Performance

- **Duration:** 19 min
- **Started:** 2026-09-02T19:05:02Z
- **Completed:** 2026-09-02T19:23:44Z
- **Tasks:** 3
- **Files modified:** 13 (2 created, 11 modified)

## Accomplishments

- Consolidated the seven `REQ-curated-module-registry` fields — previously scattered across
  `qmk_module.json`, `socd.ts`, the digest manifest, and ADR 0005 — into one typed, deeply
  frozen `MODULE_REGISTRY` entry for `qmkweb/socd_cleaner`, with a `verifiedFor` array
  distinguishing compile-only from compile-and-hardware verification strength (D-10) and an
  `offered` product-level switch reconciling D-09's phase-close contingency with D-10's
  standing per-keyboard rule.
- Rewrote `socdCapabilitiesFor` to take `(catalogVersion, keyboardId)` and resolve
  availability from the registry's `verifiedFor` records — no default-allow, no wildcard
  match (closes threat T-04-05). Removed the flat, independently-maintained
  `SOCD_VERIFIED_KEYBOARDS` set; added the derived `socdVerifiedKeyboards(catalogVersion)`
  helper. `validateConfiguration` now calls `socdCapabilitiesFor` directly rather than
  duplicating the lookup, so the API and validator share one source of truth.
- Threaded the resolved catalog version through the `socd-capabilities` API route (the
  `version` local was computed and then discarded before this plan) and closed both
  UI-SPEC-mandated copy gaps in `SocdPanel.tsx`: the mod-tap interaction rule and the
  sitewide `.notice` treatment for a capabilities load failure.
- Discovered and safely broke a real circular ES-module import between `socd.ts` and
  `module-registry.ts` (each needs the other's exports) using a lazily-computed,
  self-caching getter for `supportedOptions` — verified against the worst-case module
  evaluation order (a test file importing `socd.ts` directly, bypassing `index.ts`).

## Task Commits

Each task was committed atomically:

1. **Task 1: Introduce the curated module registry as the single source of module truth** -
   `dacb1d4` (feat)
2. **Task 2: Make capability and validation catalog-version scoped, reading the registry** -
   `4df8834` (feat)
3. **Task 3: Thread the catalog version through the API route and close the two UI copy gaps** -
   `48f2edc` (test)
4. **Supplementary: case-differing policy-id/keycode-token rejection tests (closes a Task 2
   behavior gap found during self-check)** - `3b71547` (test)

## Files Created/Modified

- `packages/domain/src/module-registry.ts` - `MODULE_REGISTRY`, `CuratedModuleEntry`,
  `ModuleVerificationRecord`, `assertValidOfferState`; the single source of the seven
  curated-module-registry fields
- `packages/domain/src/module-registry.test.ts` - shape, deep-freeze, and offer-state
  invariant tests
- `packages/domain/src/socd.ts` - `socdCapabilitiesFor(catalogVersion, keyboardId)`,
  `socdVerifiedKeyboards(catalogVersion)`; removed the flat `SOCD_VERIFIED_KEYBOARDS`
  export
- `packages/domain/src/socd.test.ts` - pin-bump, declaration-order, case-differing-token,
  and offered-switch coverage
- `packages/domain/src/validate.ts` - the `CAPABILITY_UNAVAILABLE` gate now reads through
  `socdCapabilitiesFor`
- `packages/domain/src/validate.test.ts` - pin-bump scenario; renamed the duplicate-position
  test to name the case explicitly
- `packages/domain/src/index.ts` - re-exports `module-registry.ts`
- `packages/qmk-socd-module/src/module.test.ts` - cross-check against
  `MODULE_REGISTRY['qmkweb/socd_cleaner']`
- `apps/api/src/routes/catalog.ts` - passes the resolved `version` into
  `socdCapabilitiesFor`
- `apps/api/src/routes/catalog.test.ts` - catalog-version-in-reason and
  declaration-order coverage
- `apps/web/src/components/SocdPanel.tsx` - mod-tap sentence; `.notice` for the load-failure
  paragraph
- `services/worker/scripts/socd-compile-matrix.ts` - reads `socdVerifiedKeyboards` instead
  of the removed flat constant
- `packages/qmk-generator/src/generate.ts` - defense-in-depth SOCD check now
  catalog-version aware too (Rule 3 fix, see Deviations)

## Decisions Made

- **Lazy-getter circular-import fix.** `module-registry.ts`'s `supportedOptions` field must
  reference `socd.ts`'s frozen tables, and `socd.ts`'s `socdCapabilitiesFor` must read
  `MODULE_REGISTRY` — a real cycle. Computing `supportedOptions` eagerly at
  `module-registry.ts`'s own top level would throw a TDZ `ReferenceError` whenever
  `socd.ts` is the first of the two evaluated (confirmed by tracing Node's ESM evaluation
  order, and empirically by running the domain test suite with `socd.test.ts` — which
  imports `socd.ts` directly, bypassing `index.ts` — as the worst case). Fixed by attaching
  `supportedOptions` as a getter, computed and frozen on first access rather than during
  module evaluation, so neither module needs the other's bindings until application code
  actually calls in.
- **validate.ts delegates to socdCapabilitiesFor** instead of re-deriving its own registry
  lookup, keeping exactly one source of truth for the availability answer between the API
  route and the server-side validator.
- **No third `qmkCommit` parameter.** `socdCapabilitiesFor` matches only on
  `(catalogVersion, keyboardId)`; the expected commit is intrinsic to the matched
  `verifiedFor` record, never caller-supplied. Combined with ADR-0001-qmk-pin's "a bump is
  a new catalog version, never an in-place mutation," this makes a genuine QMK pin bump
  manifest as a catalog-version miss, which is what the pin-bump tests exercise.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `packages/qmk-generator/src/generate.ts` broken by removing `SOCD_VERIFIED_KEYBOARDS`**
- **Found during:** Task 2, running `pnpm test`/`pnpm typecheck` after rewriting `socd.ts`
- **Issue:** `generate.ts`'s defense-in-depth SOCD check imported the flat
  `SOCD_VERIFIED_KEYBOARDS` export, which Task 2 removes. This caller is outside the
  plan's declared `files_modified` list for this plan, but removing the export without
  fixing it broke the build (`Cannot read properties of undefined (reading 'has')`).
- **Fix:** Updated the check to `socdVerifiedKeyboards(configuration.catalogVersion).has(configuration.keyboardId)`
  — a one-line, mechanical change that also makes this defense-in-depth gate
  catalog-version aware, consistent with D-02. Preserved the `/compile-verified/` substring
  the existing test asserts on.
- **Files modified:** `packages/qmk-generator/src/generate.ts`
- **Verification:** `pnpm test` (23/23 in `generate.test.ts`, including the existing
  "refuses SOCD for a keyboard that has not been compile-verified" case) and `pnpm typecheck`
  both pass.
- **Committed in:** `4df8834` (Task 2 commit)

**2. [Rule 3 - Blocking] `apps/api/src/routes/catalog.ts` broken by the two-argument `socdCapabilitiesFor` signature**
- **Found during:** Task 2, `pnpm typecheck` (whole-monorepo `tsc -p .`)
- **Issue:** The route's call `socdCapabilitiesFor(keyboardId)` no longer typechecks against
  the new two-argument signature. This line is also exactly what plan Task 3's action text
  describes threading — since Task 2's own `<verify>` requires `pnpm typecheck` to pass
  monorepo-wide, the fix could not be deferred to Task 3.
- **Fix:** Changed the call to `socdCapabilitiesFor(version, keyboardId)`, matching Task 3's
  acceptance criterion exactly. Task 3 still did its own substantive work (new test cases,
  the two `SocdPanel.tsx` copy changes); this one line was simply already correct by the
  time Task 3 started, and Task 3's `<verify>` confirms it.
- **Files modified:** `apps/api/src/routes/catalog.ts`
- **Verification:** `pnpm typecheck` passes monorepo-wide; Task 3's
  `grep -c 'socdCapabilitiesFor(version, keyboardId)'` check returns 1.
- **Committed in:** `4df8834` (Task 2 commit)

**3. [Rule 2 - Missing Critical] Added case-differing policy-id and keycode-token rejection tests**
- **Found during:** Post-Task-3 self-check, re-reading Task 2's `<behavior>` list against
  the actual diff
- **Issue:** Task 2's behavior list requires "an unrecognised policy id or keycode token
  (including a case-differing variant of a real one) is rejected," and its action text
  explicitly calls for "a case-differing policy id rejected" test. The exact-match logic
  itself (Zod enum + direct object-key lookup) was already correct and unchanged by this
  plan, but no test asserted the case-differing-rejection behavior, leaving a must-have
  truth unverified.
- **Fix:** Added two tests to `packages/domain/src/socd.test.ts`: one asserting
  `'Neutral'`/`'NEUTRAL'`/`'neutral '` all fail `socdConfigurationSchema.safeParse`, and one
  asserting `socdModuleKeycode` returns `null` for `'kc_w'`/`'Kc_W'`/a
  policy-id-case-mismatch.
- **Files modified:** `packages/domain/src/socd.test.ts`
- **Verification:** `pnpm test` (384/384 passing, up from 382).
- **Committed in:** `3b71547` (supplementary commit)

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 missing critical). **Impact on plan:** All
three were necessary to keep `pnpm test`/`pnpm typecheck` green after Task 2's signature
change and to fully close a behavior Task 2 itself specified; none expanded scope beyond
what the plan's own tasks already required.

## Issues Encountered

- **Real circular ES-module import discovered mid-Task-2, not anticipated by the plan.**
  `socd.ts` needing `MODULE_REGISTRY` and `module-registry.ts` needing `socd.ts`'s tables
  for `supportedOptions` forms a genuine cycle. Traced Node's ESM evaluation-order rules to
  confirm a naive implementation would throw a TDZ `ReferenceError` in the worst-case
  import order, then fixed it with a lazy getter (see Decisions above) and confirmed the fix
  against that worst case directly (running `packages/domain/src/socd.test.ts`, which
  imports `socd.ts` relatively, bypassing `index.ts` entirely).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `MODULE_REGISTRY` and the catalog-version-scoped `socdCapabilitiesFor` are the structure
  plan 04-03 (compile-verify `mode/m256wh`) will add a second `verifiedFor` record to, and
  plan 04-05 (hardware flash) will upgrade that record's `verification` strength to
  `'compile+hardware'` — no schema change needed for either.
- `MODULE_REGISTRY['qmkweb/socd_cleaner'].minimumHookApiVersion` (`'1.0.0'`) is in place for
  plan 04-04's startup hook-API assertion to read.
- `offered.enabled` remains `true`; only a later plan may flip it per D-09.

---
*Phase: 04-verified-socd-support*
*Completed: 2026-09-02*

## Self-Check: PASSED

- All key files verified present on disk: `packages/domain/src/module-registry.ts`,
  `packages/domain/src/module-registry.test.ts`, and every modified file listed above.
- All 4 commits verified present in `git log`: `dacb1d4`, `4df8834`, `48f2edc`, `3b71547`.
- Re-ran plan-level `<verification>`: `pnpm test` (384/384 pass), `pnpm typecheck` (exits 0,
  monorepo-wide including `apps/web`).
- Re-ran every task-level `<verify>` command independently; all pass.
- Confirmed via grep: `MODULE_REGISTRY` has exactly one entry with all seven required field
  literals; `SOCD_VERIFIED_KEYBOARDS` has zero remaining references anywhere in the
  codebase; `socdCapabilitiesFor(version, keyboardId)` appears exactly once in
  `catalog.ts`; the mod-tap sentence and `.notice` class both present in `SocdPanel.tsx`;
  `apps/web/src/app/globals.css` has zero diff from this plan.
