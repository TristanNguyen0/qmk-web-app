---
gsd_state_version: 1.0
current_phase: 04
current_phase_name: Verified SOCD Support
status: executing
stopped_at: Phase 5 context gathered
last_updated: "2026-09-03T00:01:43.774Z"
last_activity: 2026-09-02
last_activity_desc: Phase 04 execution started
state_head: fc2b1351dc33dcf97c1e28430191b2d87afa7e3d
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 5
  completed_plans: 4
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-27)

**Core value:** A user gets real, compiled QMK firmware for features that require a source-level
build — and every feature offered has been verified to compile and behave on the pinned revision,
never guessed.
**Current focus:** Phase 04 — Verified SOCD Support

## Current Position

Phase: 04 (Verified SOCD Support) — EXECUTING
Plan: 5 of 5
Status: Ready to execute
Last activity: 2026-09-02 — Phase 04 execution started

Progress: [░░░░░░░░░░] 0% (4 of 7 phases; plan-level percent is not yet meaningful)

## Performance Metrics

No GSD-tracked executions yet — Phases 0–3 predate this planning directory.

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 0–3 | pre-GSD | - | - |
| 4 | TBD | - | - |

*Populated after each plan completion.*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 04 P01 | 25 min | 3 tasks | 70 files |
| Phase 04 P02 | 19min | 3 tasks | 13 files |
| Phase 04 P03 | 10min | 3 tasks | 12 files |
| Phase 04 P04 | 16min | 3 tasks | 14 files |

## Accumulated Context

### Decisions

23 ADR-sourced decisions are **locked** in PROJECT.md `<decisions>`. Full text:
`.planning/intel/decisions.md`. The ones that most constrain Phase 4:

- **ADR 0003**: `/qmk` is read-only with no exceptions; the generated-file allowlist is
  `keymap.json`, `rules.mk`, `config.h`, `keymap.c`; builds run from the `/workspace/qmkroot`
  symlink farm; the artifact comes from exactly one predetermined path.

- **ADR 0004 (artifact-store)**: filesystem-backed `ArtifactStore`; downloads stream through the API;
  **S3/MinIO and signed URLs are deliberately deferred** — do not schedule them. Revisit trigger:
  when the API and the worker no longer share a filesystem.

- **ADR-0001-testing**: fixture compilations run in the real isolated build image, not a mock.
- **ADR-0001-qmk-pin**: `0.33.13` / `332fa30e…`. A bump is a new catalog version and a new build
  image, never an in-place mutation.

- **ADR-0001-browser-flashing**: deferred to Phase 6, undecided. No flashing claim ships before
  verified detection.

- [Phase 04]: Landed worktree-phase-4-socd (683270f) onto main via deterministic branch-diff conflict resolution; also gitignored .gsd/ and .planning/*.lock alongside .claude/ — Same runtime-tooling-state leak rationale the plan applies to .claude/
- [Phase 04]: Broke a real circular ES-module import (socd.ts <-> module-registry.ts) with a lazily-computed, self-caching getter for supportedOptions instead of restructuring ownership — Eager top-level evaluation would throw a TDZ ReferenceError whenever socd.ts is evaluated before module-registry.ts; verified safe against the worst-case entry order
- [Phase 04]: validate.ts now calls socdCapabilitiesFor directly instead of re-deriving its own registry lookup — Keeps exactly one source of truth for SOCD availability between the API route and the server-side validator
- [Phase 04]: socdModuleVersion is required (never optional) on BuildRecord/CompleteBuildArgs, mirroring the outputFormat/logReference/failureCode 'known eventually, null until then' pattern rather than allowing silent omission
- [Phase 04]: Extended packages/domain/src/build.ts's BuildRecord outside the plan's declared files (Rule 3) because memory-store.ts's completion path assigns directly onto the domain record, the same way it already assigns generatorVersion
- [Phase 04]: [Phase 4] Rebuilt qmk-web-app/qmk-build:0.33.13-1 after editing container-entrypoint.sh — the entrypoint is baked into the image at build time, not read from the host checkout at run time — Discovered when the third pnpm env:verify boundary case silently passed instead of failing
- [Phase 04]: [Phase 4] Parameterised generateKeymap's SOCD registry gate (GenerateOptions.verifiedSocdKeyboards) instead of bypassing it, so only the compile matrix can supply its own candidate allowlist — Every worker/API build path keeps the real registry-derived default unchanged; only the operator-run compile matrix breaks the D-06 chicken-and-egg
- [Phase 04]: [Phase 4] mode/m256wh (ARM/STM32) entered MODULE_REGISTRY at compile-only strength after a real 4-build socd:matrix run — the project's first non-AVR compile — D-06/D-10: both AVR and ARM/STM32 toolchains now represented, no hardware claim anywhere yet

### Pending Todos

None yet.

### Blockers/Concerns

- **[Phase 4] Verify before generating.** `claude.md` rule 9 requires inspecting the pinned tree's
  actual SOCD headers, enablement requirements, API, and examples first. `socd_cleaner_process` from
  the original brief is illustrative only. If the facility is absent or changed at `0.33.13`, the
  correct outcome is a recorded unavailability for this catalog version, not guessed code.

- **[Phase 4] The generator must grow past JSON.** It currently emits `qmk.json` and `keymap.json`
  only and refuses C and Make. SOCD needs feature flags, configuration definitions, includes, and
  callbacks. This is in-scope under ADR 0003's existing allowlist — resolved at the ingest gate, not
  an open question.

- **[Phase 4] One `process_record_user` dispatcher.** Macros and SOCD both want it. Do not append a
  second callback.

- **[Phase 5] No curated smoke matrix exists.** Only `crkbd/rev1` has ever really compiled. 3,743
  keyboards are *catalogued*, which is a weaker claim than *known to build*.

- **[Phase 5] No global build concurrency limit or IP rate limiting** — only per-session quotas.
- **[Ongoing] Anonymous sessions only.** Clearing cookies loses a user's work. The identity model
  decision is Phase 5.

## Deferred Items

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Storage | S3/MinIO `ArtifactStore` + signed URLs | Conditional — trigger: API and worker no longer share a filesystem | ADR 0004, 2026-08-09 | MVP |
| Queue | `LISTEN/NOTIFY` behind `BuildQueue.claim` | Conditional — trigger: idle-worker poll cost matters | ADR 0004, 2026-08-09 | MVP |
| Product | Browser flashing approach | Deferred and undecided — Phase 6, after the compatibility matrix | ADR 0001, 2026-08-08 | Post-MVP |
| Product | Second curated module (Achordion, Tap Flow, …) | Deferred — after SOCD Cleaner proves the registry | claude.md, 2026-08-27 | Post-MVP |

## Session Continuity

Last session: 2026-09-03T00:01:43.740Z
Stopped at: Phase 5 context gathered
complete with delivered scope; Phase 4 is current and unplanned.
Resume file: .planning/phases/05-hardening-and-scale/05-CONTEXT.md

Next: `/gsd-plan-phase 4`
