# Phase 4: Verified SOCD Support - Context

**Gathered:** 2026-09-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 delivers a verified SOCD policy a user can enable on a supported keyboard, ending in
firmware that demonstrably applies that policy on a real board.

**This phase does not start from zero.** A complete implementation already exists on the branch
`worktree-phase-4-socd` (commit `683270f`, worktree at `.claude/worktrees/phase-4-socd`, ~6,400
insertions over 66 files), together with an **accepted ADR 0005**. That branch delivers criteria 1,
2, 3 and the code half of 5. Planning must therefore treat Phase 4 as *reconciliation plus gap
closure*, not greenfield construction.

The phase covers four things:

1. Landing the existing branch on `main`.
2. Consolidating the curated module registry so `REQ-curated-module-registry` is met in one place,
   and closing three concrete gaps found in it.
3. Compile-verifying `mode/m256wh` (ARM/STM32) through `socd:matrix`.
4. Flashing that board and proving the policy applies — criterion 4, the phase gate and the
   milestone success metric.

**Out of scope:** re-deciding how SOCD is implemented. ADR 0005 is accepted and its decisions are
carried forward below, not reopened.

</domain>

<decisions>
## Implementation Decisions

### Carried forward from ADR 0005 (accepted — not reopened)

These were decided before this discussion and are recorded here so downstream agents do not
re-derive or contradict them.

- **D-00a:** The pinned revision (`0.33.13`) has **no SOCD in core** — verified by inspection, not
  assumed. The only reference is a changelog line pointing at a third-party repository. SOCD
  therefore ships as a **first-party QMK community module**, `qmkweb/socd_cleaner`.
  — **Reversibility:** one-way — the alternative approaches (vendoring tzarc's module, patching the
  QMK tree) were rejected in an accepted ADR; reversing means superseding ADR 0005.
- **D-00b:** A user's policy choice travels **in the keycode** (16 keycodes = 8 directions × 2
  policies), so `keymap.json` carries `"modules": [...]` plus four keycode tokens and **the generator
  still emits no C**. The ROADMAP's expectation that Phase 4 extends generation to
  `rules.mk` / `config.h` / `keymap.c` is **superseded** — Phase 3's no-generated-C property
  survives intact. — **Reversibility:** one-way — reverting means generating C, which spends a
  shipped security property.
- **D-00c:** Policy set is closed by construction: `neutral`, `last_input_priority`. A policy with no
  keycodes cannot be selected, so the enum cannot drift ahead of the implementation.
- **D-00d:** Opposing pairs (`W/S`, `A/D`, `↑/↓`, `←/→`) are static C — geometry, not preference. The
  user chooses *which* pair and *which* policy, never what opposes what.
- **D-00e:** Module source is pinned by SHA-256 digests at review time; an unreviewed edit fails the
  build. Regeneration is a deliberate act (`pnpm socd:manifest`).
- **D-00f:** Resolution applies on the **base layer only**; `process_record_modules` runs before
  `process_record_user`, so SOCD resolves before macros and a macro's own key events pass through
  untouched.

### Curated module registry

- **D-01:** The seven fields `REQ-curated-module-registry` demands live in **one typed registry
  entry** — a single `MODULE_REGISTRY` structure with SOCD Cleaner as its only entry, which the
  capability function reads. Today that metadata is spread across `qmk_module.json` (license),
  `socd.ts` (options, prerequisites), the digest manifest (source revision) and ADR 0005; the
  requirement asks for an entry, and a second curated module later needs a structure to extend.
  — **Reversibility:** costly — the capability function, the API route, and the SOCD panel all read
  through it once it exists.
- **D-02:** The entry declares the **verified `(catalogVersion, qmkCommit)` pairs** it applies to,
  and the capability function takes `catalogVersion`. A QMK pin bump then reports SOCD unavailable
  until `socd:matrix` re-runs. This makes `REQ-socd-policy-choices` clause 7 structural rather than
  procedural. — **Reversibility:** costly — changes a published API contract's semantics
  (`/v1/catalog/:catalogVersion/socd-capabilities/*` currently echoes `catalogVersion` while
  ignoring it).
- **D-03:** `SOCD_MODULE_VERSION` and the registry entry version are **recorded on the build /
  artifact**, the way `qmkCommit` already is, so a firmware image traces to the exact SOCD
  implementation that produced it. — **Reversibility:** one-way — needs a migration against the
  `builds`/`artifacts` schema and a worker write-path change; `qwa_worker` grants must still cover
  it (ADR-0004-worker-role).
- **D-04:** The entry names the **minimum community-module hook API version**, and the worker
  **asserts it against the pinned tree at startup** — mirroring the existing external-userspace
  assertion required by ADR 0003. Nothing declares or checks this today.
  — **Reversibility:** reversible.

### Hardware verification (criterion 4)

- **D-05:** The verification board is **`mode/m256wh`** (Mode Envoy). Catalog entry confirms:
  `supported: true`, STM32F401, `stm32-dfu` bootloader, layouts `LAYOUT_65_ansi_blocker` (67
  positions) and `LAYOUT_65_ansi_blocker_tsangan` (66). W/A/S/D **and** arrow keys are both present,
  so the pair choice is unconstrained.
