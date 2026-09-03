import { describe, expect, it } from 'vitest';
import { DomainError, ERROR_CODES } from './errors.ts';
import {
  CONFIGURATION_FILE_FORMAT_VERSION,
  parseConfigurationFile,
  toConfigurationFile,
  type ConfigurationFileDocument,
} from './configuration-file.ts';

function sampleDocument(
  overrides: Partial<ConfigurationFileDocument> = {},
): ConfigurationFileDocument {
  return {
    name: 'My Config',
    catalogVersion: '2026.01.0',
    qmkCommit: '332fa30e173e5b0ecc0c70ff166974b6db86525e',
    keyboardId: 'crkbd/rev1',
    layoutId: 'LAYOUT_split_3x6_3',
    layers: [
      {
        id: '33333333-3333-4333-8333-333333333331',
        index: 0,
        name: 'Base',
        bindings: { '0': { kind: 'keycode', keycode: 'KC_A' } },
      },
    ],
    macros: [],
    socd: null,
    ...overrides,
  };
}

const FORBIDDEN_FIELDS = [
  'id',
  'ownerId',
  'revision',
  'schemaVersion',
  'createdAt',
  'updatedAt',
  'isDraft',
  'generatorVersion',
] as const;

describe('toConfigurationFile', () => {
  it('produces an envelope with formatVersion, exportedAt, and exactly the eight content fields', () => {
    const file = toConfigurationFile(sampleDocument());
    expect(file.formatVersion).toBe(CONFIGURATION_FILE_FORMAT_VERSION);
    expect(typeof file.exportedAt).toBe('string');
    expect(() => new Date(file.exportedAt).toISOString()).not.toThrow();
    expect(Object.keys(file.configuration)).toHaveLength(8);
    expect(Object.keys(file.configuration).sort()).toEqual(
      ['catalogVersion', 'keyboardId', 'layers', 'layoutId', 'macros', 'name', 'qmkCommit', 'socd'].sort(),
    );
  });
});

describe('parseConfigurationFile', () => {
  it('round-trips: parse(toConfigurationFile(record)) returns the eight fields unchanged', () => {
    const record = sampleDocument();
    const roundTripped = parseConfigurationFile(toConfigurationFile(record));
    expect(roundTripped).toEqual(record);
  });

  it.each([
    ['a non-object (string)', 'not an object'],
    ['a non-object (number)', 42],
    ['an array', []],
    ['null', null],
  ])('throws CONFIG_INVALID for %s', (_label, value) => {
    expect(() => parseConfigurationFile(value)).toThrow(DomainError);
    try {
      parseConfigurationFile(value);
      expect.unreachable('expected parseConfigurationFile to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(ERROR_CODES.CONFIG_INVALID);
      expect((error as DomainError).fieldErrors.length).toBeGreaterThan(0);
    }
  });

  it('throws CONFIG_INVALID when formatVersion is missing', () => {
    const envelope = { exportedAt: new Date().toISOString(), configuration: sampleDocument() };
    try {
      parseConfigurationFile(envelope);
      expect.unreachable('expected parseConfigurationFile to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(ERROR_CODES.CONFIG_INVALID);
      expect((error as DomainError).fieldErrors.some((f) => f.path === 'formatVersion')).toBe(true);
    }
  });

  it('throws CONFIG_INVALID when formatVersion is not a number', () => {
    const envelope = {
      formatVersion: '1',
      exportedAt: new Date().toISOString(),
      configuration: sampleDocument(),
    };
    try {
      parseConfigurationFile(envelope);
      expect.unreachable('expected parseConfigurationFile to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(ERROR_CODES.CONFIG_INVALID);
      expect((error as DomainError).fieldErrors.some((f) => f.path === 'formatVersion')).toBe(true);
    }
  });

  it('throws CONFIG_INVALID when formatVersion is greater than the current version', () => {
    const envelope = {
      formatVersion: CONFIGURATION_FILE_FORMAT_VERSION + 1,
      exportedAt: new Date().toISOString(),
      configuration: sampleDocument(),
    };
    try {
      parseConfigurationFile(envelope);
      expect.unreachable('expected parseConfigurationFile to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(ERROR_CODES.CONFIG_INVALID);
      expect((error as DomainError).fieldErrors.some((f) => f.path === 'formatVersion')).toBe(true);
    }
  });

  it('parses successfully and drops every server-controlled field, asserted by name', () => {
    const configuration: Record<string, unknown> = {
      ...sampleDocument(),
      id: '11111111-1111-4111-8111-111111111111',
      ownerId: '22222222-2222-4222-8222-222222222222',
      revision: 7,
      schemaVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      isDraft: false,
      generatorVersion: '1.0.0',
    };
    const envelope = {
      formatVersion: CONFIGURATION_FILE_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      configuration,
    };

    const result = parseConfigurationFile(envelope);

    for (const field of FORBIDDEN_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(result, field)).toBe(false);
    }
    expect(Object.keys(result)).toHaveLength(8);
  });

  it('parses a document with an unsupported keycode, pinning the division of labour with validateConfiguration', () => {
    const record = sampleDocument({
      layers: [
        {
          id: '33333333-3333-4333-8333-333333333331',
          index: 0,
          name: 'Base',
          // Not a real supported keycode. parseConfigurationFile must not reject
          // this — validateConfiguration on the server does that job.
          bindings: { '0': { kind: 'keycode', keycode: 'KC_TOTALLY_MADE_UP' } as never },
        },
      ],
    });
    const result = parseConfigurationFile(toConfigurationFile(record));
    expect(result.layers[0]?.bindings['0']).toEqual({ kind: 'keycode', keycode: 'KC_TOTALLY_MADE_UP' });
  });

  it('parses a document with an out-of-range position id without rejecting it', () => {
    const record = sampleDocument({
      layers: [
        {
          id: '33333333-3333-4333-8333-333333333331',
          index: 0,
          name: 'Base',
          bindings: { '9999': { kind: 'keycode', keycode: 'KC_A' } },
        },
      ],
    });
    const result = parseConfigurationFile(toConfigurationFile(record));
    expect(result.layers[0]?.bindings['9999']).toEqual({ kind: 'keycode', keycode: 'KC_A' });
  });
});
