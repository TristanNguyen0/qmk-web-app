---
phase: 05-hardening-and-scale
plan: 03
subsystem: ui
tags: [export-import, data-loss-disclosure, plain-css, zod, next.js]

# Dependency graph
requires:
  - phase: 05-hardening-and-scale (plan 01)
    provides: "Sequencing only (tracer-first ordering) — no code dependency; files do not overlap"
provides:
  - "Versioned configuration export/import envelope (packages/domain/src/configuration-file.ts)"
  - "Persistent, non-dismissable data-loss notice on two web surfaces"
  - "Export/Import client controls reusing the existing POST /v1/configurations path"
  - "ADR 0006 recording the anonymous-only launch identity decision"
affects: [phase-05-remaining-plans, future-accounts-work]

actuals:
  tokens: 8158
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Export/import envelope is a field allowlist, not a schema validator — mirrors asInput() exactly and defers all content validation to validateConfiguration"
    - "Non-dismissable disclosure enforced mechanically by a zero-props component, not by convention"

key-files:
  created:
    - packages/domain/src/configuration-file.ts
    - packages/domain/src/configuration-file.test.ts
    - apps/web/src/lib/notices.ts
    - apps/web/src/lib/notices.test.ts
    - apps/web/src/components/DataLossNotice.tsx
    - apps/web/src/components/ExportConfigurationButton.tsx
    - apps/web/src/components/ImportConfigurationButton.tsx
    - docs/adr/0006-anonymous-only-launch-identity.md
  modified:
    - packages/domain/src/index.ts
    - apps/web/src/app/configurations/page.tsx
    - apps/web/src/app/globals.css
    - apps/web/src/components/KeymapEditor.tsx

key-decisions:
  - "parseConfigurationFile is a field allowlist, not a schema validator — it never checks keycodes or positions, so import content validation stays exclusively validateConfiguration's job"
  - "DataLossNotice takes zero props, mechanically preventing any future caller from suppressing it"
  - ".data-loss extends .provenance's visual language with a stronger border rather than reusing .notice, which is used for transient/error states elsewhere"
  - "ownerId stays the authorization-subject noun (no-change assumption-delta outcome); a future identities table is the move if one owner ever needs two credentials"

patterns-established:
  - "Pattern: non-dismissable UI disclosure = a component with no props, not a dismissible-by-convention flag"
  - "Pattern: import paths reuse the existing write endpoint and allowlist rather than adding a parallel trust boundary"

requirements-completed: [REQ-launch-identity-model]

coverage:
  - id: D1
    description: "A configuration exports to a versioned JSON file and imports back as a new configuration through the existing create route"
    requirement: "REQ-launch-identity-model"
    verification:
      - kind: unit
        ref: "packages/domain/src/configuration-file.test.ts#round-trips: parse(toConfigurationFile(record)) returns the eight fields unchanged"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/ImportConfigurationButton.tsx (imports createConfiguration, never updateConfiguration — grep-verified)"
        status: pass
    human_judgment: true
    rationale: "The end-to-end browser flow (export a file, select it in the import input, confirm a new list entry appears) requires a running dev server and manual file-picker interaction that this executor could not drive; typecheck + production build + unit round-trip tests cover everything short of that click-through."
  - id: D2
    description: "The data-loss line is present on the configurations list and in the editor chrome with no way to dismiss it"
    requirement: "REQ-launch-identity-model"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/notices.test.ts#DataLossNotice renders on both required surfaces"
        status: pass
    human_judgment: false
  - id: D3
    description: "No server-controlled field can enter through an import, proven per-field by test"
    requirement: "REQ-launch-identity-model"
    verification:
      - kind: unit
        ref: "packages/domain/src/configuration-file.test.ts#parses successfully and drops every server-controlled field, asserted by name"
        status: pass
    human_judgment: false
  - id: D4
    description: "The launch identity decision is recorded in an ADR, including what a user gives up"
    requirement: "REQ-launch-identity-model"
    verification:
      - kind: other
        ref: "test -f docs/adr/0006-anonymous-only-launch-identity.md && grep -q ownerId docs/adr/0006-anonymous-only-launch-identity.md"
        status: pass
    human_judgment: true
    rationale: "Whether the ADR's prose would actually let a reader with no other context understand what is lost and why is a judgment call the plan's own human-check step asks for."

