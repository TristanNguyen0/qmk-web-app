---
gsd_state_version: '1.0'
status: planning
progress:
  total_phases: 7
  completed_phases: 4
  total_plans: 0
  completed_plans: 0
  percent: 57
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-27)

**Core value:** A user gets real, compiled QMK firmware for features that require a source-level
build — and every feature offered has been verified to compile and behave on the pinned revision,
never guessed.
**Current focus:** Phase 4 — Verified SOCD Support

## Current Position

Phase: 4 of 7 (Verified SOCD Support)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-08-27 — Document ingest complete; PROJECT.md, REQUIREMENTS.md, ROADMAP.md created

Progress: [█████░░░░░] 57% (4 of 7 phases; plan-level percent is not yet meaningful)

## Performance Metrics

No GSD-tracked executions yet — Phases 0–3 predate this planning directory.

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 0–3 | pre-GSD | - | - |
| 4 | TBD | - | - |

*Populated after each plan completion.*

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

Last session: 2026-08-27
Stopped at: Roadmap and project memory initialized from document ingest. Phases 0–3 recorded as
complete with delivered scope; Phase 4 is current and unplanned.
Resume file: None

Next: `/gsd-plan-phase 4`
