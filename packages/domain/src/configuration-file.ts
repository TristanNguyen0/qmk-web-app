/**
 * The versioned configuration export/import envelope (claude.md § Configuration
 * model, phase 5 launch-identity decision D-03).
 *
 * `parseConfigurationFile` is a **field allowlist, not a schema validator**. It
 * mirrors `asInput()` in `apps/api/src/routes/configurations.ts` exactly: read the
 * eight content fields, ignore everything else rather than merging it, and hand the
 * result on for the server to fully validate through `validateConfiguration`. A
 * second validator in this package would drift from `validateConfiguration` over
 * time and turn "import takes the same path as any other write" into a claim that is
 * no longer true — so this module deliberately does not check keycodes, positions,
 * or any other content-shape rule. That is the server's job, on every write,
 * regardless of source.
 */
import type { Configuration } from './configuration.ts';
import { DomainError, ERROR_CODES } from './errors.ts';

/** The current envelope format. Bump this — and only this — when the envelope shape changes. */
export const CONFIGURATION_FILE_FORMAT_VERSION = 1;

/**
 * The eight fields a configuration file may carry. Deliberately excludes `id`,
 * `ownerId`, `revision`, `schemaVersion`, `createdAt`, `updatedAt`, `isDraft` and
 * `generatorVersion` — a file is content, not a record. Those fields are assigned by
 * the server on every write and must never be read from client input, exported or
 * imported.
 */
export type ConfigurationFileDocument = Pick<
  Configuration,
  'name' | 'catalogVersion' | 'qmkCommit' | 'keyboardId' | 'layoutId' | 'layers' | 'macros' | 'socd'
>;

export interface ConfigurationFile {
  /** Lets a future format change be detected rather than mis-interpreted. */
  formatVersion: number;
  /** Lets a user tell two exported files apart. */
  exportedAt: string;
  configuration: ConfigurationFileDocument;
}

/**
 * Builds the export envelope from any record carrying the eight content fields (a
 * full `Configuration`, or the subset of an API response that has the same field
 * names and types). Only those eight fields are read — extra fields on `record` are
 * ignored, never copied into the envelope.
 */
export function toConfigurationFile(record: ConfigurationFileDocument): ConfigurationFile {
  return {
    formatVersion: CONFIGURATION_FILE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    configuration: {
      name: record.name,
      catalogVersion: record.catalogVersion,
      qmkCommit: record.qmkCommit,
      keyboardId: record.keyboardId,
      layoutId: record.layoutId,
      layers: record.layers,
      macros: record.macros,
      socd: record.socd,
    },
  };
}

/**
 * Parses an untrusted `ConfigurationFile` envelope down to its eight content fields.
 * Throws `DomainError(CONFIG_INVALID, …)` — with a `FieldError` naming the offending
 * field — for a malformed envelope. Does not validate the configuration content
 * itself: a document with an unknown keycode or an out-of-range position parses
 * successfully here, because rejecting it is `validateConfiguration`'s job once the
 * result reaches `POST /v1/configurations`.
 */
export function parseConfigurationFile(input: unknown): ConfigurationFileDocument {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DomainError(ERROR_CODES.CONFIG_INVALID, 'configuration file must be a JSON object', [
      { path: '', message: 'must be a JSON object, not an array or null' },
    ]);
  }
  const envelope = input as Record<string, unknown>;

  const formatVersion = envelope['formatVersion'];
  if (typeof formatVersion !== 'number') {
    throw new DomainError(
      ERROR_CODES.CONFIG_INVALID,
      'formatVersion is required and must be a number',
      [{ path: 'formatVersion', message: 'required, must be a number' }],
    );
  }
  if (formatVersion > CONFIGURATION_FILE_FORMAT_VERSION) {
    throw new DomainError(
      ERROR_CODES.CONFIG_INVALID,
      `formatVersion ${formatVersion} is newer than the version this app supports (${CONFIGURATION_FILE_FORMAT_VERSION}); update the app to import this file`,
      [{ path: 'formatVersion', message: `must be <= ${CONFIGURATION_FILE_FORMAT_VERSION}` }],
    );
  }

  const configuration = envelope['configuration'];
  if (typeof configuration !== 'object' || configuration === null || Array.isArray(configuration)) {
    throw new DomainError(
      ERROR_CODES.CONFIG_INVALID,
      'configuration field is required and must be an object',
      [{ path: 'configuration', message: 'required, must be an object' }],
    );
  }
  const c = configuration as Record<string, unknown>;

  // Field allowlist, not a merge: only these eight names are read. Anything else the
  // file carries — including a server-controlled field like `id` or `ownerId` — is
  // ignored rather than copied into the result.
  return {
    name: c['name'] as ConfigurationFileDocument['name'],
    catalogVersion: c['catalogVersion'] as ConfigurationFileDocument['catalogVersion'],
    qmkCommit: c['qmkCommit'] as ConfigurationFileDocument['qmkCommit'],
    keyboardId: c['keyboardId'] as ConfigurationFileDocument['keyboardId'],
    layoutId: c['layoutId'] as ConfigurationFileDocument['layoutId'],
    layers: c['layers'] as ConfigurationFileDocument['layers'],
    macros: (c['macros'] ?? []) as ConfigurationFileDocument['macros'],
    socd: (c['socd'] ?? null) as ConfigurationFileDocument['socd'],
  };
}
