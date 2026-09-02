// Copyright 2026 qmk-web-app
// SPDX-License-Identifier: GPL-2.0-or-later
//
// SOCD Cleaner as a QMK community module.
//
// Why a module and not a core feature: the pinned QMK revision (0.33.13,
// 332fa30e173e5b0ecc0c70ff166974b6db86525e) has no SOCD implementation in core. It
// was checked rather than assumed — see docs/adr/0005. The community module system
// *is* present at this revision, and this file targets its API exactly.
//
// Why the policy lives in the keycode: a module's per-build configuration would
// otherwise have to arrive as a generated C header. Encoding both the direction and
// the resolution policy in the keycode instead means a user's SOCD choice travels as
// two JSON strings in keymap.json and nothing else — the generator still emits no C
// at all. See docs/adr/0005.
//
// Ordering, per quantum/quantum.c:354 ("modules must run before kb") at the pinned
// revision: process_record_modules runs before process_record_kb and therefore before
// process_record_user, where QMK places JSON-defined macros. So SOCD resolves a
// direction key before any macro sees it, and a macro's own key events are not SOCD
// keycodes and pass through untouched.

#include QMK_KEYBOARD_H

#include "socd_resolve.h"

ASSERT_COMMUNITY_MODULES_MIN_API_VERSION(1, 0, 0);

// Opposing pairs, in the order the slots are indexed. Which two directions oppose
// each other is a fixed property of a keyboard's geometry, not something a user
// configures, so the table is static and the application validates against the same
// four pairs (packages/domain/src/socd.ts).
#define SOCD_PAIR_WS 0
#define SOCD_PAIR_AD 1
#define SOCD_PAIR_UPDOWN 2
#define SOCD_PAIR_LEFTRIGHT 3
#define SOCD_PAIR_COUNT 4

// One state per (policy, pair). Both policies get their own slots so that a keymap
// mixing them — which the application does not currently emit, but which the keycodes
// permit — cannot make two pairs share resolution state.
#define SOCD_SLOT_COUNT (SOCD_PAIR_COUNT * 2)

static socd_pair_state_t socd_states[SOCD_SLOT_COUNT];

typedef struct {
    uint8_t       slot;
    uint8_t       side;
    socd_policy_t policy;
    // The basic keycode this SOCD keycode stands in for. This module owns sending it.
    uint16_t basic;
} socd_binding_t;

static inline uint8_t socd_slot(socd_policy_t policy, uint8_t pair) {
    return (uint8_t)(policy * SOCD_PAIR_COUNT + pair);
}

