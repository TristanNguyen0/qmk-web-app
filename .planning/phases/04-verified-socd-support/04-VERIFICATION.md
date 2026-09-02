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

Both firmware images below were produced through the product's own path — not the
`socd:matrix` compile matrix — by driving the running API and worker directly through
the same `POST /v1/configurations` → `POST /v1/configurations/:id/builds` → poll →
`GET /v1/builds/:id/artifact` sequence the browser UI uses (`apps/api/src/routes/configurations.ts`,
`apps/api/src/routes/builds.ts`). Both are shared facts about the compile itself; the
hardware-run fields (Date of run, Run by) stay `not yet run` until the Task 2 checkpoint
records a real observation.

| Field | Value |
| --- | --- |
| Board | `mode/m256wh` (Mode Envoy), STM32F401, `stm32-dfu` bootloader |
| Layout id | `LAYOUT_65_ansi_blocker` |
| Catalog version | `0.33.13-1` |
| QMK commit | `332fa30e173e5b0ecc0c70ff166974b6db86525e` |
| SOCD module version | `1.0.0` |
| Directional pair exercised | W/A/S/D — up=position 17 (`KC_W`), left=position 31 (`KC_A`), down=position 32 (`KC_S`), right=position 33 (`KC_D`) |
| Date of run | *(not yet run)* |
| Run by | *(not yet run)* |

### Per-policy build provenance (Task 1, produced 2026-09-02)

Each build's artifact was downloaded and its SHA-256 computed independently
(`sha256sum`); the value matched both the build record's own `artifact.sha256` and the
`x-artifact-sha256` response header in every case — no mismatch occurred.

| Policy | Build id | Configuration id | Firmware filename | Byte size | SHA-256 (build record, download header, and independently computed — all three agree) | Local artifact path |
| --- | --- | --- | --- | --- | --- | --- |
| `neutral` | `fe87d33c-b50f-4907-a0fc-76cfdbfd7908` | `d520791e-e9c0-44ca-b193-8a7dcfb68750` | `mode_m256wh_qwa_fe87d33cb50f4907a0fc76cfdbfd7908.bin` | 65752 bytes | `cbd0d67495a038bcfa2ab525bbfa38f5322ddab90c2ad6c88bc4e40b00741840` | `var/hardware-verification/neutral-mode_m256wh_qwa_fe87d33cb50f4907a0fc76cfdbfd7908.bin` (repo-ignored working area) |
| `last_input_priority` | `cca5ffe7-13b9-4a6a-b056-ec5f86527d80` | `856b86c4-bcd4-42e9-87bd-3aad90439304` | `mode_m256wh_qwa_cca5ffe713b94a6ab056ec5f86527d80.bin` | 65752 bytes | `a862e816eb3157686bdfe58e2bebfb75e5aa2047b4642638ed53d37ecce1c2c3` | `var/hardware-verification/last_input_priority-mode_m256wh_qwa_cca5ffe713b94a6ab056ec5f86527d80.bin` (repo-ignored working area) |

Both configurations bind a QWERTY base layer (layer 0) with the W/A/S/D positions
overridden to the policy's SOCD module keycodes as `validateConfiguration` requires, a
raised layer (layer 1) that leaves positions 17/31/32/33 unbound (compiles to
`KC_TRANSPARENT`, per `packages/qmk-generator/src/generate.ts`'s layer-0-only override),
and one macro (`Type W`, a single `tap KC_W` step) bound to position 0 on the raised
layer, reachable by holding the layer-momentary key at position 59 (`Win`, repurposed as
Fn for this test configuration). Both builds reached the `succeeded` terminal status
(never `failed`, `cancelled`, or `expired`) — confirmed by polling `GET /v1/builds/:id`
to a terminal state and by the worker's own `"message":"build succeeded"` log line for
each build id above. `pnpm test` passed 406/406 after both builds completed.

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
