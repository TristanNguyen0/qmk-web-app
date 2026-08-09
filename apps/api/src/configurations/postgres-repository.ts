/**
 * PostgreSQL repository.
 *
 * Two properties matter here and are the reason this is not a thin wrapper:
 *
 *  1. **Ownership is in the WHERE clause**, not applied after fetching. A row owned
 *     by someone else is never loaded into memory at all.
 *  2. **Updates are atomic.** The revision check and the write happen in one
 *     transaction with the row locked, so two concurrent writers cannot both observe
 *     revision N and both succeed (claude.md § API/interface expectations).
 */
import type { Pool, PoolClient } from 'pg';
import type { Configuration } from '@qmk-web-app/domain';
import {
  RevisionConflictError,
  type ConfigurationRecord,
  type ConfigurationRepository,
  type ConfigurationSummary,
  type CreateArgs,
  type ListPage,
  type UpdateArgs,
} from './types.ts';

interface ConfigurationRow {
  id: string;
  owner_id: string;
  schema_version: number;
  catalog_version: string;
  qmk_commit: string;
  keyboard_id: string;
  layout_id: string;
  name: string;
  revision: number;
  is_draft: boolean;
  document: Configuration;
  generator_version: string;
  created_at: Date;
  updated_at: Date;
}

function toRecord(row: ConfigurationRow): ConfigurationRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    schemaVersion: row.schema_version,
    catalogVersion: row.catalog_version,
    qmkCommit: row.qmk_commit,
    keyboardId: row.keyboard_id,
    layoutId: row.layout_id,
    name: row.name,
    revision: row.revision,
    isDraft: row.is_draft,
    document: row.document,
    generatorVersion: row.generator_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresConfigurationRepository implements ConfigurationRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async #transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async create(args: CreateArgs): Promise<ConfigurationRecord> {
    const r = args.record;
    return this.#transaction(async (client) => {
      const inserted = await client.query<ConfigurationRow>(
        `INSERT INTO configurations
           (id, owner_id, schema_version, catalog_version, qmk_commit, keyboard_id,
            layout_id, name, revision, is_draft, document, generator_version,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          r.id,
          r.ownerId,
          r.schemaVersion,
          r.catalogVersion,
          r.qmkCommit,
          r.keyboardId,
          r.layoutId,
          r.name,
          r.revision,
          r.isDraft,
          JSON.stringify(r.document),
          r.generatorVersion,
          r.createdAt,
          r.updatedAt,
        ],
      );
      await client.query(
        `INSERT INTO configuration_revisions
           (configuration_id, revision, document, is_draft, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [r.id, r.revision, JSON.stringify(r.document), r.isDraft, r.createdAt],
      );
      return toRecord(inserted.rows[0]!);
    });
  }

  async get(id: string, ownerId: string): Promise<ConfigurationRecord | null> {
    const result = await this.#pool.query<ConfigurationRow>(
      'SELECT * FROM configurations WHERE id = $1 AND owner_id = $2',
      [id, ownerId],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async list(
    ownerId: string,
    options: { page: number; pageSize: number },
  ): Promise<ListPage<ConfigurationSummary>> {
    const countResult = await this.#pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM configurations WHERE owner_id = $1',
      [ownerId],
    );
    const totalItems = Number(countResult.rows[0]?.count ?? '0');
    const totalPages = Math.max(Math.ceil(totalItems / options.pageSize), 1);
    const page = Math.min(Math.max(options.page, 1), totalPages);

    const result = await this.#pool.query<{
      id: string;
      name: string;
      keyboard_id: string;
      layout_id: string;
      catalog_version: string;
      revision: number;
      is_draft: boolean;
      layer_count: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, keyboard_id, layout_id, catalog_version, revision, is_draft,
              jsonb_array_length(document -> 'layers')::text AS layer_count,
              created_at, updated_at
         FROM configurations
        WHERE owner_id = $1
        ORDER BY updated_at DESC
        LIMIT $2 OFFSET $3`,
      [ownerId, options.pageSize, (page - 1) * options.pageSize],
    );

    return {
      items: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        keyboardId: row.keyboard_id,
        layoutId: row.layout_id,
        catalogVersion: row.catalog_version,
        revision: row.revision,
        isDraft: row.is_draft,
        layerCount: Number(row.layer_count),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
      page,
      pageSize: options.pageSize,
      totalItems,
      totalPages,
    };
  }

  async update(args: UpdateArgs): Promise<ConfigurationRecord | null> {
    return this.#transaction(async (client) => {
      // FOR UPDATE serialises concurrent writers on this row, so the revision check
      // below cannot be won by two callers at once.
      const current = await client.query<ConfigurationRow>(
        'SELECT * FROM configurations WHERE id = $1 AND owner_id = $2 FOR UPDATE',
        [args.id, args.ownerId],
      );
      const row = current.rows[0];
      if (!row) return null;

      if (row.revision !== args.expectedRevision) {
        throw new RevisionConflictError(row.revision);
      }

      const { document, name, isDraft } = args.next(toRecord(row));
      const revision = row.revision + 1;
      const updatedAt = new Date();
      const nextDocument: Configuration = {
        ...document,
        revision,
        updatedAt: updatedAt.toISOString(),
      };

      const updated = await client.query<ConfigurationRow>(
        `UPDATE configurations
            SET name = $3, is_draft = $4, document = $5, revision = $6, updated_at = $7
          WHERE id = $1 AND owner_id = $2
        RETURNING *`,
        [args.id, args.ownerId, name, isDraft, JSON.stringify(nextDocument), revision, updatedAt],
      );

      await client.query(
        `INSERT INTO configuration_revisions
           (configuration_id, revision, document, is_draft, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [args.id, revision, JSON.stringify(nextDocument), isDraft, updatedAt],
      );

      return toRecord(updated.rows[0]!);
    });
  }

  async delete(id: string, ownerId: string): Promise<boolean> {
    const result = await this.#pool.query(
      'DELETE FROM configurations WHERE id = $1 AND owner_id = $2',
      [id, ownerId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getRevision(
    id: string,
    ownerId: string,
    revision: number,
  ): Promise<{ document: Configuration; isDraft: boolean; createdAt: string } | null> {
    // The join enforces ownership: a revision is only reachable through a
    // configuration the caller owns.
    const result = await this.#pool.query<{
      document: Configuration;
      is_draft: boolean;
      created_at: Date;
    }>(
      `SELECT r.document, r.is_draft, r.created_at
         FROM configuration_revisions r
         JOIN configurations c ON c.id = r.configuration_id
        WHERE r.configuration_id = $1 AND c.owner_id = $2 AND r.revision = $3`,
      [id, ownerId, revision],
    );
    const row = result.rows[0];
    return row
      ? { document: row.document, isDraft: row.is_draft, createdAt: row.created_at.toISOString() }
      : null;
  }
}
