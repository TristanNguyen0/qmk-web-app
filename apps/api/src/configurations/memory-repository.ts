/**
 * In-memory repository.
 *
 * Used by route tests so the default `pnpm test` run stays hermetic and fast — the
 * Postgres implementation is covered separately by an integration test that needs a
 * real database. Both implement the same interface, and the shared contract test
 * (`repository-contract.test.ts`) runs against both, so they cannot drift.
 */
import type { Configuration } from '@qmk-web-app/domain';
import {
  RevisionConflictError,
  summarize,
  type ConfigurationRecord,
  type ConfigurationRepository,
  type ConfigurationSummary,
  type CreateArgs,
  type ListPage,
  type UpdateArgs,
} from './types.ts';

interface StoredRevision {
  document: Configuration;
  isDraft: boolean;
  createdAt: string;
}

export class InMemoryConfigurationRepository implements ConfigurationRepository {
  readonly #records = new Map<string, ConfigurationRecord>();
  readonly #revisions = new Map<string, Map<number, StoredRevision>>();

  async create(args: CreateArgs): Promise<ConfigurationRecord> {
    const record = structuredClone(args.record);
    this.#records.set(record.id, record);
    this.#revisions.set(
      record.id,
      new Map([
        [
          record.revision,
          { document: structuredClone(record.document), isDraft: record.isDraft, createdAt: record.createdAt },
        ],
      ]),
    );
    return structuredClone(record);
  }

  async get(id: string, ownerId: string): Promise<ConfigurationRecord | null> {
    const record = this.#records.get(id);
    // An id owned by someone else is indistinguishable from a missing id, so a
    // caller cannot probe for the existence of other people's configurations.
    if (!record || record.ownerId !== ownerId) return null;
    return structuredClone(record);
  }

  async list(
    ownerId: string,
    options: { page: number; pageSize: number },
  ): Promise<ListPage<ConfigurationSummary>> {
    const owned = [...this.#records.values()]
      .filter((r) => r.ownerId === ownerId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

    const totalItems = owned.length;
    const totalPages = Math.max(Math.ceil(totalItems / options.pageSize), 1);
    const page = Math.min(Math.max(options.page, 1), totalPages);
    const start = (page - 1) * options.pageSize;

    return {
      items: owned.slice(start, start + options.pageSize).map(summarize),
      page,
      pageSize: options.pageSize,
      totalItems,
      totalPages,
    };
  }

  async update(args: UpdateArgs): Promise<ConfigurationRecord | null> {
    const current = this.#records.get(args.id);
    if (!current || current.ownerId !== args.ownerId) return null;
    if (current.revision !== args.expectedRevision) {
      throw new RevisionConflictError(current.revision);
    }

    const { document, name, isDraft } = args.next(structuredClone(current));
    const revision = current.revision + 1;
    const updatedAt = new Date().toISOString();

    const next: ConfigurationRecord = {
      ...current,
      name,
      isDraft,
      revision,
      updatedAt,
      document: { ...structuredClone(document), revision, updatedAt },
    };

    this.#records.set(next.id, next);
    this.#revisions
      .get(next.id)
      ?.set(revision, { document: structuredClone(next.document), isDraft, createdAt: updatedAt });

    return structuredClone(next);
  }

  async delete(id: string, ownerId: string): Promise<boolean> {
    const record = this.#records.get(id);
    if (!record || record.ownerId !== ownerId) return false;
    this.#records.delete(id);
    this.#revisions.delete(id);
    return true;
  }

  async getRevision(
    id: string,
    ownerId: string,
    revision: number,
  ): Promise<StoredRevision | null> {
    const record = this.#records.get(id);
    if (!record || record.ownerId !== ownerId) return null;
    const stored = this.#revisions.get(id)?.get(revision);
    return stored ? structuredClone(stored) : null;
  }
}
