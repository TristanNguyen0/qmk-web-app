/**
 * One suite, both repositories.
 *
 * The in-memory repository exists so route tests stay hermetic, which is only safe if
 * it behaves like the real one. This suite runs the same assertions against both, so
 * the two cannot silently diverge — particularly around ownership scoping and
 * revision conflicts, where a lenient in-memory stub would hide a real security bug.
 *
 * The Postgres half is skipped unless a database is reachable:
 *   docker compose -f infra/deploy/docker-compose.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Configuration } from '@qmk-web-app/domain';
import { runMigrations } from '../db/migrate.ts';
import { InMemoryConfigurationRepository } from './memory-repository.ts';
import { PostgresConfigurationRepository } from './postgres-repository.ts';
import {
  RevisionConflictError,
  type ConfigurationRecord,
  type ConfigurationRepository,
} from './types.ts';

const DATABASE_URL =
  process.env['QWA_TEST_DATABASE_URL'] ??
  process.env['QWA_DATABASE_URL'] ??
  'postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa';

async function postgresAvailable(): Promise<pg.Pool | null> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4, connectionTimeoutMillis: 1500 });
  try {
    await pool.query('SELECT 1');
    await runMigrations(pool);
    return pool;
  } catch {
    await pool.end().catch(() => {});
    return null;
  }
}

const pool = await postgresAvailable();

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

let counter = 0;
function uuid(): string {
  counter += 1;
  return `33333333-3333-4333-8333-${String(counter).padStart(12, '0')}`;
}

function record(ownerId: string, overrides: Partial<ConfigurationRecord> = {}): ConfigurationRecord {
  const id = overrides.id ?? uuid();
  const now = new Date().toISOString();
  const document = {
    id,
    ownerId,
    schemaVersion: 1,
    catalogVersion: '0.33.13-1',
    qmkCommit: 'a'.repeat(40),
    keyboardId: 'crkbd/rev1',
    layoutId: 'LAYOUT_split_3x6_3',
    name: 'Test',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    layers: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        index: 0,
        name: 'Base',
        bindings: { '0': { kind: 'keycode', keycode: 'KC_A' } },
      },
    ],
    macros: [],
    socd: null,
    generatorVersion: '1.0.0',
  } as unknown as Configuration;

  return {
    id,
    ownerId,
    schemaVersion: 1,
    catalogVersion: '0.33.13-1',
    qmkCommit: 'a'.repeat(40),
    keyboardId: 'crkbd/rev1',
    layoutId: 'LAYOUT_split_3x6_3',
    name: 'Test',
    revision: 1,
    isDraft: false,
    document,
    generatorVersion: '1.0.0',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function rename(name: string) {
  return (current: ConfigurationRecord) => ({
    document: { ...current.document, name },
    name,
    isDraft: false,
  });
}

const implementations: [string, () => ConfigurationRepository][] = [
  ['InMemoryConfigurationRepository', () => new InMemoryConfigurationRepository()],
];

if (pool) {
  implementations.push([
    'PostgresConfigurationRepository',
    () => new PostgresConfigurationRepository(pool),
  ]);
} else {
  // Visible rather than silent: a skipped security-relevant suite should be obvious.
  console.warn(
    `\n[repository-contract] Postgres not reachable at ${DATABASE_URL} — running in-memory only.\n` +
      `  docker compose -f infra/deploy/docker-compose.yml up -d\n`,
  );
}

afterAll(async () => {
  await pool?.end();
});

describe.each(implementations)('%s', (_name, make) => {
  let repo: ConfigurationRepository;

  beforeEach(async () => {
    repo = make();
    if (pool) {
      // Each Postgres run starts from a clean table so ordering assertions hold.
      await pool.query('DELETE FROM configurations');
    }
  });

  it('creates and reads back', async () => {
    const created = await repo.create({ record: record(ALICE) });
    const fetched = await repo.get(created.id, ALICE);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.revision).toBe(1);
    expect(fetched?.document.layers).toHaveLength(1);
  });

  it('scopes reads by owner', async () => {
    const created = await repo.create({ record: record(ALICE) });
    expect(await repo.get(created.id, BOB)).toBeNull();
  });

  it('scopes lists by owner', async () => {
    await repo.create({ record: record(ALICE) });
    await repo.create({ record: record(ALICE) });
    await repo.create({ record: record(BOB) });

    expect((await repo.list(ALICE, { page: 1, pageSize: 10 })).totalItems).toBe(2);
    expect((await repo.list(BOB, { page: 1, pageSize: 10 })).totalItems).toBe(1);
  });

  it('paginates lists', async () => {
    for (let i = 0; i < 5; i += 1) await repo.create({ record: record(ALICE) });
    const page = await repo.list(ALICE, { page: 2, pageSize: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.totalItems).toBe(5);
    expect(page.totalPages).toBe(3);
  });

  it('bumps the revision on update and rewrites it into the document', async () => {
    const created = await repo.create({ record: record(ALICE) });
    const updated = await repo.update({
      id: created.id,
      ownerId: ALICE,
      expectedRevision: 1,
      next: rename('renamed'),
    });
    expect(updated?.revision).toBe(2);
    expect(updated?.name).toBe('renamed');
    // The stored document must agree with the column, or a build would embed a
    // revision that does not match the record it came from.
    expect(updated?.document.revision).toBe(2);
  });

  it('throws on a stale revision and leaves the record untouched', async () => {
    const created = await repo.create({ record: record(ALICE) });
    await repo.update({ id: created.id, ownerId: ALICE, expectedRevision: 1, next: rename('first') });

    await expect(
      repo.update({ id: created.id, ownerId: ALICE, expectedRevision: 1, next: rename('second') }),
    ).rejects.toBeInstanceOf(RevisionConflictError);

    expect((await repo.get(created.id, ALICE))?.name).toBe('first');
  });

  it('refuses to update another owner’s record', async () => {
    const created = await repo.create({ record: record(ALICE) });
    const result = await repo.update({
      id: created.id,
      ownerId: BOB,
      expectedRevision: 1,
      next: rename('hijacked'),
    });
    expect(result).toBeNull();
    expect((await repo.get(created.id, ALICE))?.name).toBe('Test');
  });

  it('keeps every revision retrievable', async () => {
    const created = await repo.create({ record: record(ALICE) });
    await repo.update({ id: created.id, ownerId: ALICE, expectedRevision: 1, next: rename('v2') });

    expect((await repo.getRevision(created.id, ALICE, 1))?.document.name).toBe('Test');
    expect((await repo.getRevision(created.id, ALICE, 2))?.document.name).toBe('v2');
    expect(await repo.getRevision(created.id, ALICE, 99)).toBeNull();
  });

  it('scopes revision reads by owner', async () => {
    const created = await repo.create({ record: record(ALICE) });
    expect(await repo.getRevision(created.id, BOB, 1)).toBeNull();
  });

  it('deletes only the owner’s record', async () => {
    const created = await repo.create({ record: record(ALICE) });
    expect(await repo.delete(created.id, BOB)).toBe(false);
    expect(await repo.delete(created.id, ALICE)).toBe(true);
    expect(await repo.get(created.id, ALICE)).toBeNull();
  });
});
