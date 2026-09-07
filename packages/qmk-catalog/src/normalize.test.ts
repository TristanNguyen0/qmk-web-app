import { describe, expect, it } from 'vitest';
import {
  FIXTURE_QMK_COMMIT,
  readExtractSampleNdjson,
  readKeycodeSpec,
} from '@qmk-web-app/qmk-fixtures';
import {
  CatalogNormalizationError,
  normalizeCatalog,
  parseExtractorDump,
  type ExtractorRecord,
} from './normalize.ts';

const OPTIONS = {
  catalogVersion: '0.33.13-4',
  expectedQmkCommit: FIXTURE_QMK_COMMIT,
  generatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * The fixtures store the keycode spec separately from the keyboard records (it is
 * large and shared), so reassemble a complete dump here.
 */
function records(): ExtractorRecord[] {
  return [
    ...parseExtractorDump(readExtractSampleNdjson()),
    readKeycodeSpec() as ExtractorRecord,
  ];
}

/** Builds a dump with a single synthetic keyboard record on top of real provenance. */
function withKeyboard(keyboard: Record<string, unknown>): ExtractorRecord[] {
  const base = records().filter((r) => r.type !== 'keyboard');
  return [...base, keyboard as ExtractorRecord];
}

describe('normalizing real extractor output', () => {
  it('normalizes the pinned fixture into supported keyboards', () => {
    const catalog = normalizeCatalog(records(), OPTIONS);
    expect(catalog.qmkCommit).toBe(FIXTURE_QMK_COMMIT);
    expect(catalog.keyboards).toHaveLength(2);
    expect(catalog.keyboards.every((k) => k.supported)).toBe(true);
  });

  it('preserves real layout geometry rather than inventing it', () => {
    const catalog = normalizeCatalog(records(), OPTIONS);
    const crkbd = catalog.keyboards.find((k) => k.keyboardId === 'crkbd/rev1');
    expect(crkbd?.supported).toBe(true);
    if (!crkbd?.supported) return;

    const layout = crkbd.layouts.find((l) => l.name === 'LAYOUT_split_3x6_3');
    expect(layout?.positions).toHaveLength(42);
    // Position indices are dense and ordered — configurations bind to these.
    expect(layout?.positions.map((p) => p.index)).toEqual([...Array(42).keys()]);
    expect(crkbd.processor).toBe('atmega32u4');
    expect(crkbd.bootloader).toBe('caterina');
  });

  it('is deterministic and sorts keyboards by id', () => {
    const a = normalizeCatalog(records(), OPTIONS);
    const b = normalizeCatalog(records(), OPTIONS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const ids = a.keyboards.map((k) => k.keyboardId);
    expect(ids).toEqual([...ids].sort());
  });

  it('records provenance for every supported keyboard', () => {
    const catalog = normalizeCatalog(records(), OPTIONS);
    for (const kb of catalog.keyboards) {
      if (!kb.supported) continue;
      expect(kb.provenance.qmkCommit).toBe(FIXTURE_QMK_COMMIT);
      expect(kb.provenance.keyboardFolder).toBeTruthy();
    }
  });
});

describe('refusing to fabricate metadata', () => {
  it('marks a keyboard unsupported when QMK reported parse errors', () => {
    const catalog = normalizeCatalog(
      withKeyboard({
        type: 'keyboard',
        keyboardId: 'broken/kb',
        status: 'resolved',
        info: { parse_errors: ['bad info.json'], processor: 'atmega32u4', bootloader: 'caterina' },
      }),
      OPTIONS,
    );
    const kb = catalog.keyboards[0]!;
    expect(kb.supported).toBe(false);
    if (!kb.supported) expect(kb.reason).toBe('qmk_parse_errors');
  });

  it('marks a keyboard unsupported when the build target is incomplete', () => {
    for (const info of [
      { layouts: { LAYOUT: { layout: [{ matrix: [0, 0], x: 0, y: 0 }] } }, bootloader: 'caterina' },
      { layouts: { LAYOUT: { layout: [{ matrix: [0, 0], x: 0, y: 0 }] } }, processor: 'atmega32u4' },
    ]) {
      const catalog = normalizeCatalog(
        withKeyboard({ type: 'keyboard', keyboardId: 'partial/kb', status: 'resolved', info }),
        OPTIONS,
      );
      const kb = catalog.keyboards[0]!;
      expect(kb.supported).toBe(false);
      if (!kb.supported) expect(kb.reason).toBe('missing_build_target');
    }
  });

  it('rejects a layout whose positions are unusable instead of repairing them', () => {
    const catalog = normalizeCatalog(
      withKeyboard({
        type: 'keyboard',
        keyboardId: 'bad/layout',
        status: 'resolved',
        info: {
          processor: 'atmega32u4',
          bootloader: 'caterina',
          // Missing x/y — a key we cannot place must not be drawn at a guessed spot.
          layouts: { LAYOUT: { layout: [{ matrix: [0, 0] }] } },
        },
      }),
      OPTIONS,
    );
    const kb = catalog.keyboards[0]!;
    expect(kb.supported).toBe(false);
    if (!kb.supported) expect(kb.reason).toBe('layout_position_invalid');
  });

  it('propagates extraction failures as unsupported entries', () => {
    const catalog = normalizeCatalog(
      withKeyboard({
        type: 'keyboard',
        keyboardId: 'exploding/kb',
        status: 'extraction_failed',
        error: { kind: 'KeyError', message: 'boom' },
      }),
      OPTIONS,
    );
    const kb = catalog.keyboards[0]!;
    expect(kb.supported).toBe(false);
    if (!kb.supported) {
      expect(kb.reason).toBe('extraction_failed');
      expect(kb.detail).toContain('boom');
    }
  });
});

describe('provenance enforcement', () => {
  it('refuses a dump whose commit differs from the pinned one', () => {
    expect(() =>
      normalizeCatalog(records(), { ...OPTIONS, expectedQmkCommit: 'b'.repeat(40) }),
    ).toThrow(CatalogNormalizationError);
  });

  it('refuses a dump with no provenance record', () => {
    const withoutProvenance = records().filter((r) => r.type !== 'provenance');
    expect(() => normalizeCatalog(withoutProvenance, OPTIONS)).toThrow(CatalogNormalizationError);
  });

  it('refuses malformed NDJSON rather than silently dropping keyboards', () => {
    expect(() => parseExtractorDump('{"type":"provenance"}\n{not json}\n')).toThrow(
      CatalogNormalizationError,
    );
  });
});

describe('default keymaps', () => {
  const TWO_KEY_INFO = {
    processor: 'atmega32u4',
    bootloader: 'caterina',
    layouts: {
      LAYOUT_a: { layout: [{ matrix: [0, 0], x: 0, y: 0 }, { matrix: [0, 1], x: 1, y: 0 }] },
    },
    layout_aliases: { LAYOUT: 'LAYOUT_a' },
  };

  function defaultKeymapOf(record: Record<string, unknown>) {
    const kb = normalizeCatalog(withKeyboard(record), OPTIONS).keyboards[0]!;
    if (!kb.supported) throw new Error('expected supported');
    return kb.defaultKeymap;
  }

  it('carries the real default keymap from the fixture, verbatim', () => {
    const catalog = normalizeCatalog(records(), OPTIONS);
    const planck = catalog.keyboards.find((k) => k.keyboardId === 'planck/rev6');
    if (!planck?.supported) throw new Error('expected planck/rev6 supported');
    const dk = planck.defaultKeymap;
    expect(dk.available).toBe(true);
    if (!dk.available) return;
    expect(dk.source).toBe('keyboards/planck/keymaps/default/keymap.c');
    // Written as LAYOUT_planck_grid; resolved through QMK's own layout_aliases.
    expect(dk.layout).toBe('LAYOUT_ortho_4x12');
    expect(dk.layers.map((l) => l.name)).toEqual([
      '_QWERTY', '_COLEMAK', '_DVORAK', '_LOWER', '_RAISE', '_PLOVER', '_ADJUST',
    ]);
    for (const layer of dk.layers) expect(layer.keycodes).toHaveLength(48);
    // Aliases are not resolved here — that is interpretation, and belongs downstream.
    expect(dk.layers[0]!.keycodes.slice(0, 3)).toEqual(['KC_TAB', 'KC_Q', 'KC_W']);
    expect(dk.layers[0]!.keycodes).toContain('KC_BSPC');
  });

  it('publishes QMK\u2019s alias table from the keycode spec', () => {
    const catalog = normalizeCatalog(records(), OPTIONS);
    expect(catalog.keycodeAliases['KC_BSPC']).toBe('KC_BACKSPACE');
    expect(catalog.keycodeAliases['_______']).toBe('KC_TRANSPARENT');
    expect(catalog.keycodeAliases['XXXXXXX']).toBe('KC_NO');
    expect(Object.keys(catalog.keycodeAliases)).toEqual([...Object.keys(catalog.keycodeAliases)].sort());
  });

  it('is unavailable, with the reason, for a v1 dump that has no default keymap', () => {
    const dk = defaultKeymapOf({ type: 'keyboard', keyboardId: 'v1/kb', status: 'resolved', info: TWO_KEY_INFO });
    expect(dk).toMatchObject({ available: false, reason: 'not_extracted' });
  });

  it('records not_found and failed as reported by the extractor', () => {
    expect(
      defaultKeymapOf({ type: 'keyboard', keyboardId: 'x/kb', status: 'resolved', info: TWO_KEY_INFO, default_keymap: { status: 'not_found' } }),
    ).toMatchObject({ available: false, reason: 'not_found' });
    expect(
      defaultKeymapOf({
        type: 'keyboard', keyboardId: 'x/kb', status: 'resolved', info: TWO_KEY_INFO,
        default_keymap: { status: 'failed', error: { kind: 'CppError', message: 'boom' } },
      }),
    ).toMatchObject({ available: false, reason: 'extraction_failed', detail: 'CppError: boom' });
  });

  it('resolves the layout through layout_aliases and keeps layer names', () => {
    const dk = defaultKeymapOf({
      type: 'keyboard', keyboardId: 'x/kb', status: 'resolved', info: TWO_KEY_INFO,
      default_keymap: {
        status: 'resolved', source: 'keyboards/x/keymaps/default/keymap.c', format: 'c',
        layers: [{ name: '_BASE', layout: 'LAYOUT', keycodes: ['KC_A', 'MO(1)'] }, { name: '1', layout: 'LAYOUT', keycodes: ['_______', 'KC_B'] }],
      },
    });
    expect(dk).toEqual({
      available: true,
      source: 'keyboards/x/keymaps/default/keymap.c',
      layout: 'LAYOUT_a',
      layers: [{ name: '_BASE', keycodes: ['KC_A', 'MO(1)'] }, { name: '1', keycodes: ['_______', 'KC_B'] }],
    });
  });

  it('refuses a keymap that does not line up with the layout rather than trimming it', () => {
    const base = { type: 'keyboard', keyboardId: 'x/kb', status: 'resolved', info: TWO_KEY_INFO };
    const resolved = (layers: unknown) => ({
      ...base,
      default_keymap: { status: 'resolved', source: 's', format: 'c', layers },
    });
    expect(defaultKeymapOf(resolved([{ name: '0', layout: 'LAYOUT', keycodes: ['KC_A'] }]))).toMatchObject({
      available: false, reason: 'layer_length_mismatch',
    });
    expect(defaultKeymapOf(resolved([{ name: '0', layout: 'LAYOUT_nope', keycodes: ['KC_A', 'KC_B'] }]))).toMatchObject({
      available: false, reason: 'unknown_layout',
    });
    expect(
      defaultKeymapOf(resolved([
        { name: '0', layout: 'LAYOUT', keycodes: ['KC_A', 'KC_B'] },
        { name: '1', layout: 'LAYOUT_a', keycodes: ['KC_A', 'KC_B'] },
      ])),
    ).toMatchObject({ available: false, reason: 'mixed_layouts' });
    expect(defaultKeymapOf(resolved([]))).toMatchObject({ available: false, reason: 'no_layers' });
    expect(defaultKeymapOf(resolved([{ name: '0', layout: 'LAYOUT', keycodes: ['KC_A', 42] }]))).toMatchObject({
      available: false, reason: 'unreadable_keycode',
    });
    expect(defaultKeymapOf(resolved([{ name: '0', layout: 'LAYOUT', keycodes: ['KC_A', 'X'.repeat(65)] }]))).toMatchObject({
      available: false, reason: 'unreadable_keycode',
    });
  });

  it('a default keymap problem never makes the keyboard itself unsupported', () => {
    const kb = normalizeCatalog(
      withKeyboard({ type: 'keyboard', keyboardId: 'x/kb', status: 'resolved', info: TWO_KEY_INFO, default_keymap: { status: 'failed', error: { kind: 'E', message: 'm' } } }),
      OPTIONS,
    ).keyboards[0]!;
    expect(kb.supported).toBe(true);
  });
});

describe('community-layout keymaps', () => {
  it('carries QMK’s canonical keymaps and records which fit each keyboard, through layout_aliases', () => {
    const catalog = normalizeCatalog(records(), OPTIONS);
    expect(Object.keys(catalog.communityKeymaps).length).toBeGreaterThan(90);
    expect(Object.keys(catalog.communityKeymaps)).toEqual([...Object.keys(catalog.communityKeymaps)].sort());

    const hhkb = catalog.communityKeymaps['60_hhkb'];
    expect(hhkb?.source).toBe('layouts/default/60_hhkb/default_60_hhkb/keymap.c');
    expect(hhkb?.layers).toHaveLength(2);
    expect(hhkb?.layers[0]?.keycodes.slice(0, 3)).toEqual(['KC_ESC', 'KC_1', 'KC_2']);
    for (const layer of hhkb!.layers) expect(layer.keycodes).toHaveLength(60);
    // Geometry from layouts/default/60_hhkb/info.json, one entry per key, w/h defaulted to 1.
    expect(hhkb?.positions).toHaveLength(60);
    expect(hhkb?.positions[0]).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(hhkb?.positions[14]).toEqual({ x: 14, y: 0, w: 1, h: 1 }); // the split backspace's second 1u
    // 60_abnt2 needs a locale header cpp cannot resolve — absent, not guessed.
    expect(catalog.communityKeymaps['60_abnt2']).toBeUndefined();
    // The ortho grids' defaults are `KC_A, KC_B, …` compile patterns, not arrangements.
    expect(catalog.communityKeymaps['ortho_4x12']).toBeUndefined();
    expect(catalog.communityKeymaps['ortho_5x12']).toBeUndefined();
    expect(catalog.communityKeymaps['split_3x6_3']).toBeDefined();

    const planck = catalog.keyboards.find((k) => k.keyboardId === 'planck/rev6');
    if (!planck?.supported) throw new Error('expected planck/rev6');
    // planck_mit resolves through the keyboard's own alias to LAYOUT_planck_1x2uC;
    // ortho_4x12 is declared but its keymap is a placeholder, so it is not offered.
    expect(planck.communityLayouts).toEqual([{ name: 'planck_mit', layout: 'LAYOUT_planck_1x2uC' }]);
  });

  it('offers a community layout only when the keymap fits the keyboard’s macro', () => {
    const base = records().filter((r) => r.type !== 'keyboard');
    const twoKey = { layout: [{ matrix: [0, 0], x: 0, y: 0 }, { matrix: [0, 1], x: 1, y: 0 }] };
    const catalog = normalizeCatalog(
      [
        ...base,
        { type: 'community_keymap', layout: 'pair', status: 'resolved', source: 's', positions: [{ x: 0, y: 0 }, { x: 1, y: 0 }], layers: [{ name: '0', layout: 'LAYOUT_pair', keycodes: ['KC_A', 'KC_B'] }] },
        { type: 'community_keymap', layout: 'trio', status: 'resolved', source: 's', positions: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], layers: [{ name: '0', layout: 'LAYOUT_trio', keycodes: ['KC_A', 'KC_B', 'KC_C'] }] },
        // Geometry that does not match the keymap: rejected rather than laid onto the wrong switches.
        { type: 'community_keymap', layout: 'nogeo', status: 'resolved', source: 's', positions: [{ x: 0, y: 0 }], layers: [{ name: '0', layout: 'LAYOUT_nogeo', keycodes: ['KC_A', 'KC_B'] }] },
        { type: 'community_keymap', layout: 'wrong_macro', status: 'resolved', source: 's', layers: [{ name: '0', layout: 'LAYOUT', keycodes: ['KC_A', 'KC_B'] }] },
        { type: 'community_keymap', layout: 'broken', status: 'failed', error: { kind: 'CppError', message: 'x' } },
        { type: 'community_keymap', layout: 'pattern', status: 'resolved', source: 's', positions: [{ x: 0, y: 0 }, { x: 1, y: 0 }], layers: [{ name: '0', layout: 'LAYOUT_pattern', keycodes: ['KC_A', 'KC_A'] }] },
        {
          type: 'keyboard',
          keyboardId: 'x/kb',
          status: 'resolved',
          info: {
            processor: 'atmega32u4',
            bootloader: 'caterina',
            layouts: { LAYOUT_pair: twoKey, LAYOUT_trio: twoKey, LAYOUT_pattern: twoKey },
            // trio: declared but its keymap has 3 keys for a 2-key macro. pattern: placeholder.
            community_layouts: ['pair', 'trio', 'wrong_macro', 'broken', 'pattern', 'undeclared_missing'],
          },
        },
      ] as ExtractorRecord[],
      OPTIONS,
    );
    expect(Object.keys(catalog.communityKeymaps).filter((n) => ['pair', 'trio', 'wrong_macro', 'broken', 'pattern', 'nogeo'].includes(n))).toEqual(['pair', 'trio']);
    const kb = catalog.keyboards.find((k) => k.keyboardId === 'x/kb');
    if (!kb?.supported) throw new Error('expected supported');
    expect(kb.communityLayouts).toEqual([{ name: 'pair', layout: 'LAYOUT_pair' }]);
  });
});
