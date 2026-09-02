# Phase 4: Verified SOCD Support - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-02
**Phase:** 4-Verified SOCD Support
**Areas discussed:** Prior-art reconciliation, Registry entry completeness, Hardware proof for
criterion 4, Verified-keyboard scope, Landing the branch on main

---

## Prior-art reconciliation

Raised before any gray areas were generated, because the scout found a complete Phase 4
implementation on `worktree-phase-4-socd` (`683270f`) with an accepted ADR 0005 — making the
standard "decide how to build this" discussion the wrong frame.

| Option | Description | Selected |
|--------|-------------|----------|
| Reconcile, then discuss the gap | Treat the branch as prior art, record ADR 0005's locked decisions in CONTEXT.md, discuss only what is genuinely open | ✓ |
| Audit against the criteria first | Skip discussion; verify the implementation against the 5 criteria and 8 acceptance clauses before any planning | |
| Full discussion from scratch | Ignore the worktree and decide the approach fresh | |

**User's choice:** Reconcile, then discuss the gap.
**Notes:** Running a from-scratch discussion would have re-decided questions ADR 0005 has already
locked — no generated C, policy in the keycode, closed policy set.

---

## Registry entry completeness

Grounded first by auditing `REQ-curated-module-registry`'s seven required fields against the code.
Five were already covered; two were genuinely absent (minimum module API version; module version
recorded with builds), and a third divergence surfaced — the capability function ignores the
`catalogVersion` its own API route carries.

### Registry shape

| Option | Description | Selected |
|--------|-------------|----------|
| One typed registry entry | Single `MODULE_REGISTRY` with SOCD as its one entry carrying all seven fields, read by the capability function | ✓ |
| Keep it distributed, close the gaps in place | Leave metadata where it lives, fix the two gaps, document the field→location mapping in ADR 0005 | |
| You decide | Defer to Claude at planning time | |

### Catalog-version gating

| Option | Description | Selected |
|--------|-------------|----------|
| Entry declares verified (catalogVersion, qmkCommit) | Capability function takes `catalogVersion`; a pin bump reports unavailable until the matrix re-runs | ✓ |
| Keep keyboard-only gating | Treat the pin-bump process as the control; record the gap as a known limit | |

### Build provenance

| Option | Description | Selected |
|--------|-------------|----------|
| Record it on the build | Persist `SOCD_MODULE_VERSION` + entry version with the build/artifact, as `qmkCommit` already is; costs a migration | ✓ |
| Correct the comment, no schema change | Digest pin + matrix output is the provenance; stop claiming a build record that does not exist | |

### Minimum community-module API version

| Option | Description | Selected |
|--------|-------------|----------|
| Declare it and assert at worker startup | Entry names the minimum hook API version; worker asserts against the pinned tree, mirroring ADR 0003 | ✓ |
| Declare it, no runtime assertion | Record it so the requirement is met; rely on the compile matrix to fail loudly | |
| Rely on the QMK pin alone | The pin fixes the API by construction; record the reasoning instead of adding a field | |

**Notes:** All four went to the recommended option. The through-line is that the requirement's fields
should be enforceable in code rather than asserted in prose.

---

## Hardware proof for criterion 4

Surfaced before the questions: `claude.md` (SPEC tier, outranking the roadmap) requires SOCD
behaviour verified "with tests" and names simulation tests "where possible" — it does **not** itself
mandate a hardware run. The gate comes from ROADMAP criterion 4 and PROJECT.md's milestone metric, so
its strictness was the user's to set.

### Hardware availability

| Option | Description | Selected |
|--------|-------------|----------|
| crkbd/rev1 on hand | The only board ever compiled; matches the current verified list | |
| A different QMK board | Would need `socd:matrix` and registry entry first, adding a compile-verification step | ✓ |
| No board available right now | Forces an explicit decision about criterion 4 | |