- **D-06:** `mode/m256wh` must pass `socd:matrix` and enter the registry as compile-verified
  **before** the hardware run. The phase therefore gains a compile-verification step it would not
  have had with `crkbd/rev1`.
- **D-07:** The on-hardware test matrix is **both policies on one pair**, covering: simultaneous
  opposite press; both release orderings; the base-layer-only rule checked on a raised layer; and one
  macro that types a direction key. Proportionate — `socd_resolve_test.c` already proves resolution
  logic exhaustively (2,070 assertions against the shipped header). Hardware exists to prove wiring,
  keycode registration, flash fit, and QMK's real dispatch order — not to re-prove the logic.
- **D-08:** Evidence lives in **`04-VERIFICATION.md`** in this phase directory — board, firmware
  SHA-256, module version, catalog version, per-check result, date — and `README.md`'s phase table
  gains a one-line "verified on hardware" claim pointing at it. Claims stay near the code; detail
  stays in the phase record.
- **D-09:** **If the hardware run cannot happen this cycle:** the code lands on `main` with the
  registry's hardware-verified list empty, so every keyboard reports `CAPABILITY_UNAVAILABLE` with a
  reason. Phase 4 closes only when the hardware run passes. Nothing ships as verified that is not.

### Verified-keyboard scope

- **D-10:** The registry records **both boards with the distinction explicit** — `crkbd/rev1` as
  compile-verified (AVR), `mode/m256wh` as compile- **and** hardware-verified (ARM/STM32). SOCD is
  offered on compile-verified boards; the phase gate requires at least one hardware-verified board.
  This keeps both toolchains in the matrix and stops the registry from flattening two claims of
  different strength into one. — **Reversibility:** costly — the distinction shapes the registry
  schema and the capability response.

### Landing the branch

- **D-11:** Merge `worktree-phase-4-socd` into `main`, resolving `docs/adr/0001-technology-stack.md`
  **in favour of main's version** (main carries the "amended by ADR 0004" annotation; the branch does
  not), then remove the worktree. The registry, gating, provenance, matrix and hardware work lands as
  new plans on top of the merge.
  - Verified during this discussion: main's uncommitted working tree is **byte-identical** to the
    branch's baseline commit `72cc65c` across all 130 source files **except** that one ADR. There is
    no divergent Phase 3 work to reconcile.
  - The branch history already separates baseline (`72cc65c`) from Phase 4 (`683270f`), so the merge
    preserves the phase boundary without replay.

### Claude's Discretion

- Exact shape and location of the `MODULE_REGISTRY` type (`packages/domain` vs. its own package) —
  decided at planning time against how much a second module would actually share.
- Which pair (`W/S` + `A/D`, or the arrow cluster) the hardware run uses; both are present on the
  board.
- Migration mechanics for D-03.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The prior implementation (read first — this phase is not greenfield)
- `.claude/worktrees/phase-4-socd/docs/adr/0005-socd-is-a-first-party-community-module.md` — the
  accepted decision this phase builds on: why no C is generated, why the policy rides in the keycode,
  what was rejected and why. **Locked.**
- Branch `worktree-phase-4-socd` @ `683270f` — the implementation itself. Key files:
  `packages/qmk-socd-module/` (module C, `socd_resolve.h`, digest manifest, host test),
  `packages/domain/src/socd.ts` (policies, pair tables, keycode map, `socdCapabilitiesFor`),
  `packages/domain/src/validate.ts` (prerequisite-driven `CAPABILITY_UNAVAILABLE`),
  `services/worker/scripts/socd-compile-matrix.ts` (the compile matrix),
  `apps/web/src/components/SocdPanel.tsx` (in-product resolution rules + compliance labelling).

### Locked decisions this phase must not contradict
- `docs/adr/0003-generated-keymaps-live-in-an-external-qmk-userspace.md` — `/qmk` read-only with no
  exceptions; the generated-file allowlist; builds run from the `/workspace/qmkroot` symlink farm;
  the artifact comes from exactly one predetermined path; the worker asserts the userspace mechanism
  against the pinned tree at startup (the pattern D-04 mirrors).
