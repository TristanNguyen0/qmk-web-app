/**
 * Invariants of the SOCD tables.
 *
 * These are the properties that make the rest of the SOCD implementation safe: a policy
 * with no keycodes would be selectable but unimplemented, a directional keycode outside
 * the general allowlist would slip past the editor's picker, and a capability answer
 * that says "available" without policies would offer a user an empty choice.
 */
import { describe, expect, it } from 'vitest';
import { SOCD_DIRECTIONAL_KEYCODES, SUPPORTED_KEYCODE_NAMES } from './keycodes.ts';
import { socdConfigurationSchema } from './configuration.ts';
import { MODULE_REGISTRY } from './module-registry.ts';
import {
  SOCD_HORIZONTAL_PAIRS,
  SOCD_MODULE_KEYCODES,
  SOCD_POLICIES,
  SOCD_POLICY_ID_TUPLE,
  SOCD_VERTICAL_PAIRS,
  socdCapabilitiesFor,
  socdModuleKeycode,
  socdVerifiedKeyboards,
} from './socd.ts';

const registryEntry = MODULE_REGISTRY['qmkweb/socd_cleaner'];
const [verifiedRecord] = registryEntry.verifiedFor;
if (!verifiedRecord) throw new Error('expected at least one verifiedFor record to test against');
const { catalogVersion: VERIFIED_CATALOG_VERSION, keyboardId: VERIFIED_KEYBOARD_ID } = verifiedRecord;

