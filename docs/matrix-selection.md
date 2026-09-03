# Curated compile-matrix membership

This document is the written selection criteria D-08 requires: what makes a keyboard a member
of the curated smoke matrix (`services/worker/scripts/fixtures/smoke.ts`), and what a future
addition or removal must be judged against. It does not cover the SOCD matrix
(`services/worker/scripts/fixtures/socd.ts`), whose membership is derived directly from
`MODULE_REGISTRY.verifiedFor` and enforced by the registry-fixture guard
(`missingSocdFixtures`), not by the criteria below.

## What "in the matrix" claims

A member of the curated smoke matrix is a claim the project makes: this keyboard, on this
layout, compiles for real against the pinned QMK revision in the isolated build image. It is a
**compile** claim only. It says nothing about how the resulting firmware behaves on physical
hardware — that is a distinct, stronger claim, established (where it exists at all) by Phase 4's
SOCD verification process for the specific keyboards and policies recorded in
`MODULE_REGISTRY.verifiedFor`, never by matrix membership on its own. Widening the smoke matrix
never adds, removes, or implies a hardware-verification record; see D-10 in
`.planning/phases/04-verified-socd-support/04-CONTEXT.md`.

## Selection criteria

A member is judged against these six criteria:

1. Every member is `supported: true` in the pinned published catalog.
2. Membership maximises distinct `(processor, bootloader)` coverage, weighted by the number of
   supported keyboards sharing each pair — a figure the catalog carries. Popularity is
   explicitly rejected as a criterion because the pinned catalog carries no popularity signal, so
   any such ranking would be invented.
3. At least two members carry a real multi-position layout of distinct physical shape, so the
   generator's layout handling is exercised and not only the toolchain.
4. Remaining members use `handwired/onekey/<board>` on `LAYOUT_ortho_1x1` — QMK's own single-key
   board, one variant per MCU family — so adding a toolchain costs one short compile rather than a
   hand-written key table.
5. Exactly one member carries the reproducibility double build (D-10).
6. The matrix size cap is eight distinct keyboards. A ninth requires removing one or raising the
   cap in this document deliberately.

## Current membership

Verified against a fresh read of `catalogs/0.33.13-1/index.json` at the time this matrix was run:

| Keyboard | Layout | Processor | Bootloader | Supported keyboards sharing this `(processor, bootloader)` pair |
| --- | --- | --- | --- | --- |
| `crkbd/rev1` | `LAYOUT_split_3x6_3` | `atmega32u4` | `caterina` | 700 |
| `handwired/onekey/elite_c` | `LAYOUT_ortho_1x1` | `atmega32u4` | `atmel-dfu` | 1,342 |
| `handwired/onekey/rp2040` | `LAYOUT_ortho_1x1` | `RP2040` | `rp2040` | 336 |
| `handwired/onekey/stm32f0_disco` | `LAYOUT_ortho_1x1` | `STM32F072` | `stm32-dfu` | 292 |

Four members, size cap eight. Together they cover keyboards sharing any of these four
`(processor, bootloader)` pairs: **2,670 of 3,743** supported keyboards in the pinned catalog,
about **71%**. The four pairs are mutually exclusive (each keyboard has exactly one processor and
one bootloader in the catalog), so this is a plain sum, not an estimate with overlap. This spans
three distinct MCU families (`atmega32u4`, `RP2040`, `STM32F072`) and four distinct bootloaders
(`caterina`, `atmel-dfu`, `rp2040`, `stm32-dfu`).

`crkbd/rev1` is the matrix's one designated reproducibility entry (criterion 5, D-10): it is
built twice with the same build id and the two artifacts' SHA-256 must match, asserted rather than
merely reported (see `services/worker/scripts/run-matrix.ts`).

### Known gap against criterion 3

Only one current member — `crkbd/rev1` — carries a real multi-position layout
(`LAYOUT_split_3x6_3`, 42 positions, split-ergo). The three `handwired/onekey/*` members are each
QMK's single-key `LAYOUT_ortho_1x1` probe board (one position), added for toolchain and
bootloader diversity (criterion 4), not layout diversity. Criterion 3 asks for at least two
members with a real multi-position layout of distinct physical shape; the current four-member set
does not yet satisfy it. This is recorded here rather than silently glossed over: a second
multi-position member (a real, non-probe layout on a fourth MCU/bootloader pair, or a second
layout shape on one already covered) is a candidate for a deliberate future addition, reviewed
against these same six criteria and the size cap. Do not close this gap by relaxing criterion 3 —
close it by adding a member that satisfies it.

## Discretion decisions on record

**The catalog build stays out of CI.** The catalog is an immutable versioned artifact produced by
an offline administrative pipeline (ADR 0002), and rebuilding it per run would produce a *new*
catalog version, which `ADR-0001-qmk-pin` forbids as an in-place mutation. The matrix consumes the
already-published `catalogs/0.33.13-1/` directory; CI never builds a catalog.

**No quarantine mechanism for a failing entry.** A quarantine list is precisely the "catalogued
versus known to build" blur `REQ-smoke-matrix` exists to remove. A fixture that stops compiling is
either a real regression to fix, or a keyboard that leaves the matrix through an explicit,
reviewable commit that also removes any registry claim resting on it — never a silent skip.

## Verified run

`pnpm matrix` was run for real against the pinned QMK revision (`332fa30e173e5b0ecc0c70ff166974b6db86525e`,
tag `0.33.13`) in the isolated build image. Every fixture in both the smoke and SOCD sets produced
an artifact, and the `crkbd/rev1` reproducibility check reported two equal SHA-256 values across
eight fixtures compiled across two sets. `MODULE_REGISTRY.verifiedFor` is unchanged by this
matrix's widening — the new toolchain-diversity members have no SOCD fixture and earn no
verification record.
