/**
 * Configuration persistence contract.
 *
 * claude.md § API/interface expectations:
 *  - "Require optimistic concurrency (revision or ETag) on configuration updates to
 *    prevent silent overwrites."
 *  - "Authorize every configuration, build, log, and artifact read by
 *    ownership/entitlement."
 *
 * Ownership is enforced in the repository, not only in routes: every read and write
 * takes the requesting owner and the store refuses to return another owner's row.
 * A route that forgets a check therefore fails closed rather than leaking.
 */
import type { Configuration } from '@qmk-web-app/domain';

export interface ConfigurationRecord {
  id: string;
  ownerId: string;
  schemaVersion: number;
  catalogVersion: string;
  qmkCommit: string;
  keyboardId: string;
  layoutId: string;
  name: string;
  /** Optimistic concurrency token. Bumped on every accepted write. */
  revision: number;
  /**
   * True until the configuration is complete enough to build. Phase 3 refuses to
   * build a draft (claude.md § Visual keymap editor).
   */
  isDraft: boolean;
  /** The full validated configuration document. */
  document: Configuration;
  generatorVersion: string;
  createdAt: string;
  updatedAt: string;
}

/** The client-editable subset. Everything else is set by the server. */
export interface ConfigurationInput {
  name: string;
  catalogVersion: string;
  qmkCommit: string;
  keyboardId: string;
  layoutId: string;
  layers: unknown;
  macros: unknown;
  socd: unknown;
}

export interface ConfigurationSummary {
  id: string;
  name: string;
  keyboardId: string;
  layoutId: string;
  catalogVersion: string;
  revision: number;
  isDraft: boolean;
  layerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListPage<T> {
  items: readonly T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/** Raised when the caller's expected revision does not match the stored head. */
export class RevisionConflictError extends Error {
  readonly currentRevision: number;
  constructor(currentRevision: number) {
    super(`configuration has been modified; current revision is ${currentRevision}`);
    this.name = 'RevisionConflictError';
    this.currentRevision = currentRevision;
  }
}

export interface CreateArgs {
  record: ConfigurationRecord;
}

export interface UpdateArgs {
  id: string;
  ownerId: string;
  /** The revision the client believes it is editing. */
  expectedRevision: number;
  /** Produces the next document given the current record. */
  next: (current: ConfigurationRecord) => {
    document: Configuration;
    name: string;
    isDraft: boolean;
  };
}

export interface ConfigurationRepository {
  create(args: CreateArgs): Promise<ConfigurationRecord>;

  /** Returns null when the id is unknown OR owned by someone else. */
  get(id: string, ownerId: string): Promise<ConfigurationRecord | null>;

  list(
    ownerId: string,
    options: { page: number; pageSize: number },
  ): Promise<ListPage<ConfigurationSummary>>;

  /** Throws RevisionConflictError when the expected revision is stale. */
  update(args: UpdateArgs): Promise<ConfigurationRecord | null>;

  delete(id: string, ownerId: string): Promise<boolean>;

  /** Immutable history; a build references an exact revision. */
  getRevision(
    id: string,
    ownerId: string,
    revision: number,
  ): Promise<{ document: Configuration; isDraft: boolean; createdAt: string } | null>;
}

export function summarize(record: ConfigurationRecord): ConfigurationSummary {
  return {
    id: record.id,
    name: record.name,
    keyboardId: record.keyboardId,
    layoutId: record.layoutId,
    catalogVersion: record.catalogVersion,
    revision: record.revision,
    isDraft: record.isDraft,
    layerCount: record.document.layers.length,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
