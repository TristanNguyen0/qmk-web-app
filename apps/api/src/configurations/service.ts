/**
 * Configuration service: the only place a configuration document is assembled.
 *
 * Two rules drive the design:
 *
 *  - **The client never sets server-controlled fields.** `id`, `ownerId`, `revision`,
 *    `schemaVersion`, `createdAt`, `updatedAt` and `generatorVersion` are assigned
 *    here. A client that sends them has them ignored, so it cannot forge ownership or
 *    rewind a revision.
 *  - **Nothing is persisted without full server-side validation**, on every write,
 *    regardless of what the client already validated (claude.md § API/interface
 *    expectations).
 */
import { randomUUID } from 'node:crypto';
import {
  DomainError,
  ERROR_CODES,
  SCHEMA_VERSION,
  validateConfiguration,
  type Catalog,
  type Configuration,
} from '@qmk-web-app/domain';
import { GENERATOR_VERSION } from '@qmk-web-app/qmk-generator';
import type { CatalogStore } from '../catalog-store.ts';
import type { ConfigurationInput, ConfigurationRecord } from './types.ts';

/**
 * A configuration with no bindings anywhere is structurally valid but pointless to
 * build, so it stays a draft. Phase 3 refuses to build drafts.
 */
export function computeIsDraft(document: Configuration): boolean {
  return !document.layers.some((layer) => Object.keys(layer.bindings).length > 0);
}

/**
 * The catalog the API validates against. `CatalogStore` serves keyboards lazily, so
 * a single-keyboard catalog is assembled for the configuration being validated
 * rather than materialising all 3,748.
 */
export function catalogFor(store: CatalogStore, version: string, keyboardId: string): Catalog {
  const meta = store.getMeta(version);
  const keyboard = store.getKeyboard(version, keyboardId);
  return {
    catalogVersion: meta.catalogVersion,
    qmkCommit: meta.qmkCommit,
    extractorVersion: meta.extractorVersion,
    normalizerVersion: meta.normalizerVersion,
    generatedAt: meta.generatedAt,
    keycodeSpecVersion: meta.keycodeSpecVersion,
    keycodeAliases: meta.keycodeAliases,
    communityKeymaps: meta.communityKeymaps,
    keyboards: keyboard ? [keyboard] : [],
  };
}

function assertKnownCatalogVersion(store: CatalogStore, version: string): void {
  if (!store.versions.includes(version)) {
    throw new DomainError(
      ERROR_CODES.CONFIG_INVALID,
      'configuration targets a catalog version this server does not have',
      [{ path: 'catalogVersion', message: `unknown catalog version ${version}` }],
    );
  }
}

export interface BuildDocumentArgs {
  input: ConfigurationInput;
  ownerId: string;
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** Assembles and fully validates a document. Throws DomainError on any problem. */
export function buildValidatedDocument(
  store: CatalogStore,
  args: BuildDocumentArgs,
): Configuration {
  const { input } = args;

  if (typeof input.catalogVersion !== 'string' || input.catalogVersion === '') {
    throw new DomainError(ERROR_CODES.CONFIG_INVALID, 'catalogVersion is required', [
      { path: 'catalogVersion', message: 'required' },
    ]);
  }
  assertKnownCatalogVersion(store, input.catalogVersion);

  const candidate = {
    // Server-controlled. Anything the client sent for these is discarded.
    id: args.id,
    ownerId: args.ownerId,
    schemaVersion: SCHEMA_VERSION,
    revision: args.revision,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
    generatorVersion: GENERATOR_VERSION,

    // Client-controlled, and all of it validated below.
    catalogVersion: input.catalogVersion,
    qmkCommit: input.qmkCommit,
    keyboardId: input.keyboardId,
    layoutId: input.layoutId,
    name: input.name,
    layers: input.layers,
    macros: input.macros,
    socd: input.socd,
  };

  const catalog = catalogFor(
    store,
    input.catalogVersion,
    typeof input.keyboardId === 'string' ? input.keyboardId : '',
  );

  const { configuration } = validateConfiguration(candidate, { catalog });
  return configuration;
}

export function createRecord(
  store: CatalogStore,
  input: ConfigurationInput,
  ownerId: string,
): ConfigurationRecord {
  const id = randomUUID();
  const now = new Date().toISOString();

  const document = buildValidatedDocument(store, {
    input,
    ownerId,
    id,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    ownerId,
    schemaVersion: document.schemaVersion,
    catalogVersion: document.catalogVersion,
    qmkCommit: document.qmkCommit,
    keyboardId: document.keyboardId,
    layoutId: document.layoutId,
    name: document.name,
    revision: 1,
    isDraft: computeIsDraft(document),
    document,
    generatorVersion: document.generatorVersion,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Produces the next document for an update.
 *
 * The keyboard and layout are immutable after creation: changing either would
 * invalidate every position binding at once, and silently dropping them is exactly
 * the "silently remap" behaviour claude.md forbids. Callers wanting a different
 * keyboard create a new configuration.
 */
export function nextDocument(
  store: CatalogStore,
  current: ConfigurationRecord,
  input: ConfigurationInput,
  ownerId: string,
): { document: Configuration; name: string; isDraft: boolean } {
  if (input.keyboardId !== current.keyboardId) {
    throw new DomainError(
      ERROR_CODES.CONFIG_INVALID,
      'keyboardId cannot be changed after creation; create a new configuration instead',
      [{ path: 'keyboardId', message: `must remain ${current.keyboardId}` }],
    );
  }
  if (input.layoutId !== current.layoutId) {
    throw new DomainError(
      ERROR_CODES.CONFIG_INVALID,
      'layoutId cannot be changed after creation; create a new configuration instead',
      [{ path: 'layoutId', message: `must remain ${current.layoutId}` }],
    );
  }

  const document = buildValidatedDocument(store, {
    input,
    ownerId,
    id: current.id,
    // The repository assigns the real next revision; this placeholder keeps the
    // document schema-valid during validation.
    revision: current.revision + 1,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  });

  return { document, name: document.name, isDraft: computeIsDraft(document) };
}