duration: 20min
completed: 2026-09-03
status: complete
---

# Phase 5 Plan 3: Anonymous-only launch identity — disclosure and export/import Summary

**Versioned JSON export/import envelope in `packages/domain`, a zero-props persistent data-loss notice on two web surfaces, and ADR 0006 recording anonymous-only as the deliberate launch identity model.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-03T15:00:00Z (approx.)
- **Completed:** 2026-09-03T15:20:52Z
- **Tasks:** 3
- **Files modified:** 12 (8 created, 4 modified)

## Accomplishments

- `packages/domain/src/configuration-file.ts` exports `CONFIGURATION_FILE_FORMAT_VERSION`,
  `toConfigurationFile()`, and `parseConfigurationFile()` — a versioned export envelope whose
  parser reads exactly eight content fields (`name`, `catalogVersion`, `qmkCommit`, `keyboardId`,
  `layoutId`, `layers`, `macros`, `socd`) and drops everything else, including all eight
  server-controlled fields (`id`, `ownerId`, `revision`, `schemaVersion`, `createdAt`,
  `updatedAt`, `isDraft`, `generatorVersion`), each asserted absent by name.
- `DataLossNotice` — a component with **no props at all** — renders a persistent, non-dismissable
  disclosure on `/configurations` and in the `KeymapEditor` chrome, replacing the old
  `.provenance` sentence on the list page.
- `ExportConfigurationButton` downloads the currently loaded configuration as pretty-printed JSON;
  `ImportConfigurationButton` refuses anything over 1 MiB before reading it, parses via
  `parseConfigurationFile`, and creates — never updates — through the existing
  `createConfiguration()` client call.
- `docs/adr/0006-anonymous-only-launch-identity.md` records the decision: anonymous signed-cookie
  sessions only, the second-device consequence stated explicitly, the `ADR-0001-auth` "no code may
  assume `ownerId` is anonymous-only" constraint restated, the `no-change` assumption-delta outcome
  for `ownerId`, a revisit trigger, and the one-sentence correction to D-05's Tailwind/Radix
  premise.

## Task Commits

Each task was committed atomically:

1. **Task 1: The versioned export envelope and its strict parser** - `e82eb58` (feat)
2. **Task 2: The persistent notice and the export/import controls** - `014efe7` (feat)
3. **Task 3: Record the decision as ADR 0006** - `653b03c` (docs)

