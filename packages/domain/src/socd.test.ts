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
import {
  SOCD_HORIZONTAL_PAIRS,
  SOCD_MODULE_KEYCODES,
  SOCD_POLICIES,
  SOCD_POLICY_ID_TUPLE,
  SOCD_VERIFIED_KEYBOARDS,
  SOCD_VERTICAL_PAIRS,
  socdCapabilitiesFor,
  socdModuleKeycode,
} from './socd.ts';

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

  it('returns null rather than guessing for an unknown combination', () => {
    expect(socdModuleKeycode('neutral', 'KC_J')).toBeNull();
    expect(socdModuleKeycode('made_up_policy', 'KC_W')).toBeNull();
  });
});

describe('capabilities', () => {
  it('offers policies only for a compile-verified keyboard', () => {
    for (const keyboardId of SOCD_VERIFIED_KEYBOARDS) {
      const capabilities = socdCapabilitiesFor(keyboardId);
      expect(capabilities.available).toBe(true);
      expect(capabilities.policies.length).toBeGreaterThan(0);
    }
  });

  it('answers with an empty list and a reason for anything else', () => {
    const capabilities = socdCapabilitiesFor('planck/rev6');
    expect(capabilities.available).toBe(false);
    expect(capabilities.policies).toEqual([]);
    expect(capabilities.verticalPairs).toEqual([]);
    expect(capabilities.reason).toBeTruthy();
  });

  it('never reports available without something to choose', () => {
    for (const keyboardId of ['crkbd/rev1', 'planck/rev6', 'nonexistent/kb']) {
      const capabilities = socdCapabilitiesFor(keyboardId);
      expect(capabilities.available).toBe(capabilities.policies.length > 0);
    }
  });
});
