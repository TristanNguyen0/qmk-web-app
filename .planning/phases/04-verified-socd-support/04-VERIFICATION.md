# Phase 4: SOCD Hardware Verification Record

## Why this record exists

`packages/qmk-socd-module/test/socd_resolve_test.c` already proves SOCD's resolution logic
exhaustively on the host: 2,070 assertions compiled with `-Wall -Wextra -Werror` against the exact
header the firmware runs. This hardware run does not re-prove that logic. It exists to prove what a
host test cannot: wiring, keycode registration on a real board, flash fit, and QMK's real dispatch
order on physical hardware (D-07).

Until every row below carries a passing result, no README, ROADMAP, or phase record may describe
Phase 4, a board, or a policy as verified on hardware. Compile verification and hardware verification
are two claims of different strength (D-10), and this file is where the stronger claim gets earned —
not assumed.

## Evidence fields

| Field | Value |
| --- | --- |
| Board | `mode/m256wh` (Mode Envoy), STM32F401, `stm32-dfu` bootloader |
| Layout id | *(not yet run)* |
| Firmware SHA-256 | *(not yet run)* |
| SOCD module version | *(not yet run)* |
| Catalog version | *(not yet run — e.g. `0.33.13-1`, derived from the pinned QMK revision `0.33.13`)* |
| QMK commit | *(not yet run)* |
| Build id | *(not yet run)* |
| Directional pair exercised | *(not yet run)* |
| Date of run | *(not yet run)* |
| Run by | *(not yet run)* |

## Per-check results

Both published policies (`neutral` and `last_input_priority`) are exercised on the same directional
pair per D-07. Each of the five checks below is recorded once per policy.

### Policy: `neutral`

| # | Check | Status | Result / Notes |
| --- | --- | --- | --- |
| 1 | Simultaneous opposite press resolves as the `neutral` policy specifies | not yet run | |
| 2 | Release ordering — the first-pressed opposite key released first | not yet run | |
| 3 | Release ordering — the second-pressed opposite key released first | not yet run | |
| 4 | Base-layer-only rule: the same physical positions on a raised layer behave normally | not yet run | |
| 5 | A macro that types a direction key plays back unaltered | not yet run | |

### Policy: `last_input_priority`

| # | Check | Status | Result / Notes |
| --- | --- | --- | --- |
| 1 | Simultaneous opposite press resolves as the `last_input_priority` policy specifies | not yet run | |
| 2 | Release ordering — the first-pressed opposite key released first | not yet run | |
| 3 | Release ordering — the second-pressed opposite key released first | not yet run | |
| 4 | Base-layer-only rule: the same physical positions on a raised layer behave normally | not yet run | |
| 5 | A macro that types a direction key plays back unaltered | not yet run | |

## Status

**No hardware run has happened yet.** Every check above is `not yet run` and no result cell is
filled in.

Per D-09: until a hardware run passes and this file is updated with real results, the module
registry's hardware-verified list stays empty. Every keyboard reports `CAPABILITY_UNAVAILABLE` for
hardware-verified status, each with an explicit reason — never a hopeful default. Phase 4 closes only
when a run against `mode/m256wh` passes and this record reflects it.
