/**
 * SOCD (Simultaneous Opposing Cardinal Directions) support.
 *
 * claude.md rule 9: "SOCD functionality must be implemented against the exact QMK APIs
 * present in the pinned revision." The pinned revision (0.33.13) has **no SOCD
 * implementation in core** — that was checked, not assumed. What it does have is the
 * community module system, so SOCD ships as a first-party module and a user's choice
 * reaches the firmware entirely as keycode tokens in `keymap.json`. See
 * docs/adr/0005-socd-is-a-first-party-community-module.md.
 *
 * The consequence for this file: a SOCD configuration is legal only when it names an
 * opposing pair the module actually implements, because the module's pair table is
 * static C, not something generated per build.
 */

/**
 * Resolution policies. Only policies with a module implementation, host-run behavioural
 * tests, and a real compile appear here (claude.md § SOCD Cleaner requirement 1:
 * "Define an application-level policy enum only for modes demonstrated to compile and
 * behave correctly on the pinned QMK revision").
 */
export const SOCD_POLICIES = Object.freeze([
  Object.freeze({
    id: 'neutral',
    label: 'Neutral',
    description: 'Holding both directions sends neither, until one is released.',
  }),
  Object.freeze({
    id: 'last_input_priority',
    label: 'Last input priority',
    description: 'Holding both directions sends the one pressed most recently.',
  }),
] as const);

export type SocdPolicyId = (typeof SOCD_POLICIES)[number]['id'];

export const SOCD_POLICY_IDS: ReadonlySet<string> = Object.freeze(
  new Set(SOCD_POLICIES.map((p) => p.id)),
);

/**
 * The same ids as a non-empty tuple, so the configuration schema can be built from this
 * list rather than repeating it.
 *
 * The repetition is what would be dangerous: removing a policy here while leaving it in
 * the schema would keep accepting configurations for a policy with no implementation.
 * The cast is safe because SOCD_POLICIES is a frozen, non-empty literal tuple.
 */
export const SOCD_POLICY_ID_TUPLE = SOCD_POLICIES.map((p) => p.id) as unknown as [
  SocdPolicyId,
  ...SocdPolicyId[],
];

/**
 * The opposing pairs the module implements, as `[negative, positive]` on each axis.
 *
 * These mirror `socd_pair_basics` in `module/qmkweb/socd_cleaner/socd_cleaner.c`
 * exactly; a test asserts the two stay in step. A pair is a fact about which two
 * directions physically oppose each other, so it is not user-configurable — the user
 * chooses *which* pair, not what opposes what.
 */
export const SOCD_VERTICAL_PAIRS = Object.freeze([
  Object.freeze(['KC_W', 'KC_S'] as const),
  Object.freeze(['KC_UP', 'KC_DOWN'] as const),
]);

export const SOCD_HORIZONTAL_PAIRS = Object.freeze([
  Object.freeze(['KC_A', 'KC_D'] as const),
  Object.freeze(['KC_LEFT', 'KC_RIGHT'] as const),
]);

/**
 * Module keycode for a direction under a policy.
 *
 * Spelled out rather than assembled from fragments: every value here must exist in
 * `module/qmkweb/socd_cleaner/qmk_module.json`, and a token that does not exist would
 * become an undefined C identifier at compile time. A test cross-checks this table
 * against the module manifest so the two cannot drift.
 */
const MODULE_KEYCODES: Readonly<Record<SocdPolicyId, Readonly<Record<string, string>>>> =
  Object.freeze({
    neutral: Object.freeze({
      KC_W: 'SOCD_NEUTRAL_W',
      KC_S: 'SOCD_NEUTRAL_S',
      KC_A: 'SOCD_NEUTRAL_A',
      KC_D: 'SOCD_NEUTRAL_D',
      KC_UP: 'SOCD_NEUTRAL_UP',
      KC_DOWN: 'SOCD_NEUTRAL_DOWN',
      KC_LEFT: 'SOCD_NEUTRAL_LEFT',
      KC_RIGHT: 'SOCD_NEUTRAL_RIGHT',
    }),
    last_input_priority: Object.freeze({
      KC_W: 'SOCD_LAST_W',
      KC_S: 'SOCD_LAST_S',
      KC_A: 'SOCD_LAST_A',
      KC_D: 'SOCD_LAST_D',
      KC_UP: 'SOCD_LAST_UP',
      KC_DOWN: 'SOCD_LAST_DOWN',
      KC_LEFT: 'SOCD_LAST_LEFT',
      KC_RIGHT: 'SOCD_LAST_RIGHT',
    }),
  });

/** Returns the module keycode, or null when the combination is not implemented. */
export function socdModuleKeycode(policyId: string, keycode: string): string | null {
  const table = (MODULE_KEYCODES as Record<string, Record<string, string> | undefined>)[policyId];
  return table?.[keycode] ?? null;
}

/** Every module keycode this application is willing to emit. */
export const SOCD_MODULE_KEYCODES: readonly string[] = Object.freeze(
  Object.values(MODULE_KEYCODES).flatMap((table) => Object.values(table)),
);

/**
 * Keyboards on which a SOCD firmware image has actually been compiled.
 *
 * claude.md phase 4: "Enable only tested policies/keyboards", and rule 2: never invent
 * a compile target. Catalogued is a weaker claim than *known to build*, and SOCD adds a
 * community module to the build — a keyboard tight on flash can compile without it and
 * fail with it. So the list holds only what
 * `services/worker/scripts/socd-compile-matrix.ts` has actually put through the build
 * image, and everything else reports SOCD as unavailable rather than optimistically
 * offering it.
 */
export const SOCD_VERIFIED_KEYBOARDS: ReadonlySet<string> = Object.freeze(
  new Set(['crkbd/rev1']),
);

export interface SocdCapabilities {
  available: boolean;
  /** Present only when unavailable, and always specific about why. */
  reason?: string;
  policies: readonly { id: string; label: string; description: string }[];
  verticalPairs: readonly (readonly [string, string])[];
  horizontalPairs: readonly (readonly [string, string])[];
}

/**
 * What SOCD this keyboard can actually have. The honest answer for an unverified
 * keyboard is an empty policy list with a reason, never a hopeful one.
 */
export function socdCapabilitiesFor(keyboardId: string): SocdCapabilities {
  if (!SOCD_VERIFIED_KEYBOARDS.has(keyboardId)) {
    return {
      available: false,
      reason:
        'SOCD has not been compile-verified for this keyboard yet. It is enabled only for keyboards that have been through the SOCD compile matrix.',
      policies: [],
      verticalPairs: [],
      horizontalPairs: [],
    };
  }
  return {
    available: true,
    policies: SOCD_POLICIES,
    verticalPairs: SOCD_VERTICAL_PAIRS,
    horizontalPairs: SOCD_HORIZONTAL_PAIRS,
  };
}