// Explicit rather than arithmetic on the keycode enum. The enum is contiguous within
// a module, but a switch cannot silently drift if the module's keycode list is ever
// reordered — a wrong entry here would send the wrong key, which is exactly the class
// of bug that must not be possible to introduce by accident.
static bool socd_binding_for(uint16_t keycode, socd_binding_t *out) {
    switch (keycode) {
        // clang-format off
        case SOCD_NEUTRAL_W:     *out = (socd_binding_t){socd_slot(SOCD_POLICY_NEUTRAL,    SOCD_PAIR_WS),        SOCD_SIDE_A, SOCD_POLICY_NEUTRAL,    KC_W};     return true;
        case SOCD_NEUTRAL_S:     *out = (socd_binding_t){socd_slot(SOCD_POLICY_NEUTRAL,    SOCD_PAIR_WS),        SOCD_SIDE_B, SOCD_POLICY_NEUTRAL,    KC_S};     return true;
        case SOCD_NEUTRAL_A:     *out = (socd_binding_t){socd_slot(SOCD_POLICY_NEUTRAL,    SOCD_PAIR_AD),        SOCD_SIDE_A, SOCD_POLICY_NEUTRAL,    KC_A};     return true;
        case SOCD_NEUTRAL_D:     *out = (socd_binding_t){socd_slot(SOCD_POLICY_NEUTRAL,    SOCD_PAIR_AD),        SOCD_SIDE_B, SOCD_POLICY_NEUTRAL,    KC_D};     return true;
        case SOCD_NEUTRAL_UP:    *out = (socd_binding_t){socd_slot(SOCD_POLICY_NEUTRAL,    SOCD_PAIR_UPDOWN),    SOCD_SIDE_A, SOCD_POLICY_NEUTRAL,    KC_UP};    return true;
        case SOCD_NEUTRAL_DOWN:  *out = (socd_binding_t){socd_slot(SOCD_POLICY_NEUTRAL,    SOCD_PAIR_UPDOWN),    SOCD_SIDE_B, SOCD_POLICY_NEUTRAL,    KC_DOWN};  return true;
        case SOCD_NEUTRAL_LEFT:  *out = (socd_binding_t){socd_slot(SOCD_POLICY_NEUTRAL,    SOCD_PAIR_LEFTRIGHT), SOCD_SIDE_A, SOCD_POLICY_NEUTRAL,    KC_LEFT};  return true;
        case SOCD_NEUTRAL_RIGHT: *out = (socd_binding_t){socd_slot(SOCD_POLICY_NEUTRAL,    SOCD_PAIR_LEFTRIGHT), SOCD_SIDE_B, SOCD_POLICY_NEUTRAL,    KC_RIGHT}; return true;
        case SOCD_LAST_W:        *out = (socd_binding_t){socd_slot(SOCD_POLICY_LAST_INPUT, SOCD_PAIR_WS),        SOCD_SIDE_A, SOCD_POLICY_LAST_INPUT, KC_W};     return true;
        case SOCD_LAST_S:        *out = (socd_binding_t){socd_slot(SOCD_POLICY_LAST_INPUT, SOCD_PAIR_WS),        SOCD_SIDE_B, SOCD_POLICY_LAST_INPUT, KC_S};     return true;
        case SOCD_LAST_A:        *out = (socd_binding_t){socd_slot(SOCD_POLICY_LAST_INPUT, SOCD_PAIR_AD),        SOCD_SIDE_A, SOCD_POLICY_LAST_INPUT, KC_A};     return true;
        case SOCD_LAST_D:        *out = (socd_binding_t){socd_slot(SOCD_POLICY_LAST_INPUT, SOCD_PAIR_AD),        SOCD_SIDE_B, SOCD_POLICY_LAST_INPUT, KC_D};     return true;
        case SOCD_LAST_UP:       *out = (socd_binding_t){socd_slot(SOCD_POLICY_LAST_INPUT, SOCD_PAIR_UPDOWN),    SOCD_SIDE_A, SOCD_POLICY_LAST_INPUT, KC_UP};    return true;
        case SOCD_LAST_DOWN:     *out = (socd_binding_t){socd_slot(SOCD_POLICY_LAST_INPUT, SOCD_PAIR_UPDOWN),    SOCD_SIDE_B, SOCD_POLICY_LAST_INPUT, KC_DOWN};  return true;
        case SOCD_LAST_LEFT:     *out = (socd_binding_t){socd_slot(SOCD_POLICY_LAST_INPUT, SOCD_PAIR_LEFTRIGHT), SOCD_SIDE_A, SOCD_POLICY_LAST_INPUT, KC_LEFT};  return true;
        case SOCD_LAST_RIGHT:    *out = (socd_binding_t){socd_slot(SOCD_POLICY_LAST_INPUT, SOCD_PAIR_LEFTRIGHT), SOCD_SIDE_B, SOCD_POLICY_LAST_INPUT, KC_RIGHT}; return true;
            // clang-format on
        default:
            return false;
    }
}

// The other side of a pair, whose registration this press or release may also change.
static inline uint8_t socd_other(uint8_t side) {
    return (uint8_t)(side == SOCD_SIDE_A ? SOCD_SIDE_B : SOCD_SIDE_A);
}

static const uint16_t socd_pair_basics[SOCD_PAIR_COUNT][2] = {
    [SOCD_PAIR_WS]        = {KC_W, KC_S},
    [SOCD_PAIR_AD]        = {KC_A, KC_D},
    [SOCD_PAIR_UPDOWN]    = {KC_UP, KC_DOWN},
    [SOCD_PAIR_LEFTRIGHT] = {KC_LEFT, KC_RIGHT},
};

bool process_record_socd_cleaner(uint16_t keycode, keyrecord_t *record) {
    if (!process_record_socd_cleaner_kb(keycode, record)) {
        return false;
    }

    socd_binding_t binding;
    if (!socd_binding_for(keycode, &binding)) {
        // Not one of ours. Every other keycode, including the keys of a macro, is
        // passed on untouched.
        return true;
    }

    bool emit[2];
    bool out[2];
    socd_apply(&socd_states[binding.slot], binding.policy, binding.side, record->event.pressed, emit, out);

    const uint8_t  pair       = (uint8_t)(binding.slot % SOCD_PAIR_COUNT);
    const uint8_t  other      = socd_other(binding.side);
    const uint16_t other_code = socd_pair_basics[pair][other];

    // Release before press. When a press flips which side is registered, sending the
    // release first means the host never briefly observes both directions held, which
    // is the entire point of resolving them.
    if (emit[binding.side] && !out[binding.side]) {
        unregister_code16(binding.basic);
    }
    if (emit[other] && !out[other]) {
        unregister_code16(other_code);
    }
    if (emit[other] && out[other]) {
        register_code16(other_code);
    }
    if (emit[binding.side] && out[binding.side]) {
        register_code16(binding.basic);
    }

    // This module owns these keycodes completely: QMK must not also try to register
    // them, and nothing further down the chain should see them.
    return false;
}
