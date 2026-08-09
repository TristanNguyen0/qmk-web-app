/**
 * The allowlist-vs-reality test.
 *
 * claude.md rule 2 forbids inventing keycodes, and the working checklist says to
 * "inspect the pinned QMK feature/API rather than relying on remembered snippets".
 * This test is the enforcement: every keycode the product offers must exist in the
 * keycode spec extracted from the pinned revision, and every keycode usable in a
 * macro must have a matching SEND_STRING `X_` name.
 *
 * If a QMK bump renames or drops a keycode, this fails at test time rather than
 * producing a keymap that cannot compile.
 */
import { describe, expect, it } from 'vitest';
import { readKeycodeSpec, readSendStringNames } from '@qmk-web-app/qmk-fixtures';
import { MOD_TAP_MODIFIERS, SOCD_DIRECTIONAL_KEYCODES, SUPPORTED_KEYCODES } from './keycodes.ts';

function keycodeNamesFromSpec(): Set<string> {
  const spec = readKeycodeSpec();
  const names = new Set<string>();
  for (const entry of Object.values(spec.keycodes)) {
    if (typeof entry.key === 'string') names.add(entry.key);
    if (Array.isArray(entry.aliases)) {
      for (const alias of entry.aliases) {
        if (typeof alias === 'string' && !alias.startsWith('!')) names.add(alias);
      }
    }
  }
  return names;
}

describe('supported keycode catalog', () => {
  const pinned = keycodeNamesFromSpec();

  it('the pinned spec fixture is non-trivial', () => {
    expect(pinned.size).toBeGreaterThan(500);
  });

  it('every allowlisted keycode exists in the pinned QMK keycode spec', () => {
    const missing = SUPPORTED_KEYCODES.map((k) => k.name).filter((name) => !pinned.has(name));
    expect(missing).toEqual([]);
  });

  it('every mod-tap modifier is also an allowlisted keycode', () => {
    const allowlisted = new Set(SUPPORTED_KEYCODES.map((k) => k.name));
    for (const mod of MOD_TAP_MODIFIERS) {
      expect(allowlisted.has(mod), mod).toBe(true);
    }
  });

  it('every SOCD directional keycode is allowlisted and pinned', () => {
    const allowlisted = new Set(SUPPORTED_KEYCODES.map((k) => k.name));
    for (const key of SOCD_DIRECTIONAL_KEYCODES) {
      expect(allowlisted.has(key), `${key} allowlisted`).toBe(true);
      expect(pinned.has(key), `${key} in pinned spec`).toBe(true);
    }
  });

  it('has no duplicate names', () => {
    const names = SUPPORTED_KEYCODES.map((k) => k.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every keycode has a matching SEND_STRING X_ name so it is macro-safe', () => {
    // Generation derives the macro spelling by swapping the KC_ prefix for X_
    // (see qmk-generator sendStringName). That derivation must hold for every
    // keycode we let a user put in a macro.
    const sendString = readSendStringNames();
    const missing = SUPPORTED_KEYCODES.filter(
      (k) => k.group !== 'special' && !sendString.has(`X_${k.name.slice(3)}`),
    ).map((k) => k.name);
    expect(missing).toEqual([]);
  });
});
