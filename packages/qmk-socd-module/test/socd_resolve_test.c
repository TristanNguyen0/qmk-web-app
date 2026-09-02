// Copyright 2026 qmk-web-app
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Behavioural tests for SOCD resolution, compiled and run on the host.
//
// claude.md § SOCD Cleaner requirement 6: "Test each selectable policy with compile
// fixtures and, where possible, unit/simulation tests covering simultaneous opposite
// presses, release ordering, and layer interaction."
//
// This is the unit/simulation half, and it runs the *same* code the firmware runs —
// socd_resolve.h is included here and by socd_cleaner.c — rather than a reimplementation
// that could drift. socd_resolve.test.ts compiles and executes this file.
//
// It lives outside module/ deliberately: everything under module/ is copied verbatim
// into a build workspace, and a test binary has no business in firmware source.
//
// Layer interaction is not modelled here because it is not this file's decision: QMK
// resolves a key release against the layer that was active when the key was pressed
// (quantum/action_layer.c, layer cache), so a SOCD keycode always sees a matched
// press/release pair regardless of layer switching. The generator-level consequence —
// SOCD keycodes are emitted on the base layer only — is tested in TypeScript.

#include <stdio.h>
#include <string.h>

#include "socd_resolve.h"

static int failures = 0;
static int checks   = 0;

typedef struct {
    uint8_t side;
    bool    pressed;
} event_t;

// Replays a sequence of presses and releases and reports what the host would see held.
static void replay(socd_policy_t policy, const event_t *events, int count, bool result[2]) {
    socd_pair_state_t state = {0};
    bool              emit[2];
    bool              out[2];
    for (int i = 0; i < count; ++i) {
        socd_apply(&state, policy, events[i].side, events[i].pressed, emit, out);
        // Invariant: socd_apply must leave `registered` equal to what it just resolved,
        // or a later transition would emit the wrong call.
        if (state.registered[0] != out[0] || state.registered[1] != out[1]) {
            printf("FAIL: registered state diverged from resolution at event %d\n", i);
            failures++;
        }
    }
    result[0] = state.registered[0];
    result[1] = state.registered[1];
}

static void expect(const char *name, socd_policy_t policy, const event_t *events, int count, bool want_a, bool want_b) {
    bool got[2];
    checks++;
    replay(policy, events, count, got);
    if (got[0] != want_a || got[1] != want_b) {
        printf("FAIL: %s — expected A=%d B=%d, got A=%d B=%d\n", name, want_a, want_b, got[0], got[1]);
        failures++;
    }
}

#define PRESS_A ((event_t){SOCD_SIDE_A, true})
#define PRESS_B ((event_t){SOCD_SIDE_B, true})
#define RELEASE_A ((event_t){SOCD_SIDE_A, false})
#define RELEASE_B ((event_t){SOCD_SIDE_B, false})

int main(void) {
    // --- No conflict: SOCD must not alter ordinary single-direction typing. ---
    {
        event_t e[] = {PRESS_A};
        expect("single press of A registers A", SOCD_POLICY_NEUTRAL, e, 1, true, false);
        expect("single press of A registers A (last-input)", SOCD_POLICY_LAST_INPUT, e, 1, true, false);
    }
    {
        event_t e[] = {PRESS_A, RELEASE_A};
        expect("press then release leaves nothing held", SOCD_POLICY_NEUTRAL, e, 2, false, false);
        expect("press then release leaves nothing held (last-input)", SOCD_POLICY_LAST_INPUT, e, 2, false, false);
    }

    // --- Simultaneous opposing presses. ---
    {
        event_t e[] = {PRESS_A, PRESS_B};
        expect("neutral: both held sends neither", SOCD_POLICY_NEUTRAL, e, 2, false, false);
        expect("last-input: both held sends the newer (B)", SOCD_POLICY_LAST_INPUT, e, 2, false, true);
    }
    {
        event_t e[] = {PRESS_B, PRESS_A};
        expect("neutral: order does not matter", SOCD_POLICY_NEUTRAL, e, 2, false, false);
        expect("last-input: both held sends the newer (A)", SOCD_POLICY_LAST_INPUT, e, 2, true, false);
    }

    // --- Release ordering: whichever side survives must end up held. ---
    {
        event_t e[] = {PRESS_A, PRESS_B, RELEASE_B};
        expect("neutral: releasing the newer restores the older", SOCD_POLICY_NEUTRAL, e, 3, true, false);
        expect("last-input: releasing the newer restores the older", SOCD_POLICY_LAST_INPUT, e, 3, true, false);
    }
    {
        event_t e[] = {PRESS_A, PRESS_B, RELEASE_A};
        expect("neutral: releasing the older leaves the newer held", SOCD_POLICY_NEUTRAL, e, 3, false, true);
        expect("last-input: releasing the older leaves the newer held", SOCD_POLICY_LAST_INPUT, e, 3, false, true);
    }

    // --- Repeated re-presses while the opposite is held down throughout. ---
    {
        event_t e[] = {PRESS_A, PRESS_B, RELEASE_B, PRESS_B};
        expect("neutral: re-pressing the opposite returns to neutral", SOCD_POLICY_NEUTRAL, e, 4, false, false);
        expect("last-input: re-pressing the opposite gives it priority again", SOCD_POLICY_LAST_INPUT, e, 4, false, true);
    }

    // --- No stuck keys: every scenario must end clean once both are released. ---
    {
        const event_t sequences[][4] = {
            {PRESS_A, PRESS_B, RELEASE_A, RELEASE_B},
            {PRESS_A, PRESS_B, RELEASE_B, RELEASE_A},
            {PRESS_B, PRESS_A, RELEASE_A, RELEASE_B},
            {PRESS_B, PRESS_A, RELEASE_B, RELEASE_A},
        };
        for (int i = 0; i < 4; ++i) {
            expect("neutral: releasing both leaves nothing held", SOCD_POLICY_NEUTRAL, sequences[i], 4, false, false);
            expect("last-input: releasing both leaves nothing held", SOCD_POLICY_LAST_INPUT, sequences[i], 4, false, false);
        }
    }

    // --- Exhaustive: no reachable state can register a direction that is not held. ---
    // SOCD may suppress a held key; it must never invent one.
    {
        const uint8_t sides[]     = {SOCD_SIDE_A, SOCD_SIDE_B};
        const bool    pressed[]   = {true, false};
        socd_policy_t policies[]  = {SOCD_POLICY_NEUTRAL, SOCD_POLICY_LAST_INPUT};
        for (int p = 0; p < 2; ++p) {
            // Every sequence of four events over the two sides.
            for (int mask = 0; mask < 256; ++mask) {
                socd_pair_state_t state = {0};
                bool              emit[2], out[2];
                for (int step = 0; step < 4; ++step) {
                    const int nibble = (mask >> (step * 2)) & 0x3;
                    socd_apply(&state, policies[p], sides[nibble & 1], pressed[(nibble >> 1) & 1], emit, out);
                    checks++;
                    for (int s = 0; s < 2; ++s) {
                        if (state.registered[s] && !state.held[s]) {
                            printf("FAIL: side %d registered while not held (policy %d, mask %d, step %d)\n", s, p, mask, step);
                            failures++;
                        }
                    }
                }
            }
        }
    }

    printf("%d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
