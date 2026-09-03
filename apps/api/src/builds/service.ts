/**
 * Build request admission.
 *
 * claude.md § Deterministic generation, step 2: "Server performs authorization and
 * full schema/capability validation. It stores a build record with `queued` status and
 * an idempotency key."
 *
 * Authorization happens in the repository; everything else that must be true before a
 * compile is allowed to exist happens here. In particular the stored configuration is
 * **re-validated against the catalog at request time**, not trusted because it was
 * valid when it was saved: the catalog it targets may no longer be loaded, and a
 * capability such as SOCD may still be unavailable. Queueing a build that generation
 * will certainly refuse would burn a worker slot to produce an error the API already
 * had enough information to give immediately.
 */
import { randomUUID } from 'node:crypto';
import { DomainError, ERROR_CODES, validateConfiguration, type BuildRecord } from '@qmk-web-app/domain';
import { GENERATOR_VERSION } from '@qmk-web-app/qmk-generator';
import type { CatalogStore } from '../catalog-store.ts';
import { CatalogNotFoundError } from '../catalog-store.ts';
import { catalogFor } from '../configurations/service.ts';
import type { ConfigurationRecord } from '../configurations/types.ts';

/**
 * Idempotency keys are echoed nowhere and used only as a unique index value, but they
 * are still client-supplied text reaching the database, so the accepted shape is
 * narrow and explicit.
 */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export interface BuildEnvironment {
  /** The image a build of this configuration is expected to run in. */
  imageRef: string;
  imageDigest: string | null;
}

export interface PrepareBuildArgs {
  configuration: ConfigurationRecord;
  ownerId: string;
  idempotencyKey: string;
  environment: BuildEnvironment;
}

/**
 * Validates a build request and returns the record to persist. Throws `DomainError`
 * with a user-safe code for every rejection.
 */
export function prepareBuild(store: CatalogStore, args: PrepareBuildArgs): BuildRecord {
  const { configuration } = args;

  if (configuration.isDraft) {
    // claude.md § Visual keymap editor: "mark drafts explicitly as incomplete and block
    // builds until server validation passes".
    throw new DomainError(
      ERROR_CODES.CONFIG_INVALID,
      'this configuration is still a draft: bind at least one key before building',
      [{ path: 'layers', message: 'no layer has any binding' }],
    );
  }

  let catalog;
  try {
    catalog = catalogFor(store, configuration.catalogVersion, configuration.keyboardId);
  } catch (error) {
    if (error instanceof CatalogNotFoundError) {
      // The configuration was saved against a catalog this server no longer serves.
      // Building it would silently retarget it, which § Source management forbids.
      throw new DomainError(
        ERROR_CODES.CATALOG_KEYBOARD_UNAVAILABLE,
        'this configuration targets a catalog version this server no longer has',
      );
    }
    throw error;
  }

  // Throws CONFIG_INVALID / CATALOG_* / CAPABILITY_UNAVAILABLE as appropriate.
  validateConfiguration(configuration.document, { catalog });

  return {
    id: randomUUID(),
    configurationId: configuration.id,
    // The exact revision, captured now. Later edits produce later revisions and do not
    // change what this build compiles.
    configurationRevision: configuration.revision,
    ownerId: args.ownerId,
    catalogVersion: configuration.catalogVersion,
    qmkCommit: configuration.qmkCommit,
    generatorVersion: GENERATOR_VERSION,
    // Unknown until the worker completes the build (D-03); never guessed here.
    socdModuleVersion: null,
    buildImageRef: args.environment.imageRef,
    buildImageDigest: args.environment.imageDigest,
    status: 'queued',
    idempotencyKey: args.idempotencyKey,
    requestedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    attemptCount: 0,
    artifactId: null,
    outputFormat: null,
    logReference: null,
    failureCode: null,
  };
}