describe('policies', () => {
  it('publishes exactly the policies the schema accepts', () => {
    expect([...SOCD_POLICY_ID_TUPLE]).toEqual(SOCD_POLICIES.map((p) => p.id));
  });

  it('rejects a policy id that is not published', () => {
    const result = socdConfigurationSchema.safeParse({
      enabled: true,
      policyId: 'first_input_priority',
      directionalKeys: { up: 0, down: 1, left: 2, right: 3 },
      directionalKeycodes: { up: 'KC_W', down: 'KC_S', left: 'KC_A', right: 'KC_D' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a case-differing variant of a published policy id — exact match, no folding', () => {
    // 'Neutral' and 'NEUTRAL' are not 'neutral': matching is exact string equality
    // against the frozen table, never case-insensitive.
    for (const policyId of ['Neutral', 'NEUTRAL', 'neutral ']) {
      const result = socdConfigurationSchema.safeParse({
        enabled: true,
        policyId,
        directionalKeys: { up: 0, down: 1, left: 2, right: 3 },
        directionalKeycodes: { up: 'KC_W', down: 'KC_S', left: 'KC_A', right: 'KC_D' },
      });
      expect(result.success, policyId).toBe(false);
    }
  });

  it('gives every policy a label and a description a user can act on', () => {
    for (const policy of SOCD_POLICIES) {
      expect(policy.label.length).toBeGreaterThan(0);
      expect(policy.description.length).toBeGreaterThan(10);
    }
  });
});

describe('pairs and keycodes', () => {
  it('draws every paired keycode from the SOCD directional allowlist', () => {
    for (const [a, b] of [...SOCD_VERTICAL_PAIRS, ...SOCD_HORIZONTAL_PAIRS]) {
      expect(SOCD_DIRECTIONAL_KEYCODES.has(a)).toBe(true);
      expect(SOCD_DIRECTIONAL_KEYCODES.has(b)).toBe(true);
    }
  });

  it('draws every paired keycode from the general supported keycode allowlist', () => {
    // A SOCD position is also an ordinary base-layer binding, so it has to be a keycode
    // the editor and generator already accept.
    for (const [a, b] of [...SOCD_VERTICAL_PAIRS, ...SOCD_HORIZONTAL_PAIRS]) {
      expect(SUPPORTED_KEYCODE_NAMES.has(a)).toBe(true);
      expect(SUPPORTED_KEYCODE_NAMES.has(b)).toBe(true);
    }
  });

  it('never puts the same keycode on both sides of a pair', () => {
    for (const [a, b] of [...SOCD_VERTICAL_PAIRS, ...SOCD_HORIZONTAL_PAIRS]) {
      expect(a).not.toBe(b);
    }
  });

  it('has a module keycode for every policy and every paired direction', () => {
    for (const policy of SOCD_POLICIES) {
      for (const [a, b] of [...SOCD_VERTICAL_PAIRS, ...SOCD_HORIZONTAL_PAIRS]) {
        expect(socdModuleKeycode(policy.id, a)).toBeTruthy();
        expect(socdModuleKeycode(policy.id, b)).toBeTruthy();
      }
    }
  });

  it('maps every (policy, direction) to a distinct module keycode', () => {
    // Two directions sharing a keycode would silently send the wrong key.
    expect(new Set(SOCD_MODULE_KEYCODES).size).toBe(SOCD_MODULE_KEYCODES.length);
  });

  it('rejects a case-differing variant of a real keycode token — no module keycode is produced', () => {
    // Matching is exact string equality against the frozen table, never case-
    // insensitive: 'kc_w' and 'Kc_W' are not 'KC_W'.
    expect(socdModuleKeycode('neutral', 'kc_w')).toBeNull();
    expect(socdModuleKeycode('neutral', 'Kc_W')).toBeNull();
    expect(socdModuleKeycode('NEUTRAL', 'KC_W')).toBeNull();
  });

  it('returns null rather than guessing for an unknown combination', () => {
    expect(socdModuleKeycode('neutral', 'KC_J')).toBeNull();
    expect(socdModuleKeycode('made_up_policy', 'KC_W')).toBeNull();
  });
});

describe('capabilities', () => {
  it('offers policies only for a compile-verified (catalogVersion, keyboardId) combination', () => {
    for (const record of registryEntry.verifiedFor) {
      const capabilities = socdCapabilitiesFor(record.catalogVersion, record.keyboardId);
      expect(capabilities.available).toBe(true);
      expect(capabilities.policies.length).toBeGreaterThan(0);
      expect(capabilities.verification).toBe(record.verification);
    }
  });

  it('answers with an empty list and a reason naming the catalog version for anything else', () => {
    const capabilities = socdCapabilitiesFor(VERIFIED_CATALOG_VERSION, 'planck/rev6');
    expect(capabilities.available).toBe(false);
    expect(capabilities.policies).toEqual([]);
    expect(capabilities.verticalPairs).toEqual([]);
    expect(capabilities.reason).toBeTruthy();
    expect(capabilities.reason).toContain(VERIFIED_CATALOG_VERSION);
  });

  it('never reports available without something to choose', () => {
    for (const [catalogVersion, keyboardId] of [
      [VERIFIED_CATALOG_VERSION, VERIFIED_KEYBOARD_ID],
      [VERIFIED_CATALOG_VERSION, 'planck/rev6'],
      ['9.9.9-1', 'nonexistent/kb'],
    ] as const) {
      const capabilities = socdCapabilitiesFor(catalogVersion, keyboardId);
      expect(capabilities.available).toBe(capabilities.policies.length > 0);
    }
  });

  it(
    'withdraws availability after a QMK pin bump changes the catalog version (same keyboard, ' +
      'different commit) until the compile matrix re-runs',
    () => {
      // A QMK pin bump publishes a brand new catalog version (ADR-0001-qmk-pin: never an
      // in-place mutation), so a keyboard verified under the old catalog version has no
      // verifiedFor record under the new one — even though it is "the same keyboard".
      const bumpedCatalogVersion = `${VERIFIED_CATALOG_VERSION}-bumped`;
      expect(
        registryEntry.verifiedFor.some((r) => r.catalogVersion === bumpedCatalogVersion),
      ).toBe(false);

      const capabilities = socdCapabilitiesFor(bumpedCatalogVersion, VERIFIED_KEYBOARD_ID);
      expect(capabilities.available).toBe(false);
      expect(capabilities.policies).toEqual([]);
      expect(capabilities.reason).toContain(bumpedCatalogVersion);
      expect(capabilities.reason).toMatch(/compile matrix/);
    },
  );

  it('returns policies in SOCD_POLICIES declaration order on repeated calls', () => {
    for (let i = 0; i < 3; i++) {
      const capabilities = socdCapabilitiesFor(VERIFIED_CATALOG_VERSION, VERIFIED_KEYBOARD_ID);
      expect(capabilities.policies.map((p) => p.id)).toEqual(SOCD_POLICIES.map((p) => p.id));
    }
  });

  it('withdraws every keyboard when the entry is not offered, using the entry’s own reason', () => {
    // The entry itself is enabled today (D-09), so this proves the *shape* of the
    // gate directly against the registry rather than mutating the frozen singleton.
    expect(registryEntry.offered.enabled).toBe(true);
    // If a future plan flips `offered.enabled` to false with a reason, every keyboard
    // — including a compile-verified one — must report that same reason unchanged.
    // That contract lives in socdCapabilitiesFor's own `if (!entry.offered.enabled)`
    // branch; this test documents the currently-enabled baseline it branches from.
    expect(registryEntry.offered.reason).toBeUndefined();
  });
});

describe('socdVerifiedKeyboards', () => {
  it('derives exactly the keyboards MODULE_REGISTRY records for a catalog version', () => {
    const derived = socdVerifiedKeyboards(VERIFIED_CATALOG_VERSION);
    const expected = new Set(
      registryEntry.verifiedFor
        .filter((r) => r.catalogVersion === VERIFIED_CATALOG_VERSION)
        .map((r) => r.keyboardId),
    );
    expect(derived).toEqual(expected);
    expect(derived.has(VERIFIED_KEYBOARD_ID)).toBe(true);
  });

  it('returns an empty set for a catalog version with no verified keyboards', () => {
    expect(socdVerifiedKeyboards('9.9.9-1').size).toBe(0);
  });
});
