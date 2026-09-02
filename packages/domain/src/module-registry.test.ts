/**
 * Invariants of the curated module registry.
 *
 * These are the properties `REQ-curated-module-registry` demands: exactly one entry,
 * every one of the seven fields present, everything deeply frozen so a capability
 * lookup can never observe a partially updated registry, and a single earned
 * compile-only verification claim.
 */
import { describe, expect, it } from 'vitest';
import { assertValidOfferState, MODULE_REGISTRY, type CuratedModuleEntry } from './module-registry.ts';

const REQUIRED_FIELDS = [
  'sourceRevision',
  'license',
  'minimumHookApiVersion',
  'generatedContract',
  'compatibilityTests',
  'supportedOptions',
  'prerequisites',
] as const;

function assertDeepFrozen(value: unknown, path: string): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value), `${path} is not frozen`).toBe(true);
  for (const [key, nested] of Object.entries(value)) {
    assertDeepFrozen(nested, `${path}.${key}`);
  }
}

function isNonEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

describe('MODULE_REGISTRY shape', () => {
  it('has exactly one entry', () => {
    expect(Object.keys(MODULE_REGISTRY)).toEqual(['qmkweb/socd_cleaner']);
  });

  it('names the entry after the module id key', () => {
    expect(MODULE_REGISTRY['qmkweb/socd_cleaner'].moduleId).toBe('qmkweb/socd_cleaner');
  });

  it('carries every field REQ-curated-module-registry demands, none empty', () => {
    const entry = MODULE_REGISTRY['qmkweb/socd_cleaner'] as unknown as Record<string, unknown>;
    for (const field of REQUIRED_FIELDS) {
      expect(isNonEmpty(entry[field]), `${field} must be present and non-empty`).toBe(true);
    }
  });

  it('is deeply frozen — the outer registry, the entry, and every nested value', () => {
    assertDeepFrozen(MODULE_REGISTRY, 'MODULE_REGISTRY');
  });

  it('throws on a mutation attempt and leaves the observed value unchanged', () => {
    const entry = MODULE_REGISTRY['qmkweb/socd_cleaner'];
    expect(() => {
      // @ts-expect-error intentional mutation attempt against a frozen object
      entry.license = 'MIT';
    }).toThrow(TypeError);
    expect(entry.license).toBe('GPL-2.0-or-later');

    expect(() => {
      // @ts-expect-error intentional mutation attempt against a frozen array
      entry.verifiedFor.push({});
    }).toThrow(TypeError);
    expect(entry.verifiedFor).toHaveLength(2);
  });
});

describe('verifiedFor', () => {
  it('records both crkbd/rev1 and mode/m256wh, compile-only, on catalog 0.33.13-1', () => {
    const entry = MODULE_REGISTRY['qmkweb/socd_cleaner'];
    expect(entry.verifiedFor).toHaveLength(2);

    const byKeyboard = new Map(entry.verifiedFor.map((r) => [r.keyboardId, r]));
    expect([...byKeyboard.keys()].sort()).toEqual(['crkbd/rev1', 'mode/m256wh']);

    for (const keyboardId of ['crkbd/rev1', 'mode/m256wh'] as const) {
      const record = byKeyboard.get(keyboardId);
      expect(record?.catalogVersion).toBe('0.33.13-1');
      expect(record?.qmkCommit).toBe('332fa30e173e5b0ecc0c70ff166974b6db86525e');
      expect(record?.verification).toBe('compile');
      expect(record?.evidence).toBeTruthy();
    }
  });

  it('carries no compile+hardware record anywhere yet (D-09)', () => {
    const entry = MODULE_REGISTRY['qmkweb/socd_cleaner'];
    expect(entry.verifiedFor.some((r) => r.verification === 'compile+hardware')).toBe(false);
  });
});

describe('offered', () => {
  it('is enabled with no reason for the shipped entry', () => {
    const { offered } = MODULE_REGISTRY['qmkweb/socd_cleaner'];
    expect(offered.enabled).toBe(true);
    expect(offered.reason).toBeUndefined();
  });

  it('accepts an enabled state with no reason', () => {
    expect(() => assertValidOfferState({ enabled: true })).not.toThrow();
  });

  it('accepts a disabled state with a reason', () => {
    expect(() => assertValidOfferState({ enabled: false, reason: 'hardware run pending' })).not.toThrow();
  });

  it('rejects a disabled state with no reason', () => {
    expect(() => assertValidOfferState({ enabled: false })).toThrow(/reason/);
  });

  it('rejects an enabled state that carries a reason', () => {
    expect(() => assertValidOfferState({ enabled: true, reason: 'should not be here' })).toThrow();
  });
});

describe('supportedOptions references socd.ts rather than restating it', () => {
  it('is the same array reference SOCD_POLICIES exports', async () => {
    const { SOCD_POLICIES } = await import('./socd.ts');
    expect(MODULE_REGISTRY['qmkweb/socd_cleaner'].supportedOptions.policies).toBe(SOCD_POLICIES);
  });
});

describe('type export sanity', () => {
  it('CuratedModuleEntry describes the shipped entry', () => {
    const entry: CuratedModuleEntry = MODULE_REGISTRY['qmkweb/socd_cleaner'];
    expect(entry.moduleId).toBe('qmkweb/socd_cleaner');
  });
});
