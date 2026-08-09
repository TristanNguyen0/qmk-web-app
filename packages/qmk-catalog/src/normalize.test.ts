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
  catalogVersion: '0.33.13-1',
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