**Plan metadata:** pending (this SUMMARY's own commit, made by the worktree executor immediately after this file)

## Files Created/Modified

- `packages/domain/src/configuration-file.ts` - Envelope type, `toConfigurationFile()`, `parseConfigurationFile()`
- `packages/domain/src/configuration-file.test.ts` - Round trip, malformed-envelope, forbidden-field, and division-of-labour tests
- `packages/domain/src/index.ts` - Barrel export for the new module
- `apps/web/src/lib/notices.ts` - `DATA_LOSS_NOTICE` copy as testable data
- `apps/web/src/lib/notices.test.ts` - Copy assertions plus source assertions on both render sites
- `apps/web/src/components/DataLossNotice.tsx` - Zero-props persistent disclosure component
- `apps/web/src/components/ExportConfigurationButton.tsx` - Download control; also exports `filenameFor()` for future unit testing
- `apps/web/src/components/ImportConfigurationButton.tsx` - Size-checked, parse-then-create import control
- `apps/web/src/app/configurations/page.tsx` - Renders `DataLossNotice` + `ImportConfigurationButton`, removes the superseded `.provenance` line
- `apps/web/src/app/globals.css` - New `.data-loss` rule, built on `.provenance`'s visual language with a stronger border
- `apps/web/src/components/KeymapEditor.tsx` - Renders `DataLossNotice` after the toolbar, mounts `ExportConfigurationButton` beside Save
- `docs/adr/0006-anonymous-only-launch-identity.md` - The recorded decision

## Decisions Made

- **`parseConfigurationFile` validates the envelope shape only, never configuration content.** It
  mirrors `asInput()` in `apps/api/src/routes/configurations.ts` field-for-field. A document with an
  unsupported keycode or an out-of-range position parses successfully — rejecting it stays
  `validateConfiguration`'s job on the server, so there is exactly one content validator in the
  system, not two that could drift apart.
- **`DataLossNotice` accepts no props.** This is the mechanical (not conventional) enforcement of
  "non-dismissable" the plan required: there is no `dismissible`/`onDismiss`/`variant` prop for a
  future caller to pass, so `pnpm typecheck` itself would fail a regression attempt.
- **`.data-loss` extends `.provenance`, not `.notice`.** `.notice` is used for transient/error
  states across `BuildPanel`, `MacroEditor`, `CreateConfigurationButton`, and `SocdPanel`; reusing
  it here would teach users the permanent disclosure is something that goes away.
- **Filename derivation strips rather than merely validates.** `SAFE_FILENAME_RE` in
  `apps/api/src/routes/builds.ts` is a *validator* for generator-produced names. A user-typed
  configuration name needs a *stripper*: `ExportConfigurationButton.filenameFor()` replaces any
  character outside `[A-Za-z0-9._-]` with `-`, trims, and falls back to the configuration id when
  nothing safe remains.
- **`ownerId` stays the authorization-subject noun (no-change).** Recorded in ADR 0006: the
  assumption-delta detector's signal (criterion 5's "second device" phrasing) does not require a
  new noun now; it only marks where a future `identities` table would attach if one owner ever
  needs two credentials.

## Deviations from Plan

None - plan executed exactly as written. All three tasks' `<action>` and `<acceptance_criteria>`
were implemented as specified; no Rule 1-4 auto-fixes were needed.

## Issues Encountered

None. `pnpm typecheck` (root + `@qmk-web-app/web`), `pnpm test` (all 445 tests across the
monorepo, including the 12 new `configuration-file` tests and 6 new `notices` tests), and
`pnpm --filter @qmk-web-app/web build` (a Next.js production build, run as a substitute for the
plan's `<human-check>` browser click-through this non-interactive executor could not drive) all
passed. The interactive click-through itself (export a file, re-select it via the file input,
confirm a new list entry) is deferred to human UAT — see coverage entry D1's `rationale`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `CONFIGURATION_FILE_FORMAT_VERSION`, `toConfigurationFile`, `parseConfigurationFile`,
  `ConfigurationFile`, and `ConfigurationFileDocument` are exported from `@qmk-web-app/domain` and
  available to any future plan that needs the same envelope (e.g. a future bulk-export or
  server-side import endpoint, should one ever be added).
- `REQ-launch-identity-model` is fully addressed by this plan: the decision is recorded (ADR 0006),
  its data-loss behaviour is visible in-product (`DataLossNotice`), and the escape hatch exists
  (`ExportConfigurationButton` / `ImportConfigurationButton`).
- No blockers for sibling wave-2 plans — this plan touched only files in its own declared
  `files_modified` list and introduced no new dependency (`git diff --stat apps/web/package.json`
  is empty, confirmed).
- Human UAT should still click through the actual export → import round trip in a running
  `pnpm dev` session per the plan's `<human-check>`, since this executor verified it only at the
  unit-test and production-build level.

## Self-Check: PASSED

- All 8 created files verified present with `[ -f ]` (0 missing).
- All 3 task commit hashes (`e82eb58`, `014efe7`, `653b03c`) verified present in `git log --oneline --all`.
- All plan-level `<verification>` items re-run: `pnpm typecheck` (root + web) passed, `pnpm test` passed (445/445), `git diff --stat apps/web/package.json` is empty, `docs/adr/0006-anonymous-only-launch-identity.md` exists and contains `ownerId`.
- All per-task `<acceptance_criteria>` re-verified individually (see Accomplishments and Files Created/Modified above); all passed.

---
*Phase: 05-hardening-and-scale*
*Completed: 2026-09-03*