**User's choice:** A different QMK board — supplied mid-turn as **`mode/m256wh` (Mode Envoy)**.
**Notes:** Catalog lookup confirmed `supported: true`, STM32F401, `stm32-dfu`, 65% ANSI blocker
layouts, W/A/S/D and arrows both present. ARM rather than AVR, and 256KB of flash, so module size is
a non-issue and a second toolchain enters the matrix. Also surfaced a risk: `collect-artifact.ts`
has only ever been exercised on `.hex`.

### On-hardware test matrix

| Option | Description | Selected |
|--------|-------------|----------|
| Both policies, one pair, plus layer and macro checks | Simultaneous press, both release orderings, base-layer-only on a raised layer, one macro typing a direction key | ✓ |
| Minimal smoke | One policy, simultaneous press only | |
| Exhaustive | Both policies × both pairs, all three behaviours, plus macro interaction | |

**Notes:** Chosen as proportionate — `socd_resolve_test.c` already proves resolution logic with 2,070
assertions against the shipped header, so hardware is there to prove wiring, registration, flash fit
and real dispatch order.

### Evidence location

| Option | Description | Selected |
|--------|-------------|----------|
| Phase VERIFICATION.md plus a README line | Detail in the phase record; a one-line "verified on hardware" claim in the README table | ✓ |
| Phase VERIFICATION.md only | Planning-directory record only; README unchanged | |
| ADR 0005 and README only | Record kept with the decision it validates, outside the planning directory | |

### Contingency if hardware verification cannot happen

| Option | Description | Selected |
|--------|-------------|----------|
| Code lands, capability stays dark | Merge with the hardware-verified list empty; every keyboard reports `CAPABILITY_UNAVAILABLE`; phase closes only on a passing run | ✓ |
| Phase 4 stays open, branch unmerged | Hold the branch off main; long-lived branch | |
| Relax the gate to the host tests | Ship on host assertions, move hardware to Phase 5; would require amending criterion 4 and the milestone metric | |

---

## Verified-keyboard scope

| Option | Description | Selected |
|--------|-------------|----------|
| Both, with the distinction recorded | `crkbd/rev1` compile-verified, `mode/m256wh` compile- and hardware-verified; SOCD offered on compile-verified, gate needs one hardware-verified | ✓ |
| Hardware-verified only | Only `mode/m256wh` offers SOCD until crkbd is flashed too | |
| Both, undifferentiated | Add the board to the existing flat set | |

**Notes:** Keeps both toolchains covered and stops the registry flattening two claims of different
strength into one.

---

## Landing the branch on main

| Option | Description | Selected |
|--------|-------------|----------|
| Merge, keeping main's newer ADR 0001 | Merge the branch, resolve `docs/adr/0001-technology-stack.md` in main's favour, remove the worktree | ✓ |
| Review the phase-4 commit first | Code/security review over 683270f before it reaches main | |
| Leave landing to planning | Record that it must land; let plan-phase sequence it | |

**Notes:** Established by file-by-file comparison during the discussion: main's uncommitted tree is
byte-identical to the branch's baseline commit `72cc65c` across all 130 source files except
`docs/adr/0001-technology-stack.md`, where main carries the "amended by ADR 0004" annotation the
branch lacks. No divergent Phase 3 work exists to reconcile.

---

## Claude's Discretion

- Exact shape and location of the `MODULE_REGISTRY` type (`packages/domain` vs. its own package).
- Which pair (`W/S` + `A/D`, or the arrow cluster) the hardware run uses.
- Migration mechanics for recording module provenance on builds.

## Deferred Ideas

- A second curated module (Achordion, Tap Flow, Sentence Case, …) — post-MVP; gated on SOCD proving
  the registry mechanism end to end.
- Hardware-verifying `crkbd/rev1` — stays compile-verified; not required to close this phase.
- Browser flashing — Phase 6, undecided.
- Widening the SOCD compile matrix beyond two boards — belongs with `REQ-smoke-matrix` in Phase 5.