- `docs/adr/0004-the-builds-table-is-the-queue.md` — build lifecycle, lease semantics, and
  `ADR-0004-worker-role` (the `qwa_worker` grant set that D-03's migration must respect).
- `docs/adr/0001-technology-stack.md` — `ADR-0001-testing`: fixture compilations run in the real
  isolated build image, not a mock. `ADR-0001-qmk-pin`: `0.33.13` /
  `332fa30e173e5b0ecc0c70ff166974b6db86525e`.

### Requirements and product rules
- `claude.md` § SOCD Cleaner integration (requirements 1–7), § Curated module registry, rules 9 and
  10. **SPEC tier — outranks ROADMAP.md and PROJECT.md.** Note: rule 9 requires behaviour verified
  "with tests" and names simulation tests "where possible"; it does **not** itself mandate a hardware
  run. The hardware gate is authored by the roadmap, which makes its strictness a product decision
  rather than an ADR lock. The decision recorded here (D-09) keeps the gate.
- `.planning/REQUIREMENTS.md` — `REQ-socd-policy-choices` (8 acceptance clauses),
  `REQ-curated-module-registry` (the seven fields), `REQ-mvp-definition-of-done`.
- `.planning/ROADMAP.md` § Phase 4 — the five success criteria and the scope notes.
- `.planning/PROJECT.md` § Milestone Success Metric — "SOCD firmware compiles and is verified on
  hardware."

### Catalog facts established during this discussion
- `catalogs/0.33.13-1/keyboards/0009.json` → key `mode/m256wh` — the verification board's validated
  metadata (STM32F401, `stm32-dfu`, both 65% layouts, W/A/S/D and arrows present).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/domain/src/socd.ts` — `SOCD_POLICIES`, pair tables, `MODULE_KEYCODES`,
  `SOCD_VERIFIED_KEYBOARDS`, `socdCapabilitiesFor`. This is the file the registry entry (D-01) either
  absorbs or is read by, and where the `catalogVersion` parameter (D-02) lands.
- `packages/qmk-socd-module/src/index.ts` — `SOCD_MODULE_ID`, `SOCD_MODULE_VERSION`,
  `SOCD_MODULE_FILES`, `SOCD_MODULE_DIGESTS`, `verifySocdModuleIntegrity`, `materializeSocdModule`.
  The version constant is what D-03 persists.
- `services/worker/scripts/socd-compile-matrix.ts` — already compiles every (verified keyboard ×
  policy) pair for real; adding `mode/m256wh` (D-06) is a list change plus a real run, not new
  machinery.
- `packages/qmk-socd-module/test/socd_resolve_test.c` — 2,070 assertions compiled with
  `-Wall -Wextra -Werror` against the exact header the firmware runs. This is why D-07's hardware
  matrix is deliberately narrow.

### Established Patterns
- **Cross-checked tables.** The keycode table exists in three places (`qmk_module.json`, the C
  dispatch, `socd.ts`) and tests assert all three agree, because a mismatch would send the wrong key
  rather than fail loudly. A registry entry (D-01) must join this discipline, not escape it.
- **Startup assertion against the pinned tree.** ADR 0003 already has the worker assert the external
  userspace mechanism at startup. D-04 mirrors it for the module hook API.
- **Provenance persisted with builds.** `qmkCommit` is recorded with every configuration and build;
  D-03 extends that to the module version.
- **Honest unavailability.** `socdCapabilitiesFor` returns an empty policy list plus a specific
  reason for an unverified keyboard — never a hopeful one. D-10's compile-vs-hardware distinction
  must preserve that shape.

### Integration Points
- `apps/api/src/routes/catalog.ts:161` — `/v1/catalog/:catalogVersion/socd-capabilities/*`. The route
  already receives `catalogVersion` and echoes it in the response while
  `socdCapabilitiesFor(keyboardId)` (`packages/domain/src/socd.ts:143`) ignores it. D-02 closes that.
- `services/worker/src/collect-artifact.ts` — accepts `hex | bin | uf2` but throws
  `ARTIFACT_REJECTED` when more than one matching file is found. **Only AVR (`.hex`) has ever been
  exercised**; `mode/m256wh` is STM32 and resolves to `.bin`. This path is untested on ARM and is a
  research item for planning, not a decision.
- `services/worker/src/queue-runner.ts:335` — `outputFormat: result.artifact.extension`, the write
  point nearest to D-03's new provenance fields.
- `packages/domain/src/validate.ts:113` — the prerequisite-driven `CAPABILITY_UNAVAILABLE` check that
  replaced the blanket refusal; it must pick up the `catalogVersion` dimension from D-02.

</code_context>

<specifics>
## Specific Ideas

- The verification board is a **Mode Envoy (`mode/m256wh`)** — the user's own hardware. Its ARM/STM32
  platform is a deliberate advantage over `crkbd/rev1`: 256KB of flash makes module size a non-issue,
  and it exercises a toolchain the project has never compiled.
- The registry must express *two different strengths of claim* — compile-verified and
  hardware-verified — because the whole phase is an argument against calling something verified when
  it is not.

</specifics>

<deferred>
## Deferred Ideas

- **A second curated module** (Achordion, Tap Flow, Sentence Case, …) — explicitly post-MVP; the
  roadmap gates it on "after SOCD Cleaner proves the registry mechanism end to end". D-01's registry
  structure is what it would extend.
- **Hardware-verifying `crkbd/rev1`** — it stays compile-verified under D-10. Flashing it too would
  strengthen the AVR claim but is not required to close this phase.
- **Browser flashing** — Phase 6, undecided (`ADR-0001-browser-flashing`). The hardware run in this
  phase is a manual flash; the repo has no flashing tooling and gains none here.
- **Widening the SOCD compile matrix beyond two boards** — belongs with `REQ-smoke-matrix` in
  Phase 5.

</deferred>

---

*Phase: 4-Verified SOCD Support*
*Context gathered: 2026-09-02*
