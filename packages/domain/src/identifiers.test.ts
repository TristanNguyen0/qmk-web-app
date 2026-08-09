import { describe, expect, it } from 'vitest';
import {
  IdentifierError,
  assertValidKeyboardIdShape,
  assertValidLayoutName,
  generatedKeymapName,
  isValidKeyboardIdShape,
  resolveKeyboardPathSegments,
} from './identifiers.ts';

describe('keyboard id validation', () => {
  it('accepts real QMK keyboard ids', () => {
    for (const id of ['planck/rev6', 'crkbd/rev1', 'handwired/onekey/promicro', '1k', '0_sixty']) {
      expect(isValidKeyboardIdShape(id), id).toBe(true);
    }
  });

  it('rejects path traversal in every form', () => {
    const attacks = [
      '../etc/passwd',
      'planck/../../etc',
      'planck/./rev6',
      '..',
      '.',
      '/absolute/path',
      'planck//rev6',
      'planck/',
      '/planck',
    ];
    for (const attack of attacks) {
      expect(isValidKeyboardIdShape(attack), attack).toBe(false);
    }
  });

  it('rejects separators, NULs and control characters', () => {
    const attacks = [
      'planck\0rev6',
      'planck\nrev6',
      'planck\trev6',
      'planck rev6',
      'planck\\rev6',
      'planck;rm -rf /',
      'planck$(whoami)',
      'planck`id`',
      'planck|rev6',
      'planck:rev6',
    ];
    for (const attack of attacks) {
      expect(isValidKeyboardIdShape(attack), attack).toBe(false);
    }
  });

  it('rejects non-NFC unicode rather than normalising it', () => {
    // Decomposed "é". Silently normalising would let two different inputs map to one
    // filesystem path.
    expect(isValidKeyboardIdShape('café/rev1')).toBe(false);
  });

  it('rejects uppercase, over-long ids and too many segments', () => {
    expect(isValidKeyboardIdShape('Planck/rev6')).toBe(false);
    expect(isValidKeyboardIdShape(`${'a'.repeat(129)}`)).toBe(false);
    expect(isValidKeyboardIdShape('a/b/c/d/e/f/g/h/i')).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(isValidKeyboardIdShape(value)).toBe(false);
    }
    expect(() => assertValidKeyboardIdShape(null)).toThrow(IdentifierError);
  });
});

describe('resolveKeyboardPathSegments', () => {
  const known = new Set(['planck/rev6', 'crkbd/rev1']);

  it('returns segments for a keyboard present in the catalog', () => {
    expect(resolveKeyboardPathSegments('planck/rev6', known)).toEqual(['planck', 'rev6']);
  });

  it('refuses a well-formed id that is not in the catalog (rule 5)', () => {
    // This is the core of claude.md rule 5: shape alone never authorises a path.
    expect(() => resolveKeyboardPathSegments('planck/rev7', known)).toThrow(IdentifierError);
  });

  it('refuses a malformed id even if somehow present in the catalog set', () => {
    expect(() => resolveKeyboardPathSegments('../evil', new Set(['../evil']))).toThrow(
      IdentifierError,
    );
  });
});

describe('layout name validation', () => {
  it('accepts real QMK layout macros', () => {
    for (const name of ['LAYOUT', 'LAYOUT_split_3x6_3', 'LAYOUT_ortho_4x12', 'LAYOUT_planck_1x2uC']) {
      expect(() => assertValidLayoutName(name)).not.toThrow();
    }
  });

  it('rejects anything that is not a LAYOUT macro', () => {
    for (const name of ['layout_split', 'MYLAYOUT', 'LAYOUT-split', 'LAYOUT split', '../LAYOUT']) {
      expect(() => assertValidLayoutName(name), name).toThrow(IdentifierError);
    }
  });
});

describe('generatedKeymapName', () => {
  it('derives a safe fixed-shape name from a build id', () => {
    expect(generatedKeymapName('aaaaaaaa-0000-4000-8000-000000000001')).toBe(
      'qwa_aaaaaaaa000040008000000000000001',
    );
  });

  it('is deterministic', () => {
    const id = 'aaaaaaaa-0000-4000-8000-000000000001';
    expect(generatedKeymapName(id)).toBe(generatedKeymapName(id));
  });

  it('refuses build ids that are not hex/UUID, so user text can never become a path', () => {
    for (const bad of ['../evil', 'my keymap', 'default', '', 'zzzz']) {
      expect(() => generatedKeymapName(bad), bad).toThrow(IdentifierError);
    }
  });
});
