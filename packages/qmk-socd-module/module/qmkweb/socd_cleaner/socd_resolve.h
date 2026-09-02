// Copyright 2026 qmk-web-app
// SPDX-License-Identifier: GPL-2.0-or-later
//
// SOCD resolution logic, deliberately free of every QMK dependency.
//
// Nothing in this header includes a QMK header, calls a QMK function, or touches
// hardware. That is the point: the decision — "given which of an opposing pair are
// physically held, which should the host see?" — is a pure function of state, so it
// can be compiled and tested on a normal machine (see socd_resolve_test.c) rather
// than only inside a firmware image.
//
// socd_cleaner.c is the only file that binds these decisions to QMK's key handling.

#pragma once

#include <stdbool.h>
#include <stdint.h>

// The two sides of an opposing pair. Which physical direction each side means is a
// property of the pair (up/down, left/right), not of this logic.
#define SOCD_SIDE_A 0
#define SOCD_SIDE_B 1

typedef enum {
    // Both directions held resolves to neither being sent.
    SOCD_POLICY_NEUTRAL = 0,
    // Both directions held resolves to the more recently pressed one.
    SOCD_POLICY_LAST_INPUT = 1,
} socd_policy_t;

typedef struct {
    // What the user is physically holding.
    bool held[2];
    // What we have most recently told the host is held. Tracked rather than inferred
    // so that every transition emits exactly one register or unregister per side.
    bool registered[2];
    // Side pressed most recently. Only meaningful while both are held; a matrix scan
    // always serialises two presses, so there is no "simultaneous" case to guess at.
    uint8_t last;
} socd_pair_state_t;

// The resolved intent for a pair: what the host should currently see held.
//
// This is total — every combination of held[] has a defined answer — and depends on
// nothing but the arguments, so the same inputs always produce the same outputs.
static inline void socd_resolve(const socd_pair_state_t *state, socd_policy_t policy, bool out[2]) {
    if (state->held[SOCD_SIDE_A] && state->held[SOCD_SIDE_B]) {
        if (policy == SOCD_POLICY_NEUTRAL) {
            out[SOCD_SIDE_A] = false;
            out[SOCD_SIDE_B] = false;
        } else {
            out[SOCD_SIDE_A] = (state->last == SOCD_SIDE_A);
            out[SOCD_SIDE_B] = (state->last == SOCD_SIDE_B);
        }
    } else {
        // Only one side (or neither) is held: SOCD has nothing to resolve and the
        // physical state passes through untouched.
        out[SOCD_SIDE_A] = state->held[SOCD_SIDE_A];
        out[SOCD_SIDE_B] = state->held[SOCD_SIDE_B];
    }
}

// Records a press or release of one side, then reports the register/unregister calls
// the caller must make to bring the host in sync.
//
// `emit[side]` is true when that side must change, and `out[side]` is its new state.
// Splitting "decide" from "act" keeps every QMK call in socd_cleaner.c.
static inline void socd_apply(socd_pair_state_t *state, socd_policy_t policy, uint8_t side, bool pressed, bool emit[2], bool out[2]) {
    state->held[side] = pressed;
    if (pressed) {
        state->last = side;
    }

    socd_resolve(state, policy, out);

    for (uint8_t i = 0; i < 2; ++i) {
        emit[i] = (out[i] != state->registered[i]);
        state->registered[i] = out[i];
    }
}
