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
 * `MODULE_REGISTRY` is the single source of which (catalogVersion, keyboardId) pairs
 * have actually had a SOCD firmware image compiled (D-01, D-02). This file imports it
 * only inside function bodies below, never at this module's own top level — that is
 * what keeps the resulting circular import (module-registry.ts imports SOCD_POLICIES
 * and friends from this file, for its `supportedOptions` field) safe regardless of
 * which of the two files a given entry point (index.ts, or a test importing this file
 * directly) happens to evaluate first. See the matching note in module-registry.ts.
 */
import { MODULE_REGISTRY, type ModuleVerificationStrength } from './module-registry.ts';

/**
 * Keyboard ids the registry has actually verified SOCD for, at a given catalog
 * version. Derived from `MODULE_REGISTRY.verifiedFor` on every call — this replaced an
 * independently maintained flat set (D-02): a second, hand-kept list is exactly the
 * drift the project's cross-checked-table discipline exists to prevent.
 */
export function socdVerifiedKeyboards(catalogVersion: string): ReadonlySet<string> {
  const entry = MODULE_REGISTRY['qmkweb/socd_cleaner'];
  return new Set(
    entry.verifiedFor
      .filter((record) => record.catalogVersion === catalogVersion)
      .map((record) => record.keyboardId),
  );
}

export interface SocdCapabilities {
  available: boolean;
  /** Present only when unavailable, and always specific about why. */
  reason?: string;
  policies: readonly { id: string; label: string; description: string }[];
  verticalPairs: readonly (readonly [string, string])[];
  horizontalPairs: readonly (readonly [string, string])[];
  /**
   * The matched record's verification strength — compile-only or compile-and-hardware
   * (D-10). Present only when available. Additive: the UI does not render this, per the
   * UI contract; it exists so the two claims stay distinguishable in the data.
   */
  verification?: ModuleVerificationStrength;
}

function unavailable(reason: string): SocdCapabilities {
  return { available: false, reason, policies: [], verticalPairs: [], horizontalPairs: [] };
}

/**
 * What SOCD this keyboard can actually have, for a specific catalog version. The
 * honest answer for an unverified (catalogVersion, keyboardId) combination is an empty
 * policy list with a reason naming the catalog version, never a hopeful one.
 *
 * Availability requires an exact match against `MODULE_REGISTRY[...].verifiedFor` — no
 * default-allow branch, no wildcard record (T-04-05). A QMK pin bump publishes a new
 * catalog version (ADR-0001-qmk-pin: never an in-place mutation), so a keyboard that
 * was verified under the old catalog version has no record under the new one and
 * reports unavailable until `socd:matrix` re-runs and earns a fresh record — this is
 * what makes REQ-socd-policy-choices clause 7 structural rather than procedural (D-02).
 * The expected QMK commit for a match comes from the registry record itself, never
 * from the caller — there is no third `qmkCommit` parameter to spoof.
 */
export function socdCapabilitiesFor(catalogVersion: string, keyboardId: string): SocdCapabilities {
  const entry = MODULE_REGISTRY['qmkweb/socd_cleaner'];

  if (!entry.offered.enabled) {
    // D-09's phase-close switch: every keyboard is unavailable with the entry's own
    // reason, unchanged — this does not name the catalog version because it is not a
    // per-catalog-version fact.
    return unavailable(entry.offered.reason ?? 'SOCD is not currently offered.');
  }

  const record = entry.verifiedFor.find(
    (r) => r.catalogVersion === catalogVersion && r.keyboardId === keyboardId,
  );

  if (!record) {
    return unavailable(
      `SOCD has not been compile-verified for this keyboard on catalog version ${catalogVersion} yet. ` +
        'It is enabled only for keyboard/catalog-version combinations that have been through the SOCD compile matrix.',
    );
  }

  return {
    available: true,
    policies: SOCD_POLICIES,
    verticalPairs: SOCD_VERTICAL_PAIRS,
    horizontalPairs: SOCD_HORIZONTAL_PAIRS,
    verification: record.verification,
  };
}
