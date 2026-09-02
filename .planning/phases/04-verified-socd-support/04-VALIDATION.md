---
phase: 4
slug: verified-socd-support
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-02
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by `/gsd-plan-phase 4` from `04-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^2.1.8 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test && pnpm socd:matrix catalogs/0.33.13-1` |
| **Estimated runtime** | ~60s quick (no Docker) · full suite requires Docker + pinned QMK tree |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test && pnpm socd:matrix catalogs/0.33.13-1`
- **Before `/gsd-verify-work`:** Full suite green **and** the hardware run recorded in `04-VERIFICATION.md`
- **Max feedback latency:** ~60 seconds (quick run; no Docker required)

---

## Per-Task Verification Map

Task IDs are assigned by the planner; rows below are seeded at requirement granularity
and are refined to `{phase}-{plan}-{task}` form by `/gsd-validate-phase`.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | REQ-socd-policy-choices cl.1 | — | Policy enum exposes only demonstrated modes | unit | `vitest run packages/domain/src/socd.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | REQ-socd-policy-choices cl.2 | — | `CAPABILITY_UNAVAILABLE` + reason for unverified keyboard **or catalog version** | unit | `vitest run packages/domain/src/validate.test.ts` | ❌ W0 (catalogVersion dimension) | ⬜ pending |
| TBD | TBD | TBD | REQ-socd-policy-choices cl.3 | — | Generated `rules.mk`/`config.h`/`keymap.c` carry only templated, allowlisted content | unit + compile | `vitest run packages/qmk-generator/src/generate.test.ts` + `pnpm socd:matrix catalogs/0.33.13-1` | ❌ W0 (`mode/m256wh` fixture) | ⬜ pending |
| TBD | TBD | TBD | REQ-socd-policy-choices cl.4 | — | One application-owned dispatcher, defined feature order | unit (host C) | `pnpm test` (compiles `socd_resolve_test.c`) | ✅ | ⬜ pending |
| TBD | TBD | TBD | REQ-socd-policy-choices cl.5 | — | Deterministic conflict policy, documented in-product incl. mod-taps | unit + copy review | `vitest run apps/web/src/lib/editor-state.test.ts` | ❌ W0 (mod-tap sentence) | ⬜ pending |
| TBD | TBD | TBD | REQ-socd-policy-choices cl.6 | — | Compile fixture + simulation coverage per selectable policy | integration (real image) + unit | `pnpm socd:matrix catalogs/0.33.13-1` | ❌ W0 (`mode/m256wh`) | ⬜ pending |
| TBD | TBD | TBD | REQ-socd-policy-choices cl.7 | — | Unavailable, never guessed, when QMK/module changes | unit | `vitest run packages/domain/src/socd.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | REQ-socd-policy-choices cl.8 | — | Compliance labelling present; product makes no compliance claim | manual copy review | N/A | ✅ | ⬜ pending |
| TBD | TBD | TBD | REQ-curated-module-registry | — | Single typed registry entry with all seven pinned fields | unit | `vitest run` on the new registry-shape test | ❌ W0 (registry not unified) | ⬜ pending |
| TBD | TBD | TBD | REQ-mvp-definition-of-done | — | select → edit → save → build → observe → download, with SOCD supported | e2e + hardware | existing e2e suite; hardware flash is manual | ❌ hardware gate | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `mode/m256wh` fixture entry in `services/worker/scripts/socd-compile-matrix.ts` — REQ-socd-policy-choices cl.3, cl.6 (position indices supplied in `04-RESEARCH.md`)
- [ ] Unit test asserting `MODULE_REGISTRY['qmkweb/socd_cleaner']` carries all seven pinned fields — REQ-curated-module-registry
- [ ] Unit tests for the new `catalogVersion` dimension of `socdCapabilitiesFor(...)`, including a QMK-pin-bump scenario — REQ-socd-policy-choices cl.2, cl.7
- [ ] `04-VERIFICATION.md` hardware-evidence skeleton — the record for success criterion 4
- [ ] Mod-tap resolution sentence in `SocdPanel.tsx` copy — REQ-socd-policy-choices cl.5 / success criterion 1

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Flashed firmware applies the chosen SOCD policy on a real board | REQ-mvp-definition-of-done, success criterion 4 | Requires physical hardware; no emulator reproduces USB HID timing of simultaneous opposite presses | Flash the downloaded artifact to `mode/m256wh`; press opposite directional pairs simultaneously; verify resolution matches the selected policy, release ordering matches documentation, and layer interaction matches the documented rule. Record evidence in `04-VERIFICATION.md`. |
| In-product SOCD copy states resolution against layers, mod-taps, and macro playback | REQ-socd-policy-choices cl.5, cl.8 | Prose accuracy and absence of a compliance claim are editorial judgements | Read `SocdPanel.tsx` rendered copy; confirm all three interaction rules are stated and that responsibility labelling makes no tournament-compliance claim. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] Hardware run recorded in `04-VERIFICATION.md`
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
